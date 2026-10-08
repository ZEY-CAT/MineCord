const GAME_URL = 'https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev/eaglercraft-26.2-u1.html';
const ALARM = 'minecord-eaglercraft-heartbeat';

async function readConfig() {
  return chrome.storage.local.get(['serverUrl', 'activityToken', 'activeTabs']);
}

async function matchingGameTabs() {
  return chrome.tabs.query({ url: `${GAME_URL}*` });
}

async function sendActivity(active) {
  const { serverUrl, activityToken } = await readConfig();
  if (!serverUrl || !activityToken) return;
  const url = `${serverUrl.replace(/\/+$/, '')}/api/integrations/eaglercraft/presence`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${activityToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  if (response.status === 401) await chrome.storage.local.remove(['activityToken', 'serverUrl', 'activeTabs']);
  if (!response.ok) throw new Error(`MINECORD rejected the activity update (${response.status}).`);
}

async function refreshActivity() {
  const tabs = await matchingGameTabs();
  const stored = await readConfig();
  const readyTabs = new Set(stored.activeTabs || []);
  const active = tabs.some(tab => readyTabs.has(tab.id));
  await sendActivity(active);
  await chrome.storage.local.set({ activeTabs: [...readyTabs].filter(id => tabs.some(tab => tab.id === id)) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await chrome.storage.local.set({ activeTabs: [] });
  await refreshActivity();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) refreshActivity().catch(error => console.error(error));
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.get('activeTabs').then(async ({ activeTabs = [] }) => {
    const next = activeTabs.filter(id => id !== tabId);
    await chrome.storage.local.set({ activeTabs: next });
    await refreshActivity();
  }).catch(error => console.error(error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !tab.url?.startsWith(GAME_URL)) {
    chrome.storage.local.get('activeTabs').then(({ activeTabs = [] }) => {
      const filtered = activeTabs.filter(activeTabId => activeTabId !== tabId);
      return chrome.storage.local.set({ activeTabs: filtered });
    }).then(refreshActivity).catch(error => console.error(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'eaglercraft-state') {
    const url = new URL(sender.url || '');
    if (url.origin !== new URL(GAME_URL).origin || url.pathname !== new URL(GAME_URL).pathname || typeof message.active !== 'boolean') return;
    chrome.storage.local.get('activeTabs').then(async ({ activeTabs = [] }) => {
      const next = new Set(activeTabs);
      if (message.active) next.add(sender.tab.id);
      else next.delete(sender.tab.id);
      await chrome.storage.local.set({ activeTabs: [...next] });
      await refreshActivity();
      respond({ ok: true });
    }).catch(error => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'pair') {
    const serverUrl = String(message.serverUrl || '').trim().replace(/\/+$/, '');
    const code = String(message.code || '').trim();
    if (!/^https?:\/\/[^/]+$/i.test(serverUrl) || code.length < 20 || code.length > 100 ||
        (!serverUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(serverUrl))) {
      respond({ error: 'Enter the MINECORD server URL and the pairing code from Settings.' });
      return;
    }
    fetch(`${serverUrl}/api/integrations/eaglercraft/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pairing failed.');
      await chrome.storage.local.set({ serverUrl, activityToken: result.token, activeTabs: [] });
      await refreshActivity();
      respond({ ok: true });
    }).catch(error => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'unpair') {
    readConfig().then(async config => {
      if (config.serverUrl && config.activityToken) {
        const response = await fetch(`${config.serverUrl}/api/integrations/eaglercraft/unpair`, {
          method: 'POST',
          headers: { 'X-Minecord-Activity-Token': config.activityToken }
        });
        if (!response.ok) throw new Error('MINECORD could not revoke this activity connector.');
      }
      await chrome.storage.local.remove(['activityToken', 'serverUrl', 'activeTabs']);
      respond({ ok: true });
    }).catch(error => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'status') {
    readConfig().then(config => respond({ paired: !!config.activityToken, serverUrl: config.serverUrl || '' }));
    return true;
  }
});

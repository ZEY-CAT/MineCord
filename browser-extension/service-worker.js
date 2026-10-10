const GAME_URLS = [
  'https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev/eaglercraft-26.2-u1.html',
  'https://eaglercraft.com/play'
];
const ALARM = 'minecord-eaglercraft-heartbeat';

function isSupportedGameUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev') {
      return url.pathname === '/eaglercraft-26.2-u1.html';
    }
    return url.origin === 'https://eaglercraft.com' &&
      url.pathname === '/play' && url.searchParams.get('version') === '26.2';
  } catch {
    return false;
  }
}

async function readConfig() {
  return chrome.storage.local.get(['serverUrl', 'activityToken', 'activeTabs', 'activeFrames']);
}

async function matchingGameTabs() {
  const tabs = await chrome.tabs.query({ url: GAME_URLS.map(url => `${url}*`) });
  return tabs.filter(tab => isSupportedGameUrl(tab.url));
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
  if (response.status === 401) await chrome.storage.local.remove(['activityToken', 'serverUrl', 'activeTabs', 'activeFrames']);
  if (!response.ok) throw new Error(`MINECORD rejected the activity update (${response.status}).`);
}

async function refreshActivity() {
  const tabs = await matchingGameTabs();
  const stored = await readConfig();
  const activeFrames = stored.activeFrames || {};
  const tabIds = new Set(tabs.map(tab => tab.id));
  const cutoff = Date.now() - 45000;
  const liveFrames = {};
  for (const [tabId, frames] of Object.entries(activeFrames)) {
    if (!tabIds.has(Number(tabId))) continue;
    const currentFrames = Object.fromEntries(Object.entries(frames).filter(([, seenAt]) => Number(seenAt) > cutoff));
    if (Object.keys(currentFrames).length) liveFrames[tabId] = currentFrames;
  }
  const activeTabs = Object.keys(liveFrames).map(Number);
  const active = activeTabs.length > 0;
  await sendActivity(active);
  await chrome.storage.local.set({ activeTabs, activeFrames: liveFrames });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await refreshActivity();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) refreshActivity().catch(error => console.error(error));
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.get('activeFrames').then(async ({ activeFrames = {} }) => {
    delete activeFrames[tabId];
    await chrome.storage.local.set({ activeFrames });
    await refreshActivity();
  }).catch(error => console.error(error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !isSupportedGameUrl(tab.url)) {
    chrome.storage.local.get('activeFrames').then(({ activeFrames = {} }) => {
      delete activeFrames[tabId];
      return chrome.storage.local.set({ activeFrames });
    }).then(refreshActivity).catch(error => console.error(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'eaglercraft-state') {
    if (!sender.tab?.id || !isSupportedGameUrl(sender.url) || typeof message.active !== 'boolean') return;
    chrome.storage.local.get('activeFrames').then(async ({ activeFrames = {} }) => {
      const tabId = String(sender.tab.id);
      const frames = activeFrames[tabId] || {};
      const frameId = String(sender.frameId ?? 0);
      if (message.active) frames[frameId] = Date.now();
      else delete frames[frameId];
      if (Object.keys(frames).length) activeFrames[tabId] = frames;
      else delete activeFrames[tabId];
      await chrome.storage.local.set({ activeFrames });
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
      await chrome.storage.local.set({ serverUrl, activityToken: result.token, activeTabs: [], activeFrames: {} });
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
      await chrome.storage.local.remove(['activityToken', 'serverUrl', 'activeTabs', 'activeFrames']);
      respond({ ok: true });
    }).catch(error => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'status') {
    readConfig().then(config => respond({ paired: !!config.activityToken, serverUrl: config.serverUrl || '' }));
    return true;
  }
});

(() => {
  'use strict';

  const defaults = { enabled: false, messages: true, friendOnline: true, calls: true, invites: true };
  let settings = { ...defaults };
  let accountId = 'guest';
  let previousOnline = null;

  function key() { return `minecord.notifications.v1.${accountId}`; }
  function save() {
    try { localStorage.setItem(key(), JSON.stringify(settings)); } catch {}
  }
  function load() {
    try { settings = { ...defaults, ...(JSON.parse(localStorage.getItem(key()) || 'null') || {}) }; }
    catch { settings = { ...defaults }; }
    for (const id of ['enabled', 'messages', 'friendOnline', 'calls', 'invites']) {
      const checkbox = document.getElementById(`minecordNotification${id}`);
      if (checkbox) checkbox.checked = Boolean(settings[id]);
    }
  }
  function controls() {
    const panel = document.getElementById('settingsPanelAccount');
    if (!panel || document.getElementById('minecordNotificationSettings')) return;
    const section = document.createElement('section');
    section.id = 'minecordNotificationSettings';
    section.innerHTML = `<h3>Notifications</h3><p class="muted">Choose what MineCord may notify you about while it is running. Message previews stay private.</p><label class="row"><input id="minecordNotificationenabled" type="checkbox" style="width:auto;margin:0"> Desktop notifications</label><label class="row"><input id="minecordNotificationmessages" type="checkbox" style="width:auto;margin:0"> New messages</label><label class="row"><input id="minecordNotificationfriendOnline" type="checkbox" style="width:auto;margin:0"> Friends coming online</label><label class="row"><input id="minecordNotificationcalls" type="checkbox" style="width:auto;margin:0"> Incoming and missed calls</label><label class="row"><input id="minecordNotificationinvites" type="checkbox" style="width:auto;margin:0"> Friend and server invitations</label><div id="minecordNotificationStatus" class="muted" role="status"></div>`;
    panel.append(section);
    for (const id of ['enabled', 'messages', 'friendOnline', 'calls', 'invites']) {
      document.getElementById(`minecordNotification${id}`).addEventListener('change', async event => {
        const changingAccount = accountId;
        const allowed = id !== 'enabled' || !event.target.checked || await requestNotificationPermission();
        if (changingAccount !== accountId) return;
        if (event.target.checked && !allowed) {
          event.target.checked = false;
          document.getElementById('minecordNotificationStatus').textContent = 'Allow notifications in your device settings to turn this on.';
          settings.enabled = false;
        } else {
          settings[id] = event.target.checked;
          document.getElementById('minecordNotificationStatus').textContent = settings.enabled ? 'Notification preferences saved.' : '';
        }
        save();
      });
    }
    load();
  }

  async function requestNotificationPermission() {
    const native = window.__TAURI__?.notification;
    try {
      if (native?.isPermissionGranted && native?.requestPermission) {
        if (await native.isPermissionGranted()) return true;
        return (await native.requestPermission()) === 'granted';
      }
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      return (await Notification.requestPermission()) === 'granted';
    } catch { return false; }
  }

  function nativeVisible() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }
  function currentOnlineUsers() {
    return typeof online !== 'undefined' && Array.isArray(online) ? online : [];
  }
  function currentFriends() {
    return typeof friendsList !== 'undefined' && Array.isArray(friendsList) ? friendsList : [];
  }
  async function notify(kind, body) {
    if (!settings.enabled || nativeVisible()) return;
    if (kind === 'message' && !settings.messages) return;
    if (kind === 'friendOnline' && !settings.friendOnline) return;
    if (kind === 'call' && !settings.calls) return;
    if (kind === 'invite' && !settings.invites) return;
    const notifiedAccount = accountId;
    const title = 'MineCord';
    const tag = `minecord-${kind}-${Date.now()}`;
    try {
      const native = window.__TAURI__?.notification;
      if (native?.isPermissionGranted && native?.sendNotification) {
        if (await native.isPermissionGranted() && accountId === notifiedAccount && settings.enabled && !nativeVisible()) {
          await native.sendNotification({ title, body, group: `minecord-${kind}` });
        }
      } else if ('Notification' in window && Notification.permission === 'granted') {
        const options = { body, tag, icon: '/icons/icon-192.png', silent: true };
        const registration = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
        if (accountId !== notifiedAccount || !settings.enabled || nativeVisible()) return;
        if (registration?.active && registration.showNotification) {
          await registration.showNotification(title, options);
          return;
        }
        const notification = new Notification(title, options);
        notification.onclick = () => { window.focus(); notification.close(); };
      }
    } catch {}
  }

  controls();
  const settingsButton = document.getElementById('profileBtn');
  settingsButton?.addEventListener('click', () => { controls(); load(); });

  const originalHandle = typeof window.handle === 'function' ? window.handle : null;
  if (originalHandle) {
    window.handle = function (message) {
      const oldOnline = previousOnline || new Set(currentOnlineUsers());
      const result = originalHandle.apply(this, arguments);
      if (message?.type === 'ready' && message.me?.id && String(message.me.id) !== accountId) {
        accountId = String(message.me.id);
        load();
      }
      if (message?.type === 'presence' || message?.type === 'ready') {
        const nextOnline = new Set(Array.isArray(message.online) ? message.online : []);
        const friends = new Set(currentFriends());
        if (message.type === 'presence' && [...nextOnline].some(name => !oldOnline.has(name) && friends.has(name))) {
          void notify('friendOnline', 'A friend just came online.');
        }
        previousOnline = nextOnline;
      }
      if (['message', 'dm', 'group_dm_message'].includes(message?.type)) {
        const author = message.message?.sender || message.message?.from || message.from || message.sender;
        if (author !== me?.username) void notify('message', 'You have a new message in MineCord.');
      }
      if (message?.type === 'incoming_call') void notify('call', 'You have an incoming voice call.');
      if (message?.type === 'call_cancelled' && message.reason === 'timeout') void notify('call', 'You missed a MineCord call.');
      if (message?.type === 'friend_request' || message?.type === 'friend_invite') {
        void notify('invite', 'You have a new friend or server invitation.');
      }
      return result;
    };
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('MineCord offline support could not start:', error.message);
    }), { once: true });
  }
})();

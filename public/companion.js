(() => {
  'use strict';

  const skins = {
    slime: { label: 'Moss Slime', color: '#7ad987', dark: '#378d57', light: '#b8f4a8', eyes: '#283a42' },
    fox: { label: 'Ember Fox', color: '#f39a52', dark: '#b95838', light: '#fff0cf', eyes: '#3e2c31' },
    bee: { label: 'Honey Bee', color: '#f4cf4e', dark: '#4c3c33', light: '#fff2a7', eyes: '#332e35' },
    axolotl: { label: 'Bubble Axolotl', color: '#ed9fbd', dark: '#b85f8b', light: '#ffe0ed', eyes: '#413342' }
  };
  const animations = ['idle', 'walking', 'sleeping', 'happy', 'excited', 'playful'];
  const reactions = {
    happy: ['A new message! ✨', 'That made my day!', 'Sending a tiny wave!'],
    excited: ['A friend is here!', 'Adventure time!', 'Yay, a familiar face!'],
    playful: ['Boop!', 'Catch me if you can!', 'Hehe!'],
    missed: ['I hope they call again.', 'A little quiet moment.', 'We can try again soon.'],
    invite: ['A new adventure awaits!', 'Let’s go together!', 'Someone saved you a spot!']
  };
  const defaults = { enabled: false, name: 'Sprout', skin: 'slime', animation: 'idle', animationsEnabled: true, reactionsEnabled: true, overlayEnabled: false, x: null, y: null };
  let preferences = { ...defaults };
  let accountId = 'guest';
  let temporaryAnimation = '';
  let returnTimer = 0;
  let bubbleTimer = 0;
  let channel = null;
  let dragging = null;
  const overlayMode = new URLSearchParams(location.search).get('companionOverlay') === '1';

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = '/companion.css';
  document.head.append(styleLink);

  function petSvg(skinName) {
    const skin = skins[skinName] || skins.slime;
    const earMarkup = skinName === 'fox'
      ? `<path d="M8 14 9 3l8 8M24 11 31 3l1 12" fill="${skin.dark}"/><path d="m11 10 1-3 2 4m13-1 3-4v5" fill="${skin.light}"/>`
      : skinName === 'axolotl'
        ? `<path d="M7 16 2 10l2-4 5 6m20 4 5-6-2-4-6 6" fill="${skin.dark}"/><path d="m5 9 3 4m20 0 3-4" stroke="${skin.light}" stroke-width="2"/>`
        : '';
    const wings = skinName === 'bee'
      ? `<path d="M8 17 3 13l-2 5 7 4m19-5 5-4 2 5-7 4" fill="#dff5ff" opacity=".85"/>`
      : '';
    const bands = skinName === 'bee'
      ? `<path d="M9 22h19v4H8zM11 28h15v3H11z" fill="${skin.dark}"/>`
      : '';
    const face = `<rect x="11" y="20" width="4" height="5" fill="${skin.eyes}"/><rect x="23" y="20" width="4" height="5" fill="${skin.eyes}"/><rect x="17" y="28" width="4" height="2" fill="${skin.dark}"/><rect x="7" y="26" width="3" height="2" fill="${skin.light}"/><rect x="28" y="26" width="3" height="2" fill="${skin.light}"/>`;
    const body = skinName === 'slime'
      ? `<path d="M7 16h25v13l-3 5H10l-3-5z" fill="${skin.color}"/><path d="M10 30h3v3h14v-3h3v4H10z" fill="${skin.dark}"/><rect x="10" y="16" width="5" height="3" fill="${skin.light}" opacity=".8"/>`
      : `<rect x="7" y="15" width="25" height="17" rx="2" fill="${skin.color}"/><rect x="11" y="30" width="5" height="4" fill="${skin.dark}"/><rect x="24" y="30" width="5" height="4" fill="${skin.dark}"/>`;
    const extra = skinName === 'fox' ? `<path d="M27 29 34 32l-7 2" fill="${skin.light}"/>` : '';
    return `<svg viewBox="0 0 40 40" role="img" aria-label="${skin.label}" xmlns="http://www.w3.org/2000/svg">${wings}${earMarkup}${body}${bands}${extra}${face}</svg>`;
  }

  const toggle = document.createElement('button');
  toggle.id = 'minecordCompanionToggle';
  toggle.type = 'button';
  toggle.title = 'MineCord Companion';
  toggle.setAttribute('aria-label', 'Open MineCord Companion settings');
  toggle.textContent = '🐾';
  const userBar = document.querySelector('.userBar');
  const profile = document.getElementById('profileBtn');
  if (userBar && profile) userBar.insertBefore(toggle, profile);

  const widget = document.createElement('section');
  widget.id = 'minecordCompanion';
  widget.hidden = true;
  widget.setAttribute('aria-label', 'MineCord Companion');
  widget.innerHTML = `<div class="mc-pet-bubble" id="minecordPetBubble" role="status" aria-live="polite"></div><div class="mc-pet-card"><button class="mc-pet-art mc-pet-animation-idle" id="minecordPetArt" type="button" aria-label="Pet your companion"></button><span class="mc-pet-name" id="minecordPetName"></span></div><div id="minecordCompanionMenu" hidden><h3>Companion</h3><label class="mc-pet-field">Name<input id="minecordPetNameInput" type="text" maxlength="24" autocomplete="off"></label><label class="mc-pet-field">Appearance<select id="minecordPetSkin"><option value="slime">Moss Slime</option><option value="fox">Ember Fox</option><option value="bee">Honey Bee</option><option value="axolotl">Bubble Axolotl</option></select></label><label class="mc-pet-field">Animation<select id="minecordPetAnimation"><option value="idle">Idle</option><option value="walking">Walking</option><option value="sleeping">Sleeping</option><option value="happy">Happy</option><option value="excited">Excited</option><option value="playful">Playful</option></select></label><label><input id="minecordPetVisible" type="checkbox"> Show pet in MineCord</label><label><input id="minecordPetReactions" type="checkbox"> React to MineCord activity</label><label><input id="minecordPetAnimations" type="checkbox"> Enable animations</label><label id="minecordOverlayRow"><input id="minecordPetOverlay" type="checkbox"> Show small desktop pet</label><button id="minecordPetClose" type="button">Done</button></div>`;
  document.body.append(widget);

  function storageKey() { return `minecord.companion.v1.${accountId}`; }
  function save() {
    try { localStorage.setItem(storageKey(), JSON.stringify(preferences)); } catch {}
    channel?.postMessage({ type: 'state', state: { ...preferences, accountId } });
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null');
      preferences = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch { preferences = { ...defaults }; }
    preferences.name = String(preferences.name || 'Sprout').slice(0, 24);
    if (!skins[preferences.skin]) preferences.skin = 'slime';
    if (!animations.includes(preferences.animation)) preferences.animation = 'idle';
    render();
  }
  function setPosition() {
    if (overlayMode) return;
    const maxX = Math.max(4, innerWidth - widget.offsetWidth - 8);
    const maxY = Math.max(4, innerHeight - widget.offsetHeight - 8);
    if (!Number.isFinite(preferences.x)) preferences.x = maxX - 18;
    if (!Number.isFinite(preferences.y)) preferences.y = maxY - 78;
    preferences.x = Math.min(maxX, Math.max(4, preferences.x));
    preferences.y = Math.min(maxY, Math.max(4, preferences.y));
    widget.style.left = `${preferences.x}px`;
    widget.style.top = `${preferences.y}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }
  function render() {
    widget.hidden = !preferences.enabled;
    document.getElementById('minecordPetName').textContent = preferences.name;
    document.getElementById('minecordPetNameInput').value = preferences.name;
    document.getElementById('minecordPetSkin').value = preferences.skin;
    document.getElementById('minecordPetAnimation').value = preferences.animation;
    document.getElementById('minecordPetVisible').checked = preferences.enabled;
    document.getElementById('minecordPetReactions').checked = preferences.reactionsEnabled;
    document.getElementById('minecordPetAnimations').checked = preferences.animationsEnabled;
    document.getElementById('minecordPetOverlay').checked = preferences.overlayEnabled;
    document.getElementById('minecordPetArt').innerHTML = petSvg(preferences.skin);
    document.getElementById('minecordPetArt').setAttribute('aria-label', `Pet ${preferences.name}`);
    const animation = temporaryAnimation || preferences.animation;
    const art = document.getElementById('minecordPetArt');
    art.className = `mc-pet-art mc-pet-animation-${preferences.animationsEnabled ? animation : 'idle'}`;
    art.style.animationPlayState = document.visibilityState === 'visible' && preferences.animationsEnabled ? 'running' : 'paused';
    setPosition();
  }
  function bubble(text) {
    const node = document.getElementById('minecordPetBubble');
    node.textContent = text;
    node.classList.add('is-visible');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => node.classList.remove('is-visible'), 2300);
  }
  function react(kind) {
    if (!preferences.enabled || !preferences.reactionsEnabled) return;
    const choices = reactions[kind] || reactions.happy;
    const next = kind === 'missed' ? 'sleeping' : kind === 'invite' ? 'playful' : kind;
    temporaryAnimation = animations.includes(next) ? next : 'happy';
    render();
    bubble(choices[Math.floor(Math.random() * choices.length)]);
    clearTimeout(returnTimer);
    returnTimer = setTimeout(() => { temporaryAnimation = ''; render(); }, 2200);
  }
  function announce(kind) {
    const detail = { kind };
    window.dispatchEvent(new CustomEvent('minecord:pet-reaction', { detail }));
    channel?.postMessage({ type: 'reaction', kind });
  }

  function currentOnlineUsers() {
    return typeof online !== 'undefined' && Array.isArray(online) ? online : [];
  }

  function currentFriends() {
    return typeof friendsList !== 'undefined' && Array.isArray(friendsList) ? friendsList : [];
  }

  toggle.addEventListener('click', () => {
    const menu = document.getElementById('minecordCompanionMenu');
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      widget.hidden = false;
      document.getElementById('minecordPetNameInput').focus();
    } else if (!preferences.enabled && !preferences.overlayEnabled) {
      widget.hidden = true;
    }
  });
  document.getElementById('minecordPetClose').addEventListener('click', () => {
    document.getElementById('minecordCompanionMenu').hidden = true;
    if (!preferences.enabled && !preferences.overlayEnabled) widget.hidden = true;
  });
  document.getElementById('minecordPetNameInput').addEventListener('input', event => {
    preferences.name = event.target.value.trim().slice(0, 24) || 'Sprout'; save(); render();
  });
  document.getElementById('minecordPetSkin').addEventListener('change', event => { preferences.skin = event.target.value; save(); render(); });
  document.getElementById('minecordPetAnimation').addEventListener('change', event => { preferences.animation = event.target.value; temporaryAnimation = ''; save(); render(); });
  document.getElementById('minecordPetVisible').addEventListener('change', event => { preferences.enabled = event.target.checked; save(); render(); });
  document.getElementById('minecordPetReactions').addEventListener('change', event => { preferences.reactionsEnabled = event.target.checked; save(); render(); });
  document.getElementById('minecordPetAnimations').addEventListener('change', event => { preferences.animationsEnabled = event.target.checked; save(); render(); });
  document.getElementById('minecordPetOverlay').addEventListener('change', async event => {
    const row = document.getElementById('minecordOverlayRow');
    if (!window.__TAURI__?.core?.invoke) { event.target.checked = false; return; }
    try {
      await window.__TAURI__.core.invoke('set_companion_overlay', { visible: event.target.checked });
      preferences.overlayEnabled = event.target.checked;
      save();
    } catch (error) {
      event.target.checked = false;
      preferences.overlayEnabled = false;
      save();
      bubble(error?.message || 'Desktop pet is unavailable on this device.');
    }
    if (!window.__TAURI__ || /Android|iPhone|iPad/i.test(navigator.userAgent)) row.hidden = true;
  });
  document.getElementById('minecordPetArt').addEventListener('click', () => {
    temporaryAnimation = 'playful'; render(); bubble('Boop!');
    clearTimeout(returnTimer); returnTimer = setTimeout(() => { temporaryAnimation = ''; render(); }, 1600);
  });
  document.getElementById('minecordPetArt').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: preferences.x, y: preferences.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  document.getElementById('minecordPetArt').addEventListener('pointermove', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    preferences.x = dragging.x + event.clientX - dragging.startX;
    preferences.y = dragging.y + event.clientY - dragging.startY;
    setPosition();
  });
  document.getElementById('minecordPetArt').addEventListener('pointerup', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging = null; save();
  });
  window.addEventListener('resize', setPosition, { passive: true });
  document.addEventListener('visibilitychange', render);
  window.addEventListener('minecord:pet-reaction', event => react(event.detail?.kind));

  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('minecord-companion-v1');
    channel.onmessage = event => {
      const message = event.data;
      if (message?.type === 'reaction') react(message.kind);
      if (message?.type === 'overlay-ready') channel.postMessage({ type: 'state', state: { ...preferences, accountId } });
    };
  }

  const previousHandle = typeof window.handle === 'function' ? window.handle : null;
  if (previousHandle) {
    window.handle = function (message) {
      const oldOnline = new Set(currentOnlineUsers());
      const result = previousHandle.apply(this, arguments);
      if (message?.type === 'ready' && message.me?.id && String(message.me.id) !== accountId) {
        accountId = String(message.me.id);
        load();
      }
      if (message?.type === 'presence' || message?.type === 'ready') {
        const incoming = Array.isArray(message.online) ? message.online : [];
        const friends = new Set(currentFriends());
        if ([...incoming].some(name => !oldOnline.has(name) && friends.has(name))) announce('excited');
      }
      if (['message', 'dm', 'group_dm_message'].includes(message?.type)) {
        const author = message.message?.sender || message.message?.from || message.from || message.sender;
        if (author !== me?.username) announce('happy');
      }
      if (message?.type === 'incoming_call') announce('excited');
      if (message?.type === 'call_cancelled' && message.reason === 'timeout') announce('missed');
      if (message?.type === 'friend_request' || message?.type === 'friend_invite') announce('invite');
      return result;
    };
  }

  if (overlayMode) {
    const menu = document.getElementById('minecordCompanionMenu');
    menu.remove(); toggle.remove();
    widget.hidden = false;
    widget.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:grid;place-items:center;filter:none;';
    widget.querySelector('.mc-pet-card').style.cssText = 'border:0;background:transparent;filter:drop-shadow(0 3px 4px #0008);';
    widget.addEventListener('pointerdown', () => window.__TAURI__?.window?.getCurrentWindow?.().startDragging?.().catch?.(() => {}));
    if (channel) channel.postMessage({ type: 'overlay-ready' });
    channel?.addEventListener('message', event => {
      if (event.data?.type !== 'state') return;
      preferences = { ...defaults, ...event.data.state };
      preferences.enabled = Boolean(preferences.enabled || preferences.overlayEnabled);
      accountId = event.data.state.accountId || accountId;
      render();
      widget.hidden = false;
    });
    widget.addEventListener('click', () => channel?.postMessage({ type: 'reaction', kind: 'playful' }));
    widget.hidden = false;
  } else {
    const row = document.getElementById('minecordOverlayRow');
    if (!window.__TAURI__?.core?.invoke || /Android|iPhone|iPad/i.test(navigator.userAgent)) row.hidden = true;
    load();
  }
})();

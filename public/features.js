(() => {
  // Check edition - skip shop/cosmetics/onboarding/account-merge/admin in Lite edition
  if (window.MineCordEdition && window.MineCordEdition.isLite()) {
    console.log('[MineCord] Lite edition: skipping shop, cosmetics, onboarding, account merge, admin features');
    return;
  }

  const labels = {
    new_member: 'New Member',
    member: 'Member',
    developer: 'Developer',
    moderator: 'Moderator',
    administrator: 'Administrator',
    app_owner: 'App Owner'
  };
  const roleClass = role => `role-${labels[role] ? role : 'member'}`;
  const badge = role => `<span class="roleBadge ${roleClass(role)}">${esc(labels[role] || labels.member)}</span>`;
  const style = document.createElement('style');
  style.textContent = `
    .roleBadge{display:inline-flex;align-items:center;border:1px solid #5865f2;border-radius:999px;padding:1px 7px;color:#cdd0ff;background:#292b48;font-size:10px;font-weight:700;line-height:1.5;white-space:nowrap}
    .role-new_member{border-color:#60646c;color:#c2c6ce;background:#303238}.role-developer{border-color:#43b581;color:#93e4b5;background:#19382b}
    .role-moderator{border-color:#55a9ea;color:#9ad2ff;background:#183249}.role-administrator,.role-app_owner{border-color:#efaa56;color:#ffd09a;background:#3a2c1b}
    .featureModal{z-index:120}.featureCard{width:min(1040px,96vw);max-height:94vh;padding:0;overflow:hidden;display:flex;flex-direction:column}
    .featureHead{position:sticky;top:0;background:#1e1f22;border-bottom:1px solid #34363c;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:1}
    .featureBody{padding:20px 22px;overflow:auto}.shopBalance{display:flex;align-items:center;gap:10px;padding:12px 15px;border:1px solid #41444d;border-radius:10px;background:#25272d}
    .shopCoin{width:32px;height:32px;color:#f1c76e}.shopTabs,.shopCategories{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}
    .shopTabs button.selected,.shopCategories button.selected{background:#5865f2}.shopGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
    .shopItem{background:#25272d;border:1px solid #383a42;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
    .shopPreview{height:105px;display:grid;place-items:center;background:#313338;border-bottom:1px solid #3b3d45}
    .shopPreview svg{width:42px;height:42px;color:#fff;filter:drop-shadow(0 2px 5px #0008)}
    .shopItemBody{padding:14px;display:flex;flex-direction:column;gap:8px;flex:1}.shopItemBody p{margin:0;min-height:38px;line-height:1.45}
    .demoTag{font-size:10px;font-weight:800;letter-spacing:.08em;color:#f1c76e}.shopPrice{font-weight:700}
    .shopRows{display:grid;gap:8px}.shopRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-radius:7px;background:#25272d}
    .shopRow small{display:block;color:#b5bac1;margin-top:3px}.featureModal .card{width:min(480px,94vw)}
    .accountPanel{border-top:1px solid #3a3c43;margin-top:20px;padding-top:16px}.mergeGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .mergeGrid input,.mergeGrid select{width:100%;padding:10px;border:1px solid #4a4d53;background:#111214;color:#fff;border-radius:4px;margin:5px 0 12px}
    .mergePreview{padding:14px;margin-top:12px;border:1px solid #5865f2;border-radius:8px;background:#202234}.roleAudit{font-size:12px}
    @media(max-width:700px){.featureCard{width:100vw;height:100vh;max-height:100vh;border-radius:0}.featureHead,.featureBody{padding:14px}.mergeGrid{grid-template-columns:1fr}.shopGrid{grid-template-columns:repeat(auto-fill,minmax(165px,1fr))}.shopPreview{height:82px}}
  `;
  document.head.appendChild(style);

  document.querySelector('.iconSprite')?.insertAdjacentHTML('beforeend',
    '<symbol id="icon-shop" viewBox="0 0 24 24"><path d="M4 8h16l1 13H3L4 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3M8 13h.01M16 13h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>');

  const nav = document.createElement('div');
  nav.className = 'nav';
  nav.innerHTML = '<div class="navItem" id="shopNav" role="button" tabindex="0"><svg class="uiIcon"><use href="#icon-shop"></use></svg> Shop</div>';
  const sidePanel = document.querySelector('.side');
  const sideUserBar = document.querySelector('.side .userBar');
  if (sidePanel && sideUserBar) {
    const shopSection = document.createElement('div');
    shopSection.className = 'section';
    shopSection.textContent = 'SHOP';
    sidePanel.insertBefore(shopSection, sideUserBar);
    sidePanel.insertBefore(nav, sideUserBar);
  } else {
    $('dms').insertAdjacentElement('afterend', nav);
  }

  const shopModal = document.createElement('div');
  shopModal.id = 'shopModal';
  shopModal.className = 'modal featureModal hidden';
  shopModal.innerHTML = `
    <section class="card featureCard" role="dialog" aria-modal="true" aria-labelledby="shopTitle">
      <header class="featureHead"><div><h2 id="shopTitle" style="margin:0">MINECORD Shop</h2><div class="muted">Demo items only. Demo Credits have no real-world value.</div></div><button id="closeShop" aria-label="Close shop">Close</button></header>
      <div class="featureBody"><div id="shopStatus" class="muted" role="status">Loading shop…</div>
        <div id="shopContent" class="hidden"><div class="shopBalance"><svg class="shopCoin" aria-hidden="true"><use href="#icon-shop"></use></svg><div><b id="shopBalance"></b><div class="muted">TEST CURRENCY · NO REAL-WORLD VALUE</div></div></div>
          <div class="shopTabs" role="tablist"><button data-shop-tab="catalog" class="selected">Catalog</button><button data-shop-tab="inventory">My inventory</button><button data-shop-tab="transactions">Transactions</button></div>
          <div id="shopCategories" class="shopCategories" aria-label="Shop categories"></div><div id="shopView"></div>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(shopModal);

  const purchaseModal = document.createElement('div');
  purchaseModal.id = 'purchaseModal';
  purchaseModal.className = 'modal featureModal hidden';
  purchaseModal.innerHTML = `<section class="card" role="dialog" aria-modal="true" aria-labelledby="purchaseTitle"><h2 id="purchaseTitle">Confirm demo purchase</h2><p id="purchaseInfo"></p><p class="muted">This uses Demo Credits only. No real money, payment details, or real-world value are involved.</p><div class="row"><button id="cancelPurchase">Cancel</button><button id="confirmPurchase" class="primary">Confirm demo purchase</button></div><div id="purchaseStatus" class="muted" role="status"></div></section>`;
  document.body.appendChild(purchaseModal);

  const onboardingModal = document.createElement('div');
  onboardingModal.id = 'onboardingModal';
  onboardingModal.className = 'modal hidden';
  onboardingModal.innerHTML = `<section class="card" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle"><h2 id="onboardingTitle">Welcome to MINECORD</h2><p class="muted">Complete these steps to become a Member. New Members can explore, but shop purchases stay disabled until onboarding is done. You can reopen these steps any time from <b>Tips &amp; Guide</b>.</p><label for="onboardingDisplayName">Display name</label><input id="onboardingDisplayName" maxlength="32" autocomplete="nickname"><label class="row"><input id="onboardingGuidelines" type="checkbox" style="width:auto"> I agree to be respectful and follow community rules.</label><div class="row" style="flex-wrap:wrap;gap:8px"><button id="completeOnboarding" class="primary">Complete onboarding</button><button id="dismissOnboarding" class="secondary">Not now</button></div><p id="onboardingStatus" class="muted" role="status"></p></section>`;
  document.body.appendChild(onboardingModal);

  const shopState = { data: null, tab: 'catalog', category: 'All', selected: null };
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }
  const itemSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-user"></use></svg>';
  function safePreview(value) {
    return typeof value === 'string' && /^linear-gradient\([\w#%,. -]+\)$/.test(value) ? value : '#353840';
  }
  function showShopStatus(message, isError = false) {
    $('shopStatus').textContent = message;
    $('shopStatus').style.color = isError ? '#ff8a8a' : '';
    $('shopStatus').classList.toggle('hidden', !message);
  }
  async function loadShop() {
    showShopStatus('Loading shop…');
    $('shopContent').classList.add('hidden');
    try {
      shopState.data = await fetchJson('/api/shop');
      showShopStatus('');
      $('shopContent').classList.remove('hidden');
      renderShop();
    } catch (error) {
      showShopStatus(error.message, true);
    }
  }
  function renderShop() {
    const data = shopState.data;
    if (!data) return;
    $('shopBalance').textContent = data.unlimitedCredits ? `Unlimited ${data.currency.name} · owner entitlement` : `${data.balance.toLocaleString()} ${data.currency.name}`;
    document.querySelectorAll('[data-shop-tab]').forEach(button => button.classList.toggle('selected', button.dataset.shopTab === shopState.tab));
    const categories = ['All', ...new Set(data.catalog.map(item => item.category))];
    $('shopCategories').classList.toggle('hidden', shopState.tab !== 'catalog');
    $('shopCategories').innerHTML = categories.map(category => `<button data-category="${esc(category)}" class="${shopState.category === category ? 'selected' : ''}">${esc(category)}</button>`).join('');
    if (shopState.tab === 'catalog') {
      const owned = new Set(data.inventory.map(entry => entry.itemId));
      const items = data.catalog.filter(item => shopState.category === 'All' || item.category === shopState.category);
      $('shopView').innerHTML = items.length ? `<div class="shopGrid">${items.map(item => {
        const entry = data.inventory.find(ownedEntry => ownedEntry.itemId === item.id);
        const action = entry
          ? `<button class="secondary" data-equip="${esc(item.id)}" data-equipped="${entry.equipped}">${entry.equipped ? 'Unequip' : 'Equip'}</button>`
          : `<button class="primary" data-buy="${esc(item.id)}">Preview &amp; buy</button>`;
        return `<article class="shopItem"><div class="shopPreview" style="background:${safePreview(item.preview)}">${itemSvg}</div><div class="shopItemBody"><div class="demoTag">${entry ? 'OWNED COSMETIC' : 'DEMO COSMETIC'}</div><b>${esc(item.name)}</b><small class="muted">${esc(item.category)}</small><p class="muted">${esc(item.description)}</p><div class="row" style="justify-content:space-between;margin-top:auto"><span class="shopPrice">${item.price} ${esc(data.currency.name)}</span>${action}</div></div></article>`;
      }).join('')}</div>` : '<div class="empty">No demo items in this category.</div>';
    } else if (shopState.tab === 'inventory') {
      $('shopView').innerHTML = data.inventory.length ? `<div class="shopRows">${data.inventory.map(entry => `<div class="shopRow"><div><b>${esc(entry.item?.name || entry.itemId)}</b><small>${esc(entry.item?.category || 'Cosmetic')} · ${entry.equipped ? 'Equipped' : 'Not equipped'}</small></div><button data-equip="${esc(entry.itemId)}" data-equipped="${entry.equipped}">${entry.equipped ? 'Unequip' : 'Equip'}</button></div>`).join('')}</div>` : '<div class="empty">Your inventory is empty. Demo purchases appear here.</div>';
    } else {
      const rows = data.transactions;
      $('shopView').innerHTML = rows.length ? `<div class="shopRows">${rows.map(entry => `<div class="shopRow"><div><b>${entry.kind === 'demo_grant' ? 'One-time demo credit grant' : entry.kind === 'owner_purchase' ? `Owner purchase · ${esc(data.catalog.find(item => item.id === entry.itemId)?.name || entry.itemId)}` : `Demo purchase · ${esc(data.catalog.find(item => item.id === entry.itemId)?.name || entry.itemId)}`}</b><small>${new Date(entry.createdAt).toLocaleString()}</small></div><b>${entry.amount > 0 ? '+' : ''}${entry.amount} ${esc(data.currency.name)}</b></div>`).join('')}</div>` : '<div class="empty">No transactions yet.</div>';
    }
  }
  async function equipItem(itemId, equipped) {
    try {
      await fetchJson('/api/shop/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, equipped }) });
      await loadShop();
      applyEquippedCosmetics();
    } catch (error) {
      showShopStatus(error.message, true);
    }
  }
  function applyEquippedCosmetics() {
    if (!shopState.data) return;
    const equipped = shopState.data.inventory.filter(entry => entry.equipped);
    const ids = new Set(equipped.map(entry => entry.itemId));
    $('meAvatar').style.boxShadow = ids.has('demo-decoration-aurora') ? '0 0 0 3px #54ddeb,0 0 12px #5865f2' : ids.has('demo-decoration-ember') ? '0 0 0 3px #ff9a52,0 0 12px #d83c63' : '';
    $('meName').style.background = ids.has('demo-nameplate-neon') ? '#123a45' : ids.has('demo-nameplate-royal') ? '#30204f' : '';
    $('meName').style.padding = ids.has('demo-nameplate-neon') || ids.has('demo-nameplate-royal') ? '3px 7px' : '';
    $('meName').style.color = ids.has('demo-badge-stargazer') ? '#d8c7ff' : ids.has('demo-badge-builder') ? '#d7deea' : '';
    document.documentElement.style.setProperty('--blue', ids.has('demo-theme-forest') ? '#3b9b64' : ids.has('demo-theme-midnight') ? '#364b75' : '#5865f2');
    document.documentElement.dataset.cosmeticTheme = ids.has('demo-theme-forest') ? 'forest' : ids.has('demo-theme-midnight') ? 'midnight' : '';
    let cosmetics = $('profileCosmetics');
    if (!cosmetics) {
      cosmetics = document.createElement('div');
      cosmetics.id = 'profileCosmetics';
      cosmetics.className = 'muted';
      cosmetics.style.marginTop = '8px';
      $('settingsAvatar')?.parentElement?.appendChild(cosmetics);
    }
    const names = equipped.map(entry => shopState.data.catalog.find(item => item.id === entry.itemId)?.name).filter(Boolean);
    cosmetics.textContent = names.length ? `Equipped cosmetics: ${names.join(', ')}` : 'No cosmetics equipped.';
  }
  function preparePurchase(itemId) {
    const item = shopState.data?.catalog.find(entry => entry.id === itemId);
    if (!item) return;
    shopState.selected = item;
    $('purchaseInfo').textContent = shopState.data.unlimitedCredits
      ? `${item.name} is free for this owner account. You have unlimited Demo Credits.`
      : `${item.name} costs ${item.price} Demo Credits. Your current balance is ${shopState.data.balance}.`;
    $('purchaseStatus').textContent = '';
    show('purchaseModal');
  }
  async function confirmPurchase() {
    if (!shopState.selected) return;
    $('confirmPurchase').disabled = true;
    $('purchaseStatus').textContent = 'Processing demo purchase…';
    try {
      const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      await fetchJson('/api/shop/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: shopState.selected.id, idempotencyKey }) });
      show('purchaseModal', false);
      shopState.tab = 'inventory';
      await loadShop();
      showShopStatus('Demo cosmetic purchased and added to your inventory.');
    } catch (error) {
      $('purchaseStatus').textContent = error.message;
    } finally {
      $('confirmPurchase').disabled = false;
    }
  }
  $('shopNav').onclick = () => { show('shopModal'); loadShop(); };
  $('shopNav').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('shopNav').click(); } };
  $('closeShop').onclick = () => show('shopModal', false);
  $('cancelPurchase').onclick = () => show('purchaseModal', false);
  $('confirmPurchase').onclick = confirmPurchase;
  $('shopModal').addEventListener('click', event => {
    const tab = event.target.closest('[data-shop-tab]');
    const category = event.target.closest('[data-category]');
    const purchase = event.target.closest('[data-buy]');
    const equip = event.target.closest('[data-equip]');
    if (tab) { shopState.tab = tab.dataset.shopTab; renderShop(); }
    if (category) { shopState.category = category.dataset.category; renderShop(); }
    if (purchase) preparePurchase(purchase.dataset.buy);
    if (equip) equipItem(equip.dataset.equip, equip.dataset.equipped !== 'true');
  });

  $('completeOnboarding').onclick = async () => {
    $('completeOnboarding').disabled = true;
    $('onboardingStatus').textContent = 'Saving onboarding…';
    try {
      const result = await fetchJson('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedGuidelines: $('onboardingGuidelines').checked, displayName: $('onboardingDisplayName').value.trim() })
      });
      me = result.user;
      renderUser();
      show('onboardingModal', false);
    } catch (error) {
      $('onboardingStatus').textContent = error.message;
    } finally {
      $('completeOnboarding').disabled = false;
    }
  };
  $('dismissOnboarding').onclick = () => show('onboardingModal', false);

  const baseHandle = handle;
  handle = function (message) {
    if (message.type === 'ready') {
      memberProfiles = message.members || {};
      if (message.me) memberProfiles[message.me.username] = message.me;
      acceptedFriends = Array.isArray(message.friends) ? message.friends : [];
    } else if (message.type === 'presence' && message.members) {
      memberProfiles = { ...memberProfiles, ...message.members };
    } else if (message.type === 'profile' && message.me) {
      memberProfiles[message.me.username] = message.me;
    } else if (message.type === 'friend_profile' && message.user?.username) {
      memberProfiles[message.user.username] = message.user;
    } else if (message.type === 'friend_status' && message.status === 'accepted' && message.user) {
      if (!acceptedFriends.includes(message.user)) acceptedFriends = [...acceptedFriends, message.user].sort((a, b) => a.localeCompare(b));
    } else if (message.type === 'friend_status' && message.status === 'removed' && message.user) {
      acceptedFriends = acceptedFriends.filter(username => username !== message.user);
    }
    baseHandle(message);
    if (message.type === 'ready' || message.type === 'presence' || message.type === 'friend_status') renderFriends();
    if (message.type === 'friend_profile') {
      renderFriends();
      renderPeople();
    }
    if (message.type === 'ready') {
      loadShop().then(applyEquippedCosmetics).catch(() => {});
    }
    if (message.type === 'ready' && me?.role === 'new_member') {
      $('onboardingDisplayName').value = me.displayName || me.username;
      show('onboardingModal');
    }
  };
  let memberProfiles = {};
  let acceptedFriends = [];

  renderFriends = function () {
    const container = $('friendList');
    if (!container) return;
    container.replaceChildren();
    if (!acceptedFriends.length) {
      container.innerHTML = '<div class="muted" style="padding:8px">No friends yet.</div>';
      return;
    }
    for (const username of acceptedFriends) {
      const profile = memberProfiles[username] || { username, displayName: username };
      const isOnline = online.includes(username);
      const row = document.createElement('div');
      row.className = 'friendRow';
      row.dataset.user = username;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open conversation with ${profile.displayName || username}, ${isOnline ? 'online' : 'offline'}`);
      row.innerHTML = `<span class="dot ${isOnline ? 'on' : ''}"></span><span class="friendName">${esc(profile.displayName || username)}</span><span class="friendState">${isOnline ? 'Online' : 'Offline'}</span>`;
      row.addEventListener('click', () => openDM(username));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDM(username);
        }
      });
      const remove = document.createElement('button');
      remove.className = 'icon friendRemove';
      remove.type = 'button';
      remove.title = 'Remove friend';
      remove.setAttribute('aria-label', `Remove ${profile.displayName || username} from friends`);
      remove.innerHTML = '&times;';
      remove.addEventListener('click', event => {
        event.stopPropagation();
        showConfirm(`Remove ${profile.displayName || username} from your friends?`, 'Remove Friend').then(ok => {
          if (ok) send({ type: 'friend_remove', with: username });
        });
      });
      row.appendChild(remove);
      container.appendChild(row);
    }
  };

  renderPeople = function () {
    $('people').innerHTML = '';
    for (const username of online) {
      const profile = memberProfiles[username] || { username, role: 'member' };
      const row = document.createElement('div');
      row.className = 'person';
      row.dataset.user = username;
      if (username !== me?.username) row.onclick = () => openDM(username);
      const activity = activities[username];
      row.innerHTML = `<span class="dot on"></span><span class="personInfo"><span class="row" style="gap:5px">${esc(profile.displayName || username)}${username === me?.username ? ' (you)' : ''}${badge(profile.role)}</span>${activity ? `<span class="activityLine">${activityTitle(activity)}</span>` : ''}</span>`;
      $('people').appendChild(row);
    }
    if (!online.length) $('people').innerHTML = '<div class="muted" style="padding:10px">Nobody online.</div>';
    renderActivities();
  };
  addMessage = function (message) {
    const element = document.createElement('div');
    const profile = memberProfiles[message.from] || (message.from === me?.username ? me : { username: message.from, displayName: message.from });
    element.className = 'msg';
    if (message.id) element.dataset.messageId = message.id;
    const when = new Date(message.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const canDelete = Boolean(message.id && currentChannel?.type === 'text' && currentServer && typeof currentServerPerms === 'function' && currentServerPerms().manageMessages);
    element.innerHTML = `<div class="avatar">${avatar(profile)}</div><div class="msgBody"><div class="meta"><span class="name">${esc(profile.displayName || profile.username)}</span>${badge(message.role || profile.role)}<span class="time">${when}</span></div><div class="bubble">${esc(message.text || '')}${canDelete ? `<button type="button" class="msgDelete" onclick="deleteMessage('${esc(message.id)}')" title="Delete message" aria-label="Delete message" style="margin-left:8px;background:none;border:0;color:var(--muted);cursor:pointer;font-size:12px">Delete</button>` : ''}</div></div>`;
    $('messages').appendChild(element);
    $('messages').scrollTop = $('messages').scrollHeight;
  };
  window.deleteMessage = function (messageId) {
    if (!currentServer || !currentChannel || currentChannel.type !== 'text') return;
    send({ type: 'delete_message', scope: scope(), messageId });
  };
  const handleBeforeMessageDeletion = handle;
  handle = function (message) {
    handleBeforeMessageDeletion(message);
    if (message.type === 'message_deleted') {
      const node = [...document.querySelectorAll('#messages [data-message-id]')].find(item => item.dataset.messageId === message.messageId);
      if (node) node.remove();
    }
  };
  const baseRenderUser = renderUser;
  renderUser = function () {
    baseRenderUser();
    const container = $('settingsAvatar').parentElement;
    let roleBadge = document.getElementById('profileRoleBadge');
    if (!roleBadge) {
      roleBadge = document.createElement('div');
      roleBadge.id = 'profileRoleBadge';
      roleBadge.style.marginTop = '8px';
      container.appendChild(roleBadge);
    }
    roleBadge.innerHTML = badge(me?.role);
    if ($('onboardingDisplayName')) $('onboardingDisplayName').value = me?.displayName || me?.username || '';
    applyEquippedCosmetics();
  };

  const settingsCard = $('settingsModal').querySelector('.card');
  const accountsSection = document.createElement('section');
  accountsSection.id = 'accountsAndMergeSettings';
  accountsSection.className = 'accountPanel';
  accountsSection.innerHTML = `
    <h3>Accounts</h3><div id="mergeNotice" class="muted" role="status"></div>
    <h4>Merge two accounts you own</h4><p class="muted">First re-authenticate this destination account, then prove the source account with its password or a linked Google, Microsoft, or GitHub identity. Email matches alone are never accepted. Account merge is permanent.</p>
    <div class="mergeGrid"><div><label for="mergeTargetPassword">Destination account password</label><input id="mergeTargetPassword" type="password" autocomplete="current-password"><button id="verifyMergeTarget" class="primary">Re-authenticate destination</button></div>
    <div><label for="mergeProvider">OAuth provider for proof</label><select id="mergeProvider"><option value="google">Google</option><option value="microsoft">Microsoft</option><option value="github">GitHub</option></select><button id="verifyMergeTargetOAuth">Verify destination with OAuth</button></div></div>
    <div class="mergeGrid"><div><label for="mergeSourceUsername">Source MINECORD username</label><input id="mergeSourceUsername" maxlength="24" autocomplete="username"><label for="mergeSourcePassword">Source account password</label><input id="mergeSourcePassword" type="password" autocomplete="current-password"><button id="verifyMergeSource" class="primary">Verify source and preview</button></div>
    <div><label for="mergeSourceProvider">OAuth provider linked to source</label><select id="mergeSourceProvider"><option value="google">Google</option><option value="microsoft">Microsoft</option><option value="github">GitHub</option></select><button id="verifyMergeSourceOAuth">Verify source with OAuth</button></div></div>
    <div id="mergePreview" class="mergePreview hidden"></div>
    <h4>Merged DM archives</h4><div id="mergeArchives" class="muted">Conversation archives are loaded when you open Settings.</div>`;
  document.getElementById('ownerRoleSettings')?.remove();
  const ownerSection = document.createElement('section');
  ownerSection.id = 'ownerRoleSettingsV2';
  ownerSection.className = 'accountPanel';
  ownerSection.hidden = true;
  settingsCard.append(accountsSection, ownerSection);

  async function mergeRequest(url, body = {}) {
    return fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function verifyDestinationPassword() {
    try {
      await mergeRequest('/api/accounts/merge/target-password', { password: $('mergeTargetPassword').value });
      $('mergeTargetPassword').value = '';
      $('mergeNotice').textContent = 'Destination account re-authenticated. Proof expires in five minutes.';
    } catch (error) { $('mergeNotice').textContent = error.message; }
  }
  async function startMergeOAuth(endpoint, provider, extra = {}) {
    try {
      const result = await mergeRequest(endpoint, { provider, ...extra });
      location.href = result.authorizeUrl;
    } catch (error) { $('mergeNotice').textContent = error.message; }
  }
  function showMergePreview(token, summary) {
    const preview = $('mergePreview');
    const counts = summary.counts;
    preview.classList.remove('hidden');
    preview.innerHTML = `<h4>Review account merge</h4><p><b>Keep account:</b> ${esc(summary.destination.username)} (${esc(summary.destination.displayName)})</p><p><b>Merge from:</b> ${esc(summary.source.username)} (${esc(summary.source.displayName)})</p><p>Messages: ${counts.messages}; direct messages: ${counts.dmMessages}; friends/requests: ${counts.friends}; server memberships: ${counts.serverMemberships}; linked identities: ${counts.linkedIdentities}; shop cosmetics: ${counts.shopItems}; Demo Credits: ${counts.demoCredits}; purchase records: ${counts.purchaseRecords}.</p><b>Conflict decisions</b><ul>${summary.decisions.map(decision => `<li>${esc(decision)}</li>`).join('')}</ul>${summary.conflicts.length ? `<p><b>Profile conflicts (destination values stay):</b></p><ul>${summary.conflicts.map(conflict => `<li>${esc(conflict.field)}: keep destination; source value ${esc(conflict.sourceValue)}</li>`).join('')}</ul>` : '<p>No profile conflicts found.</p>'}<p class="muted">This operation invalidates existing sessions, preserves both accounts’ supported data, and cannot be undone from the app.</p><button id="confirmMerge" class="danger">Permanently merge these accounts</button>`;
    $('confirmMerge').onclick = async () => {
      if (!confirm(`Permanently merge ${summary.source.username} into ${summary.destination.username}? This cannot be undone.`)) return;
      $('confirmMerge').disabled = true;
      try {
        await mergeRequest('/api/accounts/merge/confirm', { token, confirm: true });
        location.assign('/app');
        location.reload();
      } catch (error) {
        $('mergeNotice').textContent = error.message;
        $('confirmMerge').disabled = false;
      }
    };
  }
  async function previewWithPassword() {
    try {
      const result = await mergeRequest('/api/accounts/merge/source-password', { username: $('mergeSourceUsername').value.trim(), password: $('mergeSourcePassword').value });
      $('mergeSourcePassword').value = '';
      showMergePreview(result.previewToken, result.preview);
      history.replaceState({}, '', '/app');
      $('mergeNotice').textContent = 'Both accounts verified. Review the merge preview before confirming.';
    } catch (error) { $('mergeNotice').textContent = error.message; }
  }
  $('verifyMergeTarget').onclick = verifyDestinationPassword;
  $('verifyMergeTargetOAuth').onclick = () => startMergeOAuth('/api/accounts/merge/target-oauth/start', $('mergeProvider').value);
  $('verifyMergeSourceOAuth').onclick = () => startMergeOAuth('/api/accounts/merge/source-oauth/start', $('mergeSourceProvider').value, { username: $('mergeSourceUsername').value.trim() });
  $('verifyMergeSource').onclick = previewWithPassword;

  async function loadMergeArchives() {
    if (!me) return;
    try {
      const result = await fetchJson('/api/accounts/merge/archives');
      $('mergeArchives').innerHTML = result.archives.length ? result.archives.map(archive => `<button class="shopRow" data-archive="${esc(archive.id)}">Conversation with ${esc(archive.sourceUsername)} · ${archive.messageCount} preserved messages</button>`).join('') : 'No merged conversation archives.';
    } catch (error) { $('mergeArchives').textContent = error.message; }
  }
  $('mergeArchives').addEventListener('click', async event => {
    const button = event.target.closest('[data-archive]');
    if (!button) return;
    try {
      const result = await fetchJson(`/api/accounts/merge/archives/${encodeURIComponent(button.dataset.archive)}`);
      const transcript = result.messages.map(message => `${message.from}: ${message.text}`).join('\n');
      alert(transcript || 'This merged conversation archive is empty.');
    } catch (error) { $('mergeNotice').textContent = error.message; }
  });

  async function refreshRoleAdmin() {
    const section = ownerSection;
    if (!section || !me) return;
    section.hidden = me.role !== 'app_owner';
    if (section.hidden) return;
    try {
      const [usersResult, auditResult, bansResult] = await Promise.all([
        fetchJson('/api/admin/users'),
        fetchJson('/api/admin/roles/audit'),
        fetchJson('/api/admin/bans')
      ]);
      const options = [['new_member', 'New Member'], ['member', 'Member'], ['developer', 'Developer'], ['moderator', 'Moderator'], ['administrator', 'Administrator']];
      section.innerHTML = `
        <h3>App Owner: account roles</h3>
        <p class="muted">Only the configured App Owner can change roles. Privileged roles require confirmation. App Owner can only be assigned through server configuration.</p>
        <div class="shopRows">${usersResult.users.map(user => `<div class="shopRow"><b>${esc(user.username)} · ${esc(user.roleLabel || labels[user.role])}</b>${user.role === 'app_owner' ? '<span class="muted">Configured owner</span>' : `<select data-role-user="${esc(user.username)}">${options.map(([value, label]) => `<option value="${value}"${user.role === value ? ' selected' : ''}>${label}</option>`).join('')}</select><button data-save-role="${esc(user.username)}">Save role</button>`}</div>`).join('')}</div>
        <h4>Recent role audit</h4>
        <div class="roleAudit">${auditResult.entries.length ? auditResult.entries.map(entry => `<div class="shopRow"><span>${esc(entry.account)}: ${esc(entry.previousRole)} → ${esc(entry.newRole)}<small>By ${esc(entry.actor)} · ${new Date(entry.createdAt).toLocaleString()}</small></span></div>`).join('') : '<p class="muted">No role changes have been recorded.</p>'}</div>
        <h4 style="margin-top:24px">Account bans</h4>
        <p class="muted">Use <code>/appban <username> <reason></code> or <code>/apptempban <username> <duration> <reason></code> via the command field below, or use the form.</p>
        <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;margin:8px 0;align-items:end">
          <input id="banUsername" placeholder="Username" style="max-width:200px">
          <input id="banDuration" placeholder="Duration (e.g. 1h, 7d)" style="max-width:140px" title="Leave empty for permanent ban. Format: 30m, 2h, 7d, 1w">
          <input id="banReason" placeholder="Reason" required style="min-width:200px;max-width:300px">
          <button id="banSubmit" class="danger">Ban</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin:8px 0;align-items:end">
          <input id="unbanUsername" placeholder="Username to unban" style="max-width:200px">
          <button id="unbanSubmit" class="secondary">Unban</button>
        </div>
        <h5>Active bans</h5>
        <div class="banList">${bansResult.active.length ? bansResult.active.map(ban => `<div class="shopRow"><b>${esc(ban.username)}</b><span class="muted">${ban.permanent ? 'Permanent' : `Expires ${new Date(ban.expiresAt).toLocaleString()}`} · ${esc(ban.reason)}</span><small>By ${esc(ban.byUsername)} · ${new Date(ban.createdAt).toLocaleString()}</small><button class="danger" data-unban="${esc(ban.username)}">Unban</button></div>`).join('') : '<p class="muted">No active bans.</p>'}</div>
        <h5 style="margin-top:12px">All bans (recent)</h5>
        <div class="banList">${bansResult.bans.length ? bansResult.bans.map(ban => `<div class="shopRow"><b>${esc(ban.username)}</b>${ban.active ? '' : '<span class="muted"> (revoked/expired)</span>'}<span class="muted">${ban.permanent ? 'Permanent' : ban.expiresAt ? `Expires ${new Date(ban.expiresAt).toLocaleString()}` : ''} · ${esc(ban.reason)}</span><small>By ${esc(ban.byUsername)} · ${new Date(ban.createdAt).toLocaleString()}${ban.revokedAt ? ` · Revoked by ${esc(ban.revokedByUsername)} · ${new Date(ban.revokedAt).toLocaleString()}` : ''}</small></div>`).join('') : '<p class="muted">No ban records.</p>'}</div>
      `;
      section.querySelectorAll('[data-save-role]').forEach(button => button.onclick = async () => {
        const username = button.dataset.saveRole;
        const select = section.querySelector(`[data-role-user="${CSS.escape(username)}"]`);
        const nextRole = select.value;
        const currentRole = usersResult.users.find(user => user.username === username)?.role;
        if (nextRole === currentRole) return;
        const isPrivilegedChange = ['developer', 'moderator', 'administrator'].includes(nextRole)
          || ['developer', 'moderator', 'administrator'].includes(currentRole);
        if (isPrivilegedChange && !confirm(`Change ${username} from ${labels[currentRole]} to ${labels[nextRole]}? This privileged change is recorded in the role audit.`)) return;
        try {
          await mergeRequest(`/api/admin/users/${encodeURIComponent(username)}/role`, { role: nextRole });
          await refreshRoleAdmin();
        } catch (error) { alert(error.message); }
      });
      section.querySelectorAll('[data-unban]').forEach(button => button.onclick = async () => {
        if (!confirm(`Unban ${button.dataset.unban}?`)) return;
        try {
          await fetchJson(`/api/admin/bans/${encodeURIComponent(button.dataset.unban)}`, { method: 'DELETE' });
          await refreshRoleAdmin();
        } catch (error) { alert(error.message); }
      });
      $('banSubmit').onclick = async () => {
        const username = $('banUsername').value.trim();
        const duration = $('banDuration').value.trim();
        const reason = $('banReason').value.trim();
        if (!username || !reason) return alert('Username and reason are required.');
        try {
          const body = { command: `/app${duration ? 'temp' : ''}ban ${username} ${duration ? duration + ' ' : ''}${reason}` };
          const res = await fetchJson('/api/admin/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          $('banUsername').value = '';
          $('banDuration').value = '';
          $('banReason').value = '';
          alert(res.action === 'unban' ? 'Unbanned.' : `${res.action} applied to ${res.username}.`);
          await refreshRoleAdmin();
        } catch (error) { alert(error.message); }
      };
      $('unbanSubmit').onclick = async () => {
        const username = $('unbanUsername').value.trim();
        if (!username) return alert('Username is required.');
        if (!confirm(`Unban ${username}?`)) return;
        try {
          await fetchJson(`/api/admin/bans/${encodeURIComponent(username)}`, { method: 'DELETE' });
          $('unbanUsername').value = '';
          alert('Unbanned.');
          await refreshRoleAdmin();
        } catch (error) { alert(error.message); }
      };
    } catch (error) {
      section.innerHTML = `<h3>App Owner: account roles</h3><p class="muted">${esc(error.message)}</p>`;
    }
  }
  $('profileBtn').addEventListener('click', () => {
    refreshRoleAdmin();
    loadMergeArchives();
  });

  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const mergeToken = hash.get('merge-preview');
  if (query.has('account_link') || query.has('account_link_error') || hash.has('merge-target-verified') || hash.has('merge-preview') || hash.has('merge-error')) {
    show('settingsModal');
    if (query.has('account_link')) $('accountLinkSettings')?.querySelector('#accountLinkError') && ($('accountLinkSettings').querySelector('#accountLinkError').textContent = 'Account linked successfully.');
    if (query.has('account_link_error')) $('accountLinkSettings')?.querySelector('#accountLinkError') && ($('accountLinkSettings').querySelector('#accountLinkError').textContent = 'Account linking failed. Verify provider setup and try again.');
    if (hash.has('merge-target-verified')) $('mergeNotice').textContent = 'Destination account re-authenticated. Now verify the source account.';
    if (hash.has('merge-error')) $('mergeNotice').textContent = `Merge verification failed: ${hash.get('merge-error').replaceAll('-', ' ')}.`;
    if (mergeToken) fetchJson(`/api/accounts/merge/preview/${encodeURIComponent(mergeToken)}`)
      .then(result => showMergePreview(mergeToken, result.preview))
      .catch(error => { $('mergeNotice').textContent = error.message; });
    history.replaceState({}, '', '/app');
  }
  if (me) {
    refreshRoleAdmin();
    loadMergeArchives();
    if (me.role === 'new_member') {
      $('onboardingDisplayName').value = me.displayName || me.username;
      show('onboardingModal');
    }
  }

  // ===== Worlds Tab =====
  let currentWorldsTab = 'my';
  async function switchWorldsTab(tab) {
    currentWorldsTab = tab;
    // Update sidebar tabs
    $('worldsTabMy').classList.toggle('active', tab === 'my');
    $('worldsTabFriends').classList.toggle('active', tab === 'friends');
    $('drawerWorldsTabMy').classList.toggle('active', tab === 'my');
    $('drawerWorldsTabFriends').classList.toggle('active', tab === 'friends');
    // Update worlds page tabs
    $('worldsPageTabMy').classList.toggle('active', tab === 'my');
    $('worldsPageTabFriends').classList.toggle('active', tab === 'friends');
    // Update worlds page tab styles
    if (tab === 'my') {
      $('worldsPageTabMy').style.background = 'var(--hover)';
      $('worldsPageTabMy').style.color = '#fff';
      $('worldsPageTabFriends').style.background = '';
      $('worldsPageTabFriends').style.color = 'var(--muted)';
    } else {
      $('worldsPageTabFriends').style.background = 'var(--hover)';
      $('worldsPageTabFriends').style.color = '#fff';
      $('worldsPageTabMy').style.background = '';
      $('worldsPageTabMy').style.color = 'var(--muted)';
    }
    await renderWorlds();
  }

  async function renderWorlds() {
    const container = $('worldsGrid') || $('worldsList') || $('drawerWorldsList');
    const emptyContainer = $('worldsEmpty');
    if (!container) return;

    container.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Loading worlds…</div>';
    if (emptyContainer) emptyContainer.style.display = 'none';

    try {
      const res = await fetchJson('/api/games/worlds/discover');
      const worlds = res.worlds || [];

      // Filter by current tab
      const filtered = worlds.filter(w => {
        if (currentWorldsTab === 'my') return w.owner === me.username;
        return w.owner !== me.username; // Friends' worlds
      });

      if (!filtered.length) {
        container.innerHTML = '';
        if (emptyContainer) {
          emptyContainer.innerHTML = currentWorldsTab === 'my'
            ? '<svg class="uiIcon" style="width:48px;height:48px;color:var(--muted);margin-bottom:16px;opacity:0.5"><use href="#icon-server"></use></svg><p>No worlds yet. Add a server in Settings → Games.</p>'
            : '<svg class="uiIcon" style="width:48px;height:48px;color:var(--muted);margin-bottom:16px;opacity:0.5"><use href="#icon-users"></use></svg><p>No shared worlds from friends yet.</p>';
          emptyContainer.style.display = 'block';
        }
        return;
      }

      if (emptyContainer) emptyContainer.style.display = 'none';

      container.innerHTML = filtered.map(w => {
        const isOwner = w.owner === me.username;
        const isShared = w.sharedFrom && w.sharedBy;
        const isSharedWithMe = w.sharedFrom && w.sharedBy === me.username;
        const edition = w.edition;
        const connectString = w.joinInfo?.connectString || (w.port ? `${w.address}:${w.port}` : w.address);
        const isEaglercraft = edition === 'eaglercraft';

        return `
          <article class="worldCard">
            <div class="worldCardHeader">
              <div class="worldCardTitle">
                <h3>${esc(w.name)}</h3>
                <span class="editionBadge ${edition}">${editionLabel(edition)}</span>
              </div>
              <span class="visibilityBadge ${w.visibility || 'private'}">${(w.visibility || 'private').charAt(0).toUpperCase() + (w.visibility || 'private').slice(1)}</span>
            </div>
            <div class="worldCardMeta">
              <div class="worldCardMetaRow">
                <span class="worldCardMetaLabel">Address:</span>
                <span class="worldCardMetaValue">${esc(w.address)}</span>
                <button class="copyBtn" onclick="copyToClipboard('${esc(w.address)}', 'IP address copied')" title="Copy IP"><svg class="uiIcon"><use href="#icon-copy"></use></svg></button>
              </div>
              ${w.port ? `
              <div class="worldCardMetaRow">
                <span class="worldCardMetaLabel">Port:</span>
                <span class="worldCardMetaValue">${esc(w.port)}</span>
                <button class="copyBtn" onclick="copyToClipboard('${esc(w.port)}', 'Port copied')" title="Copy Port"><svg class="uiIcon"><use href="#icon-copy"></use></svg></button>
              </div>
              ` : ''}
              <div class="worldCardMetaRow">
                <span class="worldCardMetaLabel">Full Address:</span>
                <span class="worldCardMetaValue">${esc(connectString)}</span>
                <button class="copyBtn" onclick="copyToClipboard('${esc(connectString)}', 'Full address copied')" title="Copy Full Address"><svg class="uiIcon"><use href="#icon-copy"></use></svg></button>
              </div>
            </div>
            <div class="worldCardOwner">
              <div class="avatar" style="width:24px;height:24px;font-size:12px">${avatar({username: w.owner, displayName: w.owner})}</div>
              <span>Owner: ${esc(w.owner)}${isSharedWithMe ? ' <span class="sharedBadge">Shared with you</span>' : ''}${isShared ? ' <span class="sharedBadge">Shared by ' + esc(w.sharedBy) + '</span>' : ''}</span>
            </div>
            <div class="worldCardJoinInfo">
              <div class="joinInstruction">${isEaglercraft ? 'Click to open in browser' : 'Copy the address above and use Direct Connect (Java) or Add Server (Bedrock)'}</div>
              <div class="connectString">
                ${esc(connectString)}
                <button class="copyBtn" onclick="copyToClipboard('${esc(connectString)}', 'Connection address copied')"><svg class="uiIcon"><use href="#icon-copy"></use></svg></button>
              </div>
            </div>
            <div class="worldCardActions">
              <button class="btn primary" onclick="${isEaglercraft ? `window.open('${esc(w.address)}', '_blank')` : `copyToClipboard('${esc(connectString)}', 'Connection address copied'); showJoinInstructions('${esc(edition)}')`}">${isEaglercraft ? 'Open in Browser' : 'Join'}</button>
              <button class="btn secondary" onclick="shareWorld('${esc(w.id)}')">Share</button>
            </div>
          </article>
        `;
      }).join('');

      // Add copy to clipboard functionality
      window.copyToClipboard = function(text, message) {
        navigator.clipboard.writeText(text).then(() => {
          // Show toast notification
          const toast = document.createElement('div');
          toast.textContent = message;
          toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--green);color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-weight:500';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 2000);
        }).catch(() => {});
      };

      window.showJoinInstructions = function(edition) {
        const instructions = {
          java: 'Copied! Paste into Minecraft Java Edition → Multiplayer → Direct Connect',
          bedrock: 'Copied! Paste into Minecraft Bedrock → Play → Servers → Add Server. Works on Nintendo Switch by entering address and port separately.'
        };
        alert(instructions[edition] || 'Copied!');
      };

      window.shareWorld = async function(serverId) {
        const username = prompt('Friend\'s MINECORD username?');
        if (!username) return;
        try {
          const res = await fetchJson('/api/games/servers/' + serverId + '/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
          });
          alert('World shared with ' + username + '!');
        } catch (e) {
          alert(e.message);
        }
      };
    } catch (e) {
      container.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Failed to load worlds: ' + esc(e.message) + '</div>';
    }
  }

  function editionLabel(edition) {
    const labels = { java: 'Java Edition', bedrock: 'Bedrock Edition', eaglercraft: 'Eaglercraft' };
    return labels[edition] || edition;
  }

  function showWorldsPage(on) {
    const worldsPage = $('worldsPage');
    const app = document.querySelector('.app');
    const homePage = $('homePage');
    if (worldsPage) {
      worldsPage.style.display = on ? 'flex' : 'none';
      if (on) {
        worldsPage.classList.add('visible');
      } else {
        worldsPage.classList.remove('visible');
      }
    }
    if (app) app.style.display = on ? 'none' : 'grid';
    if (homePage && !on) {
      homePage.style.display = 'none';
      homePage.classList.remove('visible');
      homePage.classList.add('hidden');
    }
  }

  function switchWorldsTab(tab) {
    currentWorldsTab = tab;
    // Update sidebar tabs
    $('worldsTabMy').classList.toggle('active', tab === 'my');
    $('worldsTabFriends').classList.toggle('active', tab === 'friends');
    $('drawerWorldsTabMy').classList.toggle('active', tab === 'my');
    $('drawerWorldsTabFriends').classList.toggle('active', tab === 'friends');
    // Update worlds page tabs
    $('worldsPageTabMy').classList.toggle('active', tab === 'my');
    $('worldsPageTabFriends').classList.toggle('active', tab === 'friends');
    // Update worlds page tab styles
    if (tab === 'my') {
      $('worldsPageTabMy').style.background = 'var(--hover)';
      $('worldsPageTabMy').style.color = '#fff';
      $('worldsPageTabFriends').style.background = '';
      $('worldsPageTabFriends').style.color = 'var(--muted)';
    } else {
      $('worldsPageTabFriends').style.background = 'var(--hover)';
      $('worldsPageTabFriends').style.color = '#fff';
      $('worldsPageTabMy').style.background = '';
      $('worldsPageTabMy').style.color = 'var(--muted)';
    }
    showWorldsPage(true);
    renderWorlds();
  }

  function showHome(on) {
    homeVisible = on;
    $('homePage').classList.toggle('visible', on);
    $('homePage').classList.toggle('hidden', !on);
    const app = document.querySelector('.app');
    if (app) {
      app.style.display = on ? 'none' : 'grid';
    }
    const homePage = $('homePage');
    if (homePage) {
      homePage.style.display = on ? 'flex' : 'none';
    }
  }

  // Expose navigation helpers used by inline HTML event handlers.
  window.showWorldsPage = showWorldsPage;
  window.switchWorldsTab = switchWorldsTab;
  window.renderWorlds = renderWorlds;
})();

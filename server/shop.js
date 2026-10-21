const CATALOG = Object.freeze([
  { id: 'demo-decoration-aurora', category: 'Profile Decorations', name: 'Aurora Frame', description: 'A shimmering demo frame for your profile portrait.', price: 180, preview: 'linear-gradient(135deg,#4dd0e1,#5865f2,#d06bff)', slot: 'decoration' },
  { id: 'demo-decoration-ember', category: 'Profile Decorations', name: 'Ember Frame', description: 'A warm, animated-look frame. Cosmetic preview only.', price: 160, preview: 'linear-gradient(135deg,#ff9a52,#d83c63,#6e3dcc)', slot: 'decoration' },
  { id: 'demo-nameplate-neon', category: 'Nameplates', name: 'Neon Nameplate', description: 'A bright cyan accent behind your display name.', price: 120, preview: 'linear-gradient(90deg,#122f45,#14c9d6)', slot: 'nameplate' },
  { id: 'demo-nameplate-royal', category: 'Nameplates', name: 'Royal Nameplate', description: 'A deep purple nameplate accent.', price: 140, preview: 'linear-gradient(90deg,#30204f,#a377ff)', slot: 'nameplate' },
  { id: 'demo-theme-midnight', category: 'Themes', name: 'Midnight Theme', description: 'A darker accent palette for your client profile.', price: 250, preview: 'linear-gradient(135deg,#101522,#364b75)', slot: 'theme' },
  { id: 'demo-theme-forest', category: 'Themes', name: 'Forest Theme', description: 'A calm green accent palette for your client profile.', price: 250, preview: 'linear-gradient(135deg,#12291f,#3b8059)', slot: 'theme' },
  { id: 'demo-badge-builder', category: 'Badges', name: 'Builder Badge', description: 'A profile flair badge. This does not grant permissions.', price: 90, preview: 'linear-gradient(135deg,#687386,#aeb6c4)', slot: 'badge' },
  { id: 'demo-badge-stargazer', category: 'Badges', name: 'Stargazer Badge', description: 'A starfield-inspired profile flair badge.', price: 110, preview: 'linear-gradient(135deg,#171b43,#a174fa)', slot: 'badge' }
]);
const CATALOG_BY_ID = new Map(CATALOG.map(item => [item.id, item]));
const DEMO_CURRENCY = Object.freeze({ id: 'demo_credits', name: 'Demo Credits', label: 'TEST CURRENCY · NO REAL-WORLD VALUE' });
const INITIAL_DEMO_CREDITS = 1000;

function initializeShop(data) {
  data.shop ||= { balances: {}, inventory: {}, transactions: [], idempotency: {}, demoGrants: {} };
  for (const key of ['balances', 'inventory', 'idempotency', 'demoGrants']) data.shop[key] ||= {};
  data.shop.transactions ||= [];
}

function shopRoutes(app, { data, save, requireAuth, originAllowed, createId, canUseShop, hasUnlimitedCredits = () => false }) {
  initializeShop(data);

  function grantDemoCredits(user) {
    const shop = data.shop;
    if (shop.demoGrants[user.id]) return;
    shop.balances[user.id] ||= 0;
    shop.balances[user.id] += INITIAL_DEMO_CREDITS;
    shop.demoGrants[user.id] = true;
    shop.transactions.push({
      id: createId('txn'),
      userId: user.id,
      itemId: DEMO_CURRENCY.id,
      amount: INITIAL_DEMO_CREDITS,
      kind: 'demo_grant',
      idempotencyKey: null,
      createdAt: Date.now()
    });
  }

  function persistShop(res, before) {
    try {
      save();
      return true;
    } catch (error) {
      data.shop = before;
      console.error('Shop transaction failed to persist:', error);
      res.status(500).json({ error: 'The shop operation could not be saved. No purchase was completed.' });
      return false;
    }
  }

  app.get('/api/shop', requireAuth, (req, res) => {
    const before = structuredClone(data.shop);
    grantDemoCredits(req.minecordUser);
    if (JSON.stringify(before) !== JSON.stringify(data.shop) && !persistShop(res, before)) return;
    const userId = req.minecordUser.id;
    const inventory = data.shop.inventory[userId] || [];
    res.json({
      currency: DEMO_CURRENCY,
      balance: data.shop.balances[userId] || 0,
      unlimitedCredits: hasUnlimitedCredits(req.minecordUser),
      catalog: CATALOG,
      inventory: inventory.map(entry => ({ ...entry, item: CATALOG_BY_ID.get(entry.itemId) || null })),
      transactions: data.shop.transactions.filter(entry => entry.userId === userId).slice(-100).reverse()
    });
  });

  app.post('/api/shop/purchase', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (!canUseShop(req.minecordUser)) return res.status(403).json({ error: 'Complete onboarding before buying or equipping cosmetics.' });
    const item = CATALOG_BY_ID.get(req.body?.itemId);
    const key = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
    if (!item) return res.status(400).json({ error: 'That catalog item is not available.' });
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return res.status(400).json({ error: 'A valid purchase confirmation key is required.' });

    const userId = req.minecordUser.id;
    const idempotencyKey = `${userId}:${key}`;
    const priorId = data.shop.idempotency[idempotencyKey];
    if (priorId) {
      const prior = data.shop.transactions.find(entry => entry.id === priorId);
      if (!prior) return res.status(409).json({ error: 'The purchase key has already been used.' });
      if (prior.itemId !== item.id) return res.status(409).json({ error: 'This purchase key was already used for a different item.' });
      return res.json({ transaction: prior, balance: data.shop.balances[userId] || 0, unlimitedCredits: hasUnlimitedCredits(req.minecordUser), replayed: true });
    }
    if ((data.shop.inventory[userId] || []).some(entry => entry.itemId === item.id)) {
      return res.status(409).json({ error: 'You already own this item.' });
    }
    const balance = data.shop.balances[userId] || 0;
    const unlimited = hasUnlimitedCredits(req.minecordUser);
    if (!unlimited && (!Number.isSafeInteger(balance) || balance < item.price)) {
      return res.status(400).json({ error: 'Not enough Demo Credits.' });
    }

    const before = structuredClone(data.shop);
    if (!unlimited) data.shop.balances[userId] = balance - item.price;
    data.shop.inventory[userId] ||= [];
    data.shop.inventory[userId].push({ itemId: item.id, equipped: false, ownedAt: Date.now() });
    const transaction = {
      id: createId('txn'),
      userId,
      itemId: item.id,
      amount: unlimited ? 0 : -item.price,
      kind: unlimited ? 'owner_purchase' : 'purchase',
      idempotencyKey: key,
      createdAt: Date.now()
    };
    data.shop.transactions.push(transaction);
    data.shop.idempotency[idempotencyKey] = transaction.id;
    if (!persistShop(res, before)) return;
    res.status(201).json({ transaction, balance: data.shop.balances[userId], unlimitedCredits: unlimited, replayed: false });
  });

  app.post('/api/shop/equip', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (!canUseShop(req.minecordUser)) return res.status(403).json({ error: 'Complete onboarding before buying or equipping cosmetics.' });
    const item = CATALOG_BY_ID.get(req.body?.itemId);
    const equipped = req.body?.equipped;
    if (!item || typeof equipped !== 'boolean') return res.status(400).json({ error: 'Choose an available cosmetic and an equip state.' });
    const userId = req.minecordUser.id;
    const inventory = data.shop.inventory[userId] || [];
    const owned = inventory.find(entry => entry.itemId === item.id);
    if (!owned) return res.status(403).json({ error: 'You must own this cosmetic before equipping it.' });
    const before = structuredClone(data.shop);
    for (const entry of inventory) {
      const other = CATALOG_BY_ID.get(entry.itemId);
      if (other?.slot === item.slot) entry.equipped = false;
    }
    owned.equipped = equipped;
    if (!persistShop(res, before)) return;
    res.json({ inventory: data.shop.inventory[userId] });
  });
}

module.exports = { CATALOG, DEMO_CURRENCY, INITIAL_DEMO_CREDITS, initializeShop, shopRoutes };

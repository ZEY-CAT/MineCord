const crypto = require('node:crypto');
const { oauthAccounts, findLinkedUser } = require('./account-links');
const SHOP_CATALOG = new Map(require('./shop').CATALOG.map(item => [item.id, item]));

const PROOF_LIFETIME = 5 * 60 * 1000;
const MERGE_ROLES = new Set(['role', 'onboardingCompletedAt']);
const AUTH_FIELDS = new Set(['id', 'username', 'passwordHash', 'passwordSalt', 'passwordCredentials', 'oauth', 'oauthAccounts', 'role', 'onboardingCompletedAt', 'createdAt']);

function sessionHash(req) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('mc_session='));
  if (!raw) return '';
  return crypto.createHash('sha256').update(decodeURIComponent(raw.slice('mc_session='.length))).digest('hex');
}

function ensureMergeState(data) {
  data.mergeProofs ||= {};
  data.mergePreviews ||= {};
  data.accountMergeAudit ||= [];
  data.mergedDmArchives ||= [];
  data.mergedUsernames ||= {};
}

function isRecentTargetProof(data, userId, currentSession) {
  const proof = data.mergeProofs[currentSession];
  return Boolean(proof && proof.userId === userId && proof.expiresAt > Date.now());
}

function previewFor(data, target, source) {
  const userKeys = new Set([target.username, source.username]);
  let messages = 0, dmMessages = 0;
  for (const [scope, entries] of Object.entries(data.messages || {})) {
    if (!Array.isArray(entries)) continue;
    const dmNames = scope.startsWith('dm:') ? scope.slice(3).split('::') : [];
    if (scope.startsWith('dm:') && dmNames.some(name => userKeys.has(name))) {
      messages += entries.length;
      dmMessages += entries.length;
    } else if (!scope.startsWith('dm:')) {
      messages += entries.filter(message => userKeys.has(message.from)).length;
    }
  }
  const servers = (data.servers || []).filter(server => server.members?.includes(source.username)).length;
  const friends = Object.values(data.friends || {}).filter(friend => friend.a === source.username || friend.b === source.username).length;
  const shop = data.shop || {};
  const inventory = shop.inventory?.[source.id] || [];
  const conflicts = [];
  if (source.displayName && target.displayName && source.displayName !== target.displayName) {
    conflicts.push({ field: 'displayName', choice: 'destination', sourceValue: source.displayName, destinationValue: target.displayName });
  }
  if (source.avatar && target.avatar && source.avatar !== target.avatar) {
    conflicts.push({ field: 'avatar', choice: 'destination', sourceValue: 'Source profile image', destinationValue: 'Destination profile image' });
  }
  if (source.minecraft && target.minecraft && source.minecraft.uuid !== target.minecraft.uuid) {
    conflicts.push({ field: 'minecraft', choice: 'destination', sourceValue: source.minecraft.username, destinationValue: target.minecraft.username });
  }
  return {
    destination: { username: target.username, displayName: target.displayName, role: target.role || 'member' },
    source: { username: source.username, displayName: source.displayName, role: source.role || 'member' },
    counts: {
      messages,
      dmMessages,
      friends,
      serverMemberships: servers,
      linkedIdentities: oauthAccounts(source).length,
      shopItems: inventory.length,
      demoCredits: shop.balances?.[source.id] || 0,
      purchaseRecords: (shop.transactions || []).filter(transaction => transaction.userId === source.id).length
    },
    conflicts,
    decisions: [
      'The destination username and role will be kept; the source username becomes a sign-in alias if it had a local password.',
      'The destination profile values win conflicts. Missing destination values are filled from the source.',
      'The source role is not transferred. Privileged roles remain under App Owner control.',
      'Messages from a conversation between these two accounts will be preserved in a private merged-conversation archive.',
      "The source account's activity pairing and connector token are revoked because they cannot be safely transferred; pair the extension again after merging if needed."
    ]
  };
}

function mergeData(data, targetId, sourceId, now, createId) {
  const next = structuredClone(data);
  ensureMergeState(next);
  const target = Object.values(next.users).find(user => user.id === targetId);
  const source = Object.values(next.users).find(user => user.id === sourceId);
  if (!target || !source || target.id === source.id) throw new Error('The merge accounts are no longer available.');
  if (source.mergedInto || target.mergedInto) throw new Error('An account that has already been merged cannot be merged again.');

  const sourceUsername = source.username, targetUsername = target.username;
  const identities = oauthAccounts(source);
  for (const identity of identities) {
    const linkedElsewhere = Object.values(next.users).some(user =>
      user.id !== targetId && user.id !== sourceId
      && oauthAccounts(user).some(account => account.provider === identity.provider && account.id === identity.id)
    );
    if (linkedElsewhere) {
      throw new Error('A linked provider identity belongs to another MINECORD account.');
    }
  }

  const targetAccounts = oauthAccounts(target);
  for (const identity of identities) {
    if (!targetAccounts.some(existing => existing.provider === identity.provider && existing.id === identity.id)) {
      targetAccounts.push(identity);
    }
  }
  target.oauthAccounts = targetAccounts;
  target.oauth = target.oauth || (targetAccounts[0] ? { provider: targetAccounts[0].provider, id: targetAccounts[0].id } : null);
  if (!target.passwordHash && source.passwordHash && source.passwordSalt) {
    target.passwordHash = source.passwordHash;
    target.passwordSalt = source.passwordSalt;
  } else if (source.passwordHash && source.passwordSalt
      && (source.passwordHash !== target.passwordHash || source.passwordSalt !== target.passwordSalt)) {
    target.passwordCredentials ||= [];
    target.passwordCredentials.push({ passwordHash: source.passwordHash, passwordSalt: source.passwordSalt });
  }
  for (const credential of source.passwordCredentials || []) {
    target.passwordCredentials ||= [];
    if (!target.passwordCredentials.some(existing => existing.passwordHash === credential.passwordHash && existing.passwordSalt === credential.passwordSalt)) {
      target.passwordCredentials.push(credential);
    }
  }

  for (const [key, value] of Object.entries(source)) {
    if (!AUTH_FIELDS.has(key) && (target[key] === undefined || target[key] === null || target[key] === '')) target[key] = value;
  }
  if (!target.minecraft && source.minecraft) target.minecraft = source.minecraft;
  else if (target.minecraft && source.minecraft && target.minecraft.uuid !== source.minecraft.uuid) {
    next.mergeProfileConflicts ||= [];
    next.mergeProfileConflicts.push({
      id: createId('profile-conflict'),
      userId: targetId,
      field: 'minecraft',
      preservedValue: source.minecraft,
      createdAt: now
    });
  }

  mergeFriends(next, sourceUsername, targetUsername);
  mergeServers(next, sourceUsername, targetUsername);
  mergeMessages(next, sourceUsername, targetUsername, targetId, now, createId);
  mergeReadCursors(next, sourceUsername, targetUsername);
  mergeActivities(next, sourceUsername, targetUsername);
  mergeInvites(next, sourceUsername, targetUsername);
  mergeShop(next, targetId, sourceId);
  next.mergedUsernames[sourceUsername.toLowerCase()] = targetUsername;
  delete next.users[sourceUsername];
  for (const [key, state] of Object.entries(next.oauthStates || {})) {
    if (state?.userId === sourceId || state?.targetUserId === sourceId || state?.sourceUserId === sourceId) delete next.oauthStates[key];
  }
  delete next.mergeProofs;
  delete next.mergePreviews;
  next.mergeProofs = {};
  next.mergePreviews = {};
  const audit = {
    id: createId('merge'),
    targetUserId: targetId,
    sourceUserId: sourceId,
    targetUsername,
    sourceUsername,
    actorUserId: targetId,
    createdAt: now,
    summary: { preserved: ['profile', 'linked identities', 'password sign-in methods', 'messages', 'friends', 'servers', 'shop inventory', 'wallet', 'purchase history'] }
  };
  next.accountMergeAudit.push(audit);
  return { state: next, audit };
}

function mergeFriends(data, sourceUsername, targetUsername) {
  const merged = new Map();
  for (const friendship of Object.values(data.friends || {})) {
    const a = friendship.a === sourceUsername ? targetUsername : friendship.a;
    const b = friendship.b === sourceUsername ? targetUsername : friendship.b;
    const by = friendship.by === sourceUsername ? targetUsername : friendship.by;
    if (!a || !b || a === b) continue;
    const [left, right] = [a, b].sort();
    const key = `${left}::${right}`;
    const current = merged.get(key);
    if (!current || friendship.status === 'accepted' && current.status !== 'accepted') {
      merged.set(key, { a: left, b: right, status: friendship.status, by });
    }
  }
  data.friends = Object.fromEntries(merged);
}

function mergeServers(data, sourceUsername, targetUsername) {
  for (const server of data.servers || []) {
    server.members = [...new Set((server.members || []).map(name => name === sourceUsername ? targetUsername : name))];
    if (server.owner === sourceUsername) server.owner = targetUsername;
  }
  for (const invite of Object.values(data.invites || {})) {
    if (invite.createdBy === sourceUsername) invite.createdBy = targetUsername;
  }
}

function mergeMessages(data, sourceUsername, targetUsername, targetId, now, createId) {
  const combined = {};
  const archives = [];
  for (const [scope, entries] of Object.entries(data.messages || {})) {
    const list = Array.isArray(entries) ? entries : [];
    if (scope.startsWith('dm:')) {
      const names = scope.slice(3).split('::');
      if (names.length === 2) {
        if (names.includes(sourceUsername) && names.includes(targetUsername)) {
          archives.push({
            id: createId('dm-archive'),
            ownerUserId: targetId,
            sourceUsername,
            destinationUsername: targetUsername,
            createdAt: now,
            messages: list.map(message => ({ ...message }))
          });
          continue;
        }
        const mappedNames = names.map(name => name === sourceUsername ? targetUsername : name).sort();
        const mappedScope = `dm:${mappedNames.join('::')}`;
        combined[mappedScope] ||= [];
        combined[mappedScope].push(...list.map(message => mapMessage(message, sourceUsername, targetUsername)));
        continue;
      }
    }
    combined[scope] = list.map(message => mapMessage(message, sourceUsername, targetUsername));
  }
  for (const [scope, entries] of Object.entries(combined)) {
    const unique = new Map();
    for (const message of entries) unique.set(message.id, message);
    combined[scope] = [...unique.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  data.messages = combined;
  data.mergedDmArchives.push(...archives);
}

function mapMessage(message, sourceUsername, targetUsername) {
  return {
    ...message,
    from: message.from === sourceUsername ? targetUsername : message.from,
    to: message.to === sourceUsername ? targetUsername : message.to
  };
}

function mergeReadCursors(data, sourceUsername, targetUsername) {
  const cursors = { ...(data.dmRead?.[targetUsername] || {}) };
  const sourceCursors = data.dmRead?.[sourceUsername] || {};
  for (const [oldScope, sourceCursor] of Object.entries(sourceCursors)) {
    const peer = oldScope.slice(3).split('::').find(name => name !== sourceUsername);
    if (!peer || peer === targetUsername) continue;
    const mapped = `dm:${[targetUsername, peer].sort().join('::')}`;
    const messages = data.messages[mapped] || [];
    const currentIndex = messages.findIndex(message => message.id === cursors[mapped]);
    const sourceIndex = messages.findIndex(message => message.id === sourceCursor);
    const indices = [currentIndex, sourceIndex].filter(index => index >= 0);
    if (indices.length) cursors[mapped] = messages[Math.min(...indices)].id;
  }
  data.dmRead ||= {};
  delete data.dmRead[sourceUsername];
  data.dmRead[targetUsername] = cursors;
}

function mergeActivities(data, sourceUsername, targetUsername) {
  data.gameActivities ||= {};
  const source = data.gameActivities[sourceUsername] || {};
  const target = data.gameActivities[targetUsername] || {};
  for (const [game, activity] of Object.entries(source)) {
    if (!target[game] || (activity.lastSeenAt || 0) > (target[game].lastSeenAt || 0)) target[game] = activity;
  }
  if (Object.keys(target).length) data.gameActivities[targetUsername] = target;
  delete data.gameActivities[sourceUsername];
}

function mergeInvites(data, sourceUsername, targetUsername) {
  for (const invite of Object.values(data.invites || {})) {
    if (invite.createdBy === sourceUsername) invite.createdBy = targetUsername;
  }
}

function mergeShop(data, targetId, sourceId) {
  data.shop ||= { balances: {}, inventory: {}, transactions: [], idempotency: {}, demoGrants: {} };
  const shop = data.shop;
  shop.balances ||= {};
  shop.inventory ||= {};
  shop.transactions ||= [];
  shop.idempotency ||= {};
  shop.demoGrants ||= {};
  shop.balances[targetId] = (shop.balances[targetId] || 0) + (shop.balances[sourceId] || 0);
  const targetItems = shop.inventory[targetId] || [];
  const itemIds = new Set(targetItems.map(item => item.itemId));
  const equippedSlots = new Set();
  for (const item of targetItems) {
    const slot = SHOP_CATALOG.get(item.itemId)?.slot;
    if (!item.equipped || !slot) continue;
    if (equippedSlots.has(slot)) item.equipped = false;
    else equippedSlots.add(slot);
  }
  for (const item of shop.inventory[sourceId] || []) {
    if (itemIds.has(item.itemId)) continue;
    const mergedItem = { ...item };
    const slot = SHOP_CATALOG.get(item.itemId)?.slot;
    if (mergedItem.equipped && slot && equippedSlots.has(slot)) mergedItem.equipped = false;
    if (mergedItem.equipped && slot) equippedSlots.add(slot);
    targetItems.push(mergedItem);
    itemIds.add(item.itemId);
  }
  shop.inventory[targetId] = targetItems;
  delete shop.balances[sourceId];
  delete shop.inventory[sourceId];
  if (shop.demoGrants[sourceId]) shop.demoGrants[targetId] = true;
  delete shop.demoGrants[sourceId];
  for (const transaction of shop.transactions) if (transaction.userId === sourceId) transaction.userId = targetId;
  for (const [key, transactionId] of Object.entries(shop.idempotency)) {
    if (key.startsWith(`${sourceId}:`)) {
      const newKey = `${targetId}:${key.slice(sourceId.length + 1)}`;
      if (!shop.idempotency[newKey]) shop.idempotency[newKey] = transactionId;
      delete shop.idempotency[key];
    }
  }
}

function mergeRoutes(app, context) {
  const { data, save, database, requireAuth, authUser, validPassword, originAllowed, createId, buildAuthorizationUrl, fetchIdentity, setSession, invalidateConnections } = context;
  ensureMergeState(data);

  app.post('/api/accounts/merge/target-password', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (!validPassword(req.body?.password, req.minecordUser)) return res.status(401).json({ error: 'Current account password was not verified.' });
    const currentSession = sessionHash(req);
    data.mergeProofs[currentSession] = { userId: req.minecordUser.id, expiresAt: Date.now() + PROOF_LIFETIME };
    save();
    res.json({ ok: true, expiresInSeconds: PROOF_LIFETIME / 1000 });
  });

  app.post('/api/accounts/merge/target-oauth/start', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    const provider = req.body?.provider;
    if (!['google', 'microsoft', 'github'].includes(provider)) return res.status(400).json({ error: 'Choose a supported sign-in provider.' });
    const prefix = provider.toUpperCase();
    if (!process.env[`${prefix}_CLIENT_ID`] || !process.env[`${prefix}_CLIENT_SECRET`]) return res.status(503).json({ error: `${provider} sign-in is not configured.` });
    const state = createId('merge-state');
    const createdAt = Date.now();
    database.createOAuthState(state, { purpose: 'merge-target-proof', provider, userId: req.minecordUser.id, sessionHash: sessionHash(req), createdAt }, createdAt + PROOF_LIFETIME);
    res.json({ authorizeUrl: buildAuthorizationUrl(provider, state, context.appUrl) });
  });

  app.post('/api/accounts/merge/source-oauth/start', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    const provider = req.body?.provider;
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    if (!['google', 'microsoft', 'github'].includes(provider)) return res.status(400).json({ error: 'Choose a supported sign-in provider.' });
    if (!isRecentTargetProof(data, req.minecordUser.id, sessionHash(req))) return res.status(401).json({ error: 'Re-authenticate the destination account before proving the source account.' });
    const source = Object.values(data.users).find(user => user.username.toLowerCase() === username);
    if (!source || source.id === req.minecordUser.id || source.id === context.ownerUserId || req.minecordUser.id === context.ownerUserId) return res.status(400).json({ error: 'Choose a different eligible account. The configured App Owner cannot be merged.' });
    const prefix = provider.toUpperCase();
    if (!process.env[`${prefix}_CLIENT_ID`] || !process.env[`${prefix}_CLIENT_SECRET`]) return res.status(503).json({ error: `${provider} sign-in is not configured.` });
    const state = createId('merge-state');
    const createdAt = Date.now();
    database.createOAuthState(state, {
      purpose: 'merge-source-proof',
      provider,
      targetUserId: req.minecordUser.id,
      sourceUserId: source.id,
      sessionHash: sessionHash(req),
      createdAt
    }, createdAt + PROOF_LIFETIME);
    res.json({ authorizeUrl: buildAuthorizationUrl(provider, state, context.appUrl) });
  });

  app.post('/api/accounts/merge/source-password', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (!isRecentTargetProof(data, req.minecordUser.id, sessionHash(req))) return res.status(401).json({ error: 'Re-authenticate the destination account before proving the source account.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const source = Object.values(data.users).find(user => user.username.toLowerCase() === username);
    if (!source || source.id === req.minecordUser.id || source.id === context.ownerUserId || req.minecordUser.id === context.ownerUserId) return res.status(400).json({ error: 'Choose a different eligible account. The configured App Owner cannot be merged.' });
    if (!validPassword(req.body?.password, source)) return res.status(401).json({ error: 'Source account password was not verified.' });
    try {
      const result = createPreview(data, req.minecordUser, source, sessionHash(req), createId);
      save();
      res.json(result);
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });

  app.get('/api/accounts/merge/preview/:token', requireAuth, (req, res) => {
    const preview = lookupPreview(data, req.params.token);
    if (!preview || preview.expiresAt <= Date.now()) return res.status(404).json({ error: 'The merge preview expired. Verify both accounts again.' });
    if (preview.targetUserId !== req.minecordUser.id || preview.sessionHash !== sessionHash(req)) return res.status(403).json({ error: 'This merge preview belongs to a different signed-in session.' });
    res.json({ preview: preview.summary });
  });

  app.post('/api/accounts/merge/confirm', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    const preview = lookupPreview(data, req.body?.token);
    if (!preview || preview.expiresAt <= Date.now()) return res.status(404).json({ error: 'The merge preview expired. Verify both accounts again.' });
    if (preview.targetUserId !== req.minecordUser.id || preview.sessionHash !== sessionHash(req)) return res.status(403).json({ error: 'This merge preview belongs to a different signed-in session.' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the preview before merging these accounts.' });
    if (!isRecentTargetProof(data, req.minecordUser.id, sessionHash(req))) return res.status(401).json({ error: 'Re-authenticate the destination account before merging.' });
    const target = req.minecordUser;
    const source = Object.values(data.users).find(user => user.id === preview.sourceUserId);
    if (!source || source.id === target.id || source.mergedInto) return res.status(409).json({ error: 'The source account is no longer eligible for merging.' });
    if (JSON.stringify(preview.summary) !== JSON.stringify(previewFor(data, target, source))) {
      return res.status(409).json({ error: 'Account data changed since the preview. Verify both accounts and review a new preview.' });
    }
    const before = structuredClone(data);
    let migration;
    try {
      migration = mergeData(data, target.id, source.id, Date.now(), createId);
      delete migration.state.mergeProofs[sessionHash(req)];
      migration.state.accountMergeAudit[migration.state.accountMergeAudit.length - 1].summary.preview = preview.summary;
      delete migration.state.mergePreviews[preview.tokenHash];
      database.writeState(migration.state, {
        deleteUserIds: [source.id],
        invalidateSessionUserIds: [target.id, source.id]
      });
    } catch (error) {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, before);
      console.error('Account merge transaction failed:', error);
      return res.status(500).json({ error: 'Account merge failed safely; no changes were applied.' });
    }

    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, migration.state);
    try {
      invalidateConnections([target.id, source.id], [target.username, source.username]);
      setSession(res, data.users[target.username]);
      return res.json({ ok: true, username: target.username, signInRequired: false });
    } catch (error) {
      console.error('Account merge committed but session refresh failed:', error);
      return res.status(500).json({ error: 'The accounts were merged, but your session could not be refreshed. Sign in again to continue.' });
    }
  });

  app.get('/api/accounts/merge/archives', requireAuth, (req, res) => {
    const archives = (data.mergedDmArchives || []).filter(archive => archive.ownerUserId === req.minecordUser.id);
    res.json({ archives: archives.map(archive => ({ id: archive.id, sourceUsername: archive.sourceUsername, messageCount: archive.messages.length, createdAt: archive.createdAt })) });
  });

  app.get('/api/accounts/merge/archives/:id', requireAuth, (req, res) => {
    const archive = (data.mergedDmArchives || []).find(entry => entry.id === req.params.id && entry.ownerUserId === req.minecordUser.id);
    if (!archive) return res.status(404).json({ error: 'Merged conversation archive not found.' });
    res.json({ messages: archive.messages });
  });

  app.use('/auth/:provider/callback', async (req, res, next) => {
    const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
    const pendingState = database.getOAuthState(stateKey);
    if (!pendingState?.purpose?.startsWith('merge-')) return next();
    const state = database.consumeOAuthState(stateKey);
    if (!state?.purpose?.startsWith('merge-')) return next();
    const provider = req.params.provider;
    if (state.provider !== provider) {
      return res.status(400).send('Account merge verification expired or did not match the provider.');
    }
    if (req.query.error) return res.redirect('/#merge-error=cancelled');
    if (typeof req.query.code !== 'string' || !req.query.code) return res.status(400).send('The identity provider did not return an authorization code.');
    const currentSession = sessionHash(req);
    const current = authUser(req);
    if (!current || current.id !== state.userId && current.id !== state.targetUserId
        || state.sessionHash !== currentSession) {
      return res.status(401).send('Sign in to the original destination account to finish merge verification.');
    }
    try {
      const identity = await fetchIdentity(provider, req.query.code, context.appUrl);
      const identityUser = findLinkedUser(data.users, provider, identity.id);
      if (state.purpose === 'merge-target-proof') {
        if (!identityUser || identityUser.id !== state.userId) return res.redirect('/#merge-error=target-proof-failed');
        data.mergeProofs ||= {};
        data.mergeProofs[currentSession] = { userId: state.userId, expiresAt: Date.now() + PROOF_LIFETIME };
        save();
        return res.redirect('/#merge-target-verified');
      }
      if (state.purpose === 'merge-source-proof') {
        if (!identityUser || identityUser.id !== state.sourceUserId) return res.redirect('/#merge-error=source-proof-failed');
        const target = Object.values(data.users).find(user => user.id === state.targetUserId);
        const source = identityUser;
        if (!target || source.id === target.id || source.id === context.ownerUserId || target.id === context.ownerUserId || !isRecentTargetProof(data, target.id, currentSession)) return res.redirect('/#merge-error=proof-expired');
        const result = createPreview(data, target, source, currentSession, createId);
        save();
        return res.redirect(`/#merge-preview=${encodeURIComponent(result.previewToken)}`);
      }
      return next();
    } catch (error) {
      console.error('Account merge identity verification failed:', error);
      return res.redirect('/#merge-error=provider-failed');
    }
  });
}

function createPreview(data, target, source, currentSession, createId) {
  if (target.id === source.id || source.mergedInto || target.mergedInto) throw new Error('These accounts cannot be merged.');
  const hasIdentityConflict = oauthAccounts(source).some(identity => Object.values(data.users).some(user =>
    user.id !== source.id && user.id !== target.id
    && oauthAccounts(user).some(account => account.provider === identity.provider && account.id === identity.id)
  ));
  if (hasIdentityConflict) throw new Error('A provider identity is already attached to a different account.');
  const previewToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(previewToken).digest('hex');
  const summary = previewFor(data, target, source);
  const preview = {
    tokenHash,
    targetUserId: target.id,
    sourceUserId: source.id,
    sessionHash: currentSession,
    expiresAt: Date.now() + PROOF_LIFETIME,
    summary
  };
  data.mergePreviews ||= {};
  data.mergePreviews[tokenHash] = preview;
  return { previewToken, preview: summary };
}

function lookupPreview(data, token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const preview = data.mergePreviews?.[tokenHash];
  return preview ? { ...preview, tokenHash } : null;
}

module.exports = { ensureMergeState, mergeData, mergeRoutes, previewFor, sessionHash };

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function databasePath() {
  const configured = process.env.DATABASE_URL;
  if (!configured) return path.join(__dirname, 'minecord.sqlite');
  if (configured.startsWith('sqlite:///')) return path.resolve(configured.slice('sqlite:///'.length));
  if (/^[a-z]+:\/\//i.test(configured)) {
    throw new Error('DATABASE_URL must be a SQLite file path or sqlite:/// URL.');
  }
  return path.resolve(configured);
}

const dbFile = databasePath();
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '', minecraft TEXT, show_game_activity INTEGER NOT NULL DEFAULT 1,
    role TEXT NOT NULL DEFAULT 'member', onboarding_completed_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (provider, provider_id)
  );
  CREATE TABLE IF NOT EXISTS friends (
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL, requested_by TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (user_a, user_b), CHECK (user_a < user_b)
  );
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', owner_id TEXT
  );
  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
    PRIMARY KEY (server_id, id)
  );
  CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id),
    server_id TEXT, channel_id TEXT, conversation_id TEXT REFERENCES conversations(id),
    text TEXT NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY (server_id, channel_id) REFERENCES channels(server_id, id),
    CHECK ((conversation_id IS NOT NULL AND server_id IS NULL AND channel_id IS NULL)
        OR (conversation_id IS NULL AND server_id IS NOT NULL AND channel_id IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS messages_channel_time ON messages(server_id, channel_id, created_at);
  CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(conversation_id, created_at);
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id),
    created_by TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_activity (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL,
    started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, source TEXT NOT NULL,
    player_name TEXT, server_name TEXT, PRIMARY KEY(user_id, game)
  );
  CREATE TABLE IF NOT EXISTS activity_pairings (
    code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metered_turn_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE, api_key TEXT NOT NULL,
    ice_servers TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS role_audit (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    previous_role TEXT NOT NULL, new_role TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_servers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition TEXT NOT NULL CHECK (edition IN ('java', 'bedrock', 'eaglercraft')),
    name TEXT NOT NULL, address TEXT NOT NULL, port INTEGER,
    notes TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_accounts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition TEXT NOT NULL CHECK (edition IN ('java', 'bedrock', 'eaglercraft')),
    username TEXT NOT NULL, uuid TEXT, xuid TEXT, raw_data TEXT,
    linked_at INTEGER NOT NULL, PRIMARY KEY (user_id, edition)
  );
  CREATE TABLE IF NOT EXISTS eaglercraft_links (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL, validated INTEGER NOT NULL DEFAULT 0,
    last_checked INTEGER, created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, url)
  );
  CREATE TABLE IF NOT EXISTS shop_wallets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL CHECK (balance >= 0)
  );
  CREATE TABLE IF NOT EXISTS shop_inventory (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, equipped INTEGER NOT NULL DEFAULT 0, owned_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS shop_transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL,
    idempotency_key TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_merge_audit (
    id TEXT PRIMARY KEY, target_user_id TEXT NOT NULL, source_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, summary TEXT NOT NULL
  );
`);
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('show_game_activity')) {
  db.exec('ALTER TABLE users ADD COLUMN show_game_activity INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
}
if (!userColumns.includes('onboarding_completed_at')) {
  db.exec('ALTER TABLE users ADD COLUMN onboarding_completed_at INTEGER');
}

function run(sql, ...values) {
  return db.prepare(sql).run(...values);
}

function writeState(state, options = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    run('INSERT INTO app_state(id, value) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value', JSON.stringify(state));
    for (const table of ['messages', 'conversation_members', 'conversations', 'channels', 'server_members', 'invites', 'friends', 'oauth_identities', 'game_activity', 'role_audit', 'shop_transactions', 'shop_inventory', 'shop_wallets', 'account_merge_audit', 'game_servers', 'game_accounts', 'eaglercraft_links', 'servers']) {
      db.exec(`DELETE FROM ${table}`);
    }
    const invalidated = [...new Set(options.invalidateSessionUserIds || [])];
    for (const userId of invalidated) run('DELETE FROM sessions WHERE user_id = ?', userId);
    const deleteUserIds = [...new Set(options.deleteUserIds || [])];
    for (const userId of deleteUserIds) run('DELETE FROM activity_pairings WHERE user_id = ?', userId);
    for (const userId of deleteUserIds) run('DELETE FROM activity_tokens WHERE user_id = ?', userId);
    for (const userId of deleteUserIds) run('DELETE FROM users WHERE id = ?', userId);

    const userIds = new Map();
    const insertUser = db.prepare(`INSERT INTO users(id, username, display_name, avatar, minecraft, show_game_activity, role, onboarding_completed_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
      avatar = excluded.avatar, minecraft = excluded.minecraft,
      show_game_activity = excluded.show_game_activity, role = excluded.role,
      onboarding_completed_at = excluded.onboarding_completed_at`);
    const insertIdentity = db.prepare('INSERT OR IGNORE INTO oauth_identities(provider, provider_id, user_id) VALUES(?, ?, ?)');
    for (const [username, user] of Object.entries(state.users || {})) {
      if (!user || typeof user.id !== 'string') continue;
      userIds.set(username, user.id);
      const role = ['new_member', 'member', 'developer', 'moderator', 'administrator', 'app_owner'].includes(user.role) ? user.role : 'member';
      insertUser.run(user.id, username, String(user.displayName || username), String(user.avatar || ''), user.minecraft ? JSON.stringify(user.minecraft) : null, user.showGameActivity === false ? 0 : 1, role, Number(user.onboardingCompletedAt) || null, Number(user.createdAt) || Date.now());
      const identities = Array.isArray(user.oauthAccounts) ? user.oauthAccounts : [];
      for (const identity of identities) {
        if (identity?.provider && identity?.id) insertIdentity.run(identity.provider, String(identity.id), user.id);
      }
      if (user.oauth?.provider && user.oauth?.id) insertIdentity.run(user.oauth.provider, String(user.oauth.id), user.id);
    }

    const insertGameActivity = db.prepare(`INSERT INTO game_activity(user_id, game, started_at, last_seen_at, source, player_name, server_name)
      VALUES(?, ?, ?, ?, ?, ?, ?)`);
    for (const [username, activities] of Object.entries(state.gameActivities || {})) {
      const userId = userIds.get(username);
      if (!userId || !activities || typeof activities !== 'object') continue;
      for (const [game, activity] of Object.entries(activities)) {
        if (!['java', 'bedrock', 'eaglercraft'].includes(game) || !activity || !Number.isFinite(activity.startedAt) || !Number.isFinite(activity.lastSeenAt)) continue;
        insertGameActivity.run(userId, game, activity.startedAt, activity.lastSeenAt, String(activity.source || game), activity.playerName || null, activity.serverName || null);
      }
    }

    const insertServer = db.prepare('INSERT INTO servers(id, name, icon, owner_id) VALUES(?, ?, ?, ?)');
    const insertMember = db.prepare('INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?)');
    const insertChannel = db.prepare('INSERT OR IGNORE INTO channels(server_id, id, name, type) VALUES(?, ?, ?, ?)');
    for (const server of state.servers || []) {
      if (!server?.id) continue;
      insertServer.run(String(server.id), String(server.name || 'Server'), String(server.icon || ''), userIds.get(server.owner) || null);
      for (const member of server.members || []) {
        const userId = userIds.get(member);
        if (userId) insertMember.run(server.id, userId);
      }
      for (const channel of server.channels || []) {
        if (channel?.id) insertChannel.run(server.id, String(channel.id), String(channel.name || 'channel'), channel.type === 'voice' ? 'voice' : 'text');
      }
    }

    const friendInsert = db.prepare('INSERT OR REPLACE INTO friends(user_a, user_b, status, requested_by) VALUES(?, ?, ?, ?)');
    for (const friendship of Object.values(state.friends || {})) {
      const a = userIds.get(friendship?.a), b = userIds.get(friendship?.b), requester = userIds.get(friendship?.by);
      if (a && b && requester && a !== b) friendInsert.run(a < b ? a : b, a < b ? b : a, friendship.status === 'accepted' ? 'accepted' : 'pending', requester);
    }

    const conversationInsert = db.prepare('INSERT OR IGNORE INTO conversations(id, created_at) VALUES(?, ?)');
    const conversationMemberInsert = db.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id, user_id) VALUES(?, ?)');
    const messageInsert = db.prepare('INSERT OR IGNORE INTO messages(id, sender_id, server_id, channel_id, conversation_id, text, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)');
    for (const [scope, entries] of Object.entries(state.messages || {})) {
      const isDm = scope.startsWith('dm:');
      let conversationId = null, serverId = null, channelId = null;
      if (isDm) {
        conversationId = scope;
        const names = scope.slice(3).split('::');
        const a = userIds.get(names[0]), b = userIds.get(names[1]);
        if (!a || !b || a === b) continue;
        conversationInsert.run(conversationId, Date.now());
        conversationMemberInsert.run(conversationId, a);
        conversationMemberInsert.run(conversationId, b);
      } else {
        const separator = scope.indexOf(':');
        if (separator < 1) continue;
        serverId = scope.slice(0, separator);
        channelId = scope.slice(separator + 1);
        if (!db.prepare('SELECT 1 FROM channels WHERE server_id = ? AND id = ?').get(serverId, channelId)) continue;
      }
      for (const message of entries || []) {
        const senderId = userIds.get(message?.from);
        if (!senderId || typeof message?.text !== 'string') continue;
        messageInsert.run(String(message.id || `legacy-${Date.now()}`), senderId, serverId, channelId, conversationId, message.text, Number(message.at) || Date.now());
      }
    }

    const inviteInsert = db.prepare('INSERT OR IGNORE INTO invites(code, server_id, created_by, expires) VALUES(?, ?, ?, ?)');
    for (const [code, invite] of Object.entries(state.invites || {})) {
      if (invite?.serverId && db.prepare('SELECT 1 FROM servers WHERE id = ?').get(invite.serverId) && userIds.has(invite.createdBy)) {
        inviteInsert.run(code, invite.serverId, userIds.get(invite.createdBy), Number(invite.expires) || 0);
      }
    }
    const insertRoleAudit = db.prepare('INSERT INTO role_audit(id, account_id, actor_id, previous_role, new_role, created_at) VALUES(?, ?, ?, ?, ?, ?)');
    for (const entry of state.roleAudit || []) {
      if (entry?.id && entry.accountId && entry.actorId && entry.previousRole && entry.newRole && Number.isFinite(entry.createdAt)) {
        insertRoleAudit.run(entry.id, entry.accountId, entry.actorId, entry.previousRole, entry.newRole, entry.createdAt);
      }
    }
    const insertWallet = db.prepare('INSERT INTO shop_wallets(user_id, balance) VALUES(?, ?)');
    const insertInventoryItem = db.prepare('INSERT INTO shop_inventory(user_id, item_id, equipped, owned_at) VALUES(?, ?, ?, ?)');
    const insertTransaction = db.prepare('INSERT INTO shop_transactions(id, user_id, item_id, amount, kind, idempotency_key, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)');
    for (const [userId, balance] of Object.entries(state.shop?.balances || {})) {
      if (userIdsHasValue(userIds, userId) && Number.isSafeInteger(balance) && balance >= 0) insertWallet.run(userId, balance);
    }
    for (const [userId, entries] of Object.entries(state.shop?.inventory || {})) {
      if (!userIdsHasValue(userIds, userId) || !Array.isArray(entries)) continue;
      for (const item of entries) {
        if (typeof item?.itemId === 'string' && Number.isFinite(item.ownedAt)) {
          insertInventoryItem.run(userId, item.itemId, item.equipped ? 1 : 0, item.ownedAt);
        }
      }
    }
    for (const transaction of state.shop?.transactions || []) {
      if (transaction?.id && userIdsHasValue(userIds, transaction.userId) && Number.isSafeInteger(transaction.amount) && Number.isFinite(transaction.createdAt)) {
        insertTransaction.run(transaction.id, transaction.userId, String(transaction.itemId || ''), transaction.amount, String(transaction.kind || 'purchase'), transaction.idempotencyKey || null, transaction.createdAt);
      }
    }
    const insertMergeAudit = db.prepare('INSERT INTO account_merge_audit(id, target_user_id, source_user_id, created_at, summary) VALUES(?, ?, ?, ?, ?)');
    for (const entry of state.accountMergeAudit || []) {
      if (entry?.id && entry.targetUserId && entry.sourceUserId && Number.isFinite(entry.createdAt)) {
        insertMergeAudit.run(entry.id, entry.targetUserId, entry.sourceUserId, entry.createdAt, JSON.stringify(entry.summary || {}));
      }
    }

    // Game servers
    const insertGameServer = db.prepare('INSERT INTO game_servers(id, user_id, edition, name, address, port, notes, favorite, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const gs of state.gameServers || []) {
      const userId = userIds.get(gs?.owner);
      if (userId && gs?.id && ['java', 'bedrock', 'eaglercraft'].includes(gs.edition) && gs?.name && gs?.address) {
        insertGameServer.run(gs.id, userId, gs.edition, gs.name, gs.address, gs.port || null, gs.notes || null, gs.favorite ? 1 : 0, Number(gs.createdAt) || Date.now(), Number(gs.updatedAt) || Date.now());
      }
    }

    // Game accounts
    const insertGameAccount = db.prepare('INSERT INTO game_accounts(user_id, edition, username, uuid, xuid, raw_data, linked_at) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, edition) DO UPDATE SET username=excluded.username, uuid=excluded.uuid, xuid=excluded.xuid, raw_data=excluded.raw_data, linked_at=excluded.linked_at');
    for (const ga of state.gameAccounts || []) {
      const userId = userIds.get(ga?.owner);
      if (userId && ['java', 'bedrock', 'eaglercraft'].includes(ga?.edition) && ga?.username) {
        insertGameAccount.run(userId, ga.edition, ga.username, ga.uuid || null, ga.xuid || null, ga.rawData || null, Number(ga.linkedAt) || Date.now());
      }
    }

    // Eaglercraft links
    const insertEaglercraftLink = db.prepare('INSERT INTO eaglercraft_links(user_id, url, validated, last_checked, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(user_id, url) DO UPDATE SET validated=excluded.validated, last_checked=excluded.last_checked');
    for (const el of state.eaglercraftLinks || []) {
      const userId = userIds.get(el?.owner);
      if (userId && el?.url) {
        insertEaglercraftLink.run(userId, el.url, el.validated ? 1 : 0, el.lastChecked || null, Number(el.createdAt) || Date.now());
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  function userIdsHasValue(userIds, value) {
    for (const userId of userIds.values()) if (userId === value) return true;
    return false;
  }
}

function loadState(legacyFile, fallback) {
  const saved = db.prepare('SELECT value FROM app_state WHERE id = 1').get();
  let state;
  if (saved) {
    state = JSON.parse(saved.value);
  } else {
    state = fallback;
    if (fs.existsSync(legacyFile)) {
      state = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      for (const key of Object.keys(fallback)) if (state[key] === undefined) state[key] = fallback[key];
    }
    writeState(state);
    return state;
  }

  // Ensure friends are loaded from the database if not present in app_state.
  // The friends table stores user IDs, so map them back to usernames before
  // rebuilding the denormalized friendship map. Treating IDs as usernames here
  // silently breaks every accepted-friend lookup (including DMs).
  if (!state.friends || Object.keys(state.friends).length === 0) {
    const friendRows = db.prepare('SELECT user_a, user_b, status, requested_by FROM friends').all();
    if (friendRows.length > 0) {
      const usernameById = new Map();
      for (const row of db.prepare('SELECT id, username FROM users').all()) {
        usernameById.set(row.id, row.username);
      }
      for (const user of Object.values(state.users || {})) {
        if (user && typeof user.id === 'string' && typeof user.username === 'string') {
          usernameById.set(user.id, user.username);
        }
      }
      const friends = {};
      for (const row of friendRows) {
        const a = usernameById.get(row.user_a);
        const b = usernameById.get(row.user_b);
        const by = usernameById.get(row.requested_by);
        if (!a || !b || a === b) continue;
        const [left, right] = a < b ? [a, b] : [b, a];
        friends[`${left}::${right}`] = {
          a: left,
          b: right,
          status: row.status === 'accepted' ? 'accepted' : 'pending',
          by: by || left
        };
      }
      state.friends = friends;
    }
  }

  // Load messages from the database to ensure persistence beyond app_state limits
  // Reconstruct the denormalized messages structure from the normalized database tables
  const messageRows = db.prepare(`
    SELECT m.id, m.sender_id, m.server_id, m.channel_id, m.conversation_id, m.text, m.created_at,
           u.username as sender_username
    FROM messages m
    JOIN users u ON m.sender_id = u.id
  `).all();

  if (messageRows.length > 0) {
    // Build userId -> username map
    const userIdToUsername = new Map();
    const userRows = db.prepare('SELECT id, username FROM users').all();
    for (const u of userRows) {
      userIdToUsername.set(u.id, u.username);
    }

    // Build conversation -> messages map
    const messagesByScope = new Map();
    for (const row of messageRows) {
      let scope;
      if (row.conversation_id) {
        scope = row.conversation_id;
      } else if (row.server_id && row.channel_id) {
        scope = `${row.server_id}:${row.channel_id}`;
      } else {
        continue; // skip messages without proper scope
      }

      if (!messagesByScope.has(scope)) {
        messagesByScope.set(scope, []);
      }

      messagesByScope.get(scope).push({
        id: row.id,
        from: row.sender_username,
        text: row.text,
        at: row.created_at
      });
    }

    // Sort messages by timestamp and assign to state
    state.messages = state.messages || {};
    for (const [scope, messages] of messagesByScope) {
      // Sort by timestamp ascending
      messages.sort((a, b) => a.at - b.at);
      state.messages[scope] = messages;
    }
  }

  return state;
}

function createSession(tokenHash, userId, expiresAt) {
  run('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)', tokenHash, userId, expiresAt);
}
function findSession(tokenHash) {
  return db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
}
function deleteSession(tokenHash) {
  run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}
function deleteSessionsForUser(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}
function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
}

function createOAuthState(state, value, expiresAt) {
  db.exec('BEGIN IMMEDIATE');
  try {
    run('DELETE FROM oauth_states WHERE expires_at <= ?', Date.now());
    run('INSERT INTO oauth_states(state, value, expires_at) VALUES(?, ?, ?)', state, JSON.stringify(value), expiresAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function getOAuthState(state) {
  if (typeof state !== 'string' || !state) return null;
  const entry = db.prepare('SELECT value, expires_at FROM oauth_states WHERE state = ?').get(state);
  if (!entry || entry.expires_at <= Date.now()) return null;
  return JSON.parse(entry.value);
}
function consumeOAuthState(state, expectedProvider) {
  if (typeof state !== 'string' || !state) return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const entry = db.prepare('SELECT value, expires_at FROM oauth_states WHERE state = ?').get(state);
    if (entry && entry.expires_at > Date.now() && expectedProvider) {
      const value = JSON.parse(entry.value);
      if (value.provider !== expectedProvider) {
        db.exec('COMMIT');
        return null;
      }
    }
    run('DELETE FROM oauth_states WHERE state = ?', state);
    db.exec('COMMIT');
    return entry && entry.expires_at > Date.now() ? JSON.parse(entry.value) : null;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createActivityPairing(codeHash, userId, expiresAt) {
  run('DELETE FROM activity_pairings WHERE user_id = ? OR expires_at <= ?', userId, Date.now());
  run('INSERT INTO activity_pairings(code_hash, user_id, expires_at) VALUES(?, ?, ?)', codeHash, userId, expiresAt);
}
function claimActivityPairing(codeHash, tokenHash) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const pairing = db.prepare('SELECT user_id FROM activity_pairings WHERE code_hash = ? AND expires_at > ?').get(codeHash, Date.now());
    if (!pairing) {
      db.exec('ROLLBACK');
      return null;
    }
    run('DELETE FROM activity_pairings WHERE code_hash = ?', codeHash);
    run('INSERT INTO activity_tokens(user_id, token_hash, created_at) VALUES(?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at', pairing.user_id, tokenHash, Date.now());
    db.exec('COMMIT');
    return pairing.user_id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function findActivityConnector(tokenHash) {
  return db.prepare('SELECT user_id FROM activity_tokens WHERE token_hash = ?').get(tokenHash);
}
function hasActivityConnector(userId) {
  return Boolean(db.prepare('SELECT 1 FROM activity_tokens WHERE user_id = ?').get(userId));
}
function revokeActivityToken(tokenHash) {
  const connector = findActivityConnector(tokenHash);
  if (!connector) return null;
  run('DELETE FROM activity_tokens WHERE token_hash = ?', tokenHash);
  return connector.user_id;
}
function revokeActivityConnector(userId) {
  run('DELETE FROM activity_tokens WHERE user_id = ?', userId);
  run('DELETE FROM activity_pairings WHERE user_id = ?', userId);
}

function findMeteredTurnCredential(userId) {
  const credential = db.prepare('SELECT username, api_key, ice_servers, created_at, expires_at FROM metered_turn_credentials WHERE user_id = ?').get(userId);
  return credential ? { ...credential, ice_servers: credential.ice_servers ? JSON.parse(credential.ice_servers) : null } : null;
}
function saveMeteredTurnCredential(userId, credential) {
  run(`INSERT INTO metered_turn_credentials(user_id, username, api_key, ice_servers, created_at, expires_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, api_key = excluded.api_key,
      ice_servers = excluded.ice_servers, created_at = excluded.created_at, expires_at = excluded.expires_at`,
  userId, credential.username, credential.apiKey, credential.iceServers ? JSON.stringify(credential.iceServers) : null,
  credential.createdAt, credential.expiresAt);
}

module.exports = { loadState, writeState, createSession, findSession, deleteSession, deleteSessionsForUser, pruneSessions, createOAuthState, getOAuthState, consumeOAuthState, createActivityPairing, claimActivityPairing, findActivityConnector, hasActivityConnector, revokeActivityToken, revokeActivityConnector, findMeteredTurnCredential, saveMeteredTurnCredential };

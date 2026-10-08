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
    created_at INTEGER NOT NULL
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
`);
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('show_game_activity')) {
  db.exec('ALTER TABLE users ADD COLUMN show_game_activity INTEGER NOT NULL DEFAULT 1');
}

function run(sql, ...values) {
  return db.prepare(sql).run(...values);
}

function writeState(state) {
  db.exec('BEGIN IMMEDIATE');
  try {
    run('INSERT INTO app_state(id, value) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value', JSON.stringify(state));
    for (const table of ['messages', 'conversation_members', 'conversations', 'channels', 'server_members', 'invites', 'friends', 'oauth_identities', 'game_activity', 'servers']) {
      db.exec(`DELETE FROM ${table}`);
    }

    const userIds = new Map();
    const insertUser = db.prepare(`INSERT INTO users(id, username, display_name, avatar, minecraft, show_game_activity, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
      avatar = excluded.avatar, minecraft = excluded.minecraft,
      show_game_activity = excluded.show_game_activity`);
    const insertIdentity = db.prepare('INSERT OR IGNORE INTO oauth_identities(provider, provider_id, user_id) VALUES(?, ?, ?)');
    for (const [username, user] of Object.entries(state.users || {})) {
      if (!user || typeof user.id !== 'string') continue;
      userIds.set(username, user.id);
      insertUser.run(user.id, username, String(user.displayName || username), String(user.avatar || ''), user.minecraft ? JSON.stringify(user.minecraft) : null, user.showGameActivity === false ? 0 : 1, Number(user.createdAt) || Date.now());
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
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function loadState(legacyFile, fallback) {
  const saved = db.prepare('SELECT value FROM app_state WHERE id = 1').get();
  if (saved) return JSON.parse(saved.value);
  let state = fallback;
  if (fs.existsSync(legacyFile)) {
    state = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    for (const key of Object.keys(fallback)) if (state[key] === undefined) state[key] = fallback[key];
  }
  writeState(state);
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
function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
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

module.exports = { loadState, writeState, createSession, findSession, deleteSession, pruneSessions, createActivityPairing, claimActivityPairing, findActivityConnector, hasActivityConnector, revokeActivityToken, revokeActivityConnector };

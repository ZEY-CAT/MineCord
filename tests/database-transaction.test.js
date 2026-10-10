const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('state writes roll back completely when normalized persistence fails', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-db-transaction-'));
  const databaseFile = path.join(tempDir, 'state.sqlite');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { DatabaseSync } = require('node:sqlite');
    const database = require('./server/database');
    const state = {
      users: { alice: { id: 'user-1', displayName: 'Alice', createdAt: 1 } },
      servers: [{ id: 'server-1', name: 'Original', owner: 'alice', members: ['alice'], channels: [] }],
      messages: {}, friends: {}, invites: {}, oauthStates: {}, gameActivities: {}, dmRead: {}
    };
    database.writeState(state);
    const sql = new DatabaseSync(process.env.DATABASE_URL);
    const beforeState = sql.prepare('SELECT value FROM app_state WHERE id = 1').get().value;
    const beforeServer = sql.prepare('SELECT name FROM servers WHERE id = ?').get('server-1').name;
    const invalid = structuredClone(state);
    invalid.servers.push({ id: 'server-1', name: 'Duplicate', owner: 'alice', members: ['alice'], channels: [] });
    assert.throws(() => database.writeState(invalid));
    assert.equal(sql.prepare('SELECT value FROM app_state WHERE id = 1').get().value, beforeState);
    assert.equal(sql.prepare('SELECT name FROM servers WHERE id = ?').get('server-1').name, beforeServer);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM servers').get().count, 1);
    sql.close();
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseFile },
    encoding: 'utf8'
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

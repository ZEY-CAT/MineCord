const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { resolveDatabasePath } = require('../server/database-config');

const baseDirectory = path.resolve('test-server-root');
const renderUrl = 'https://minecord.example.onrender.com';

test('local development keeps the existing SQLite default', () => {
  assert.equal(resolveDatabasePath({}, baseDirectory), path.join(baseDirectory, 'minecord.sqlite'));
});

test('Render refuses the ephemeral default SQLite location', () => {
  assert.throws(() => resolveDatabasePath({ RENDER_EXTERNAL_URL: renderUrl }, baseDirectory), /requires DATABASE_URL on a persistent disk/i);
});

test('database startup fails before creating a Render-local SQLite database when durability is undeclared', () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', "require('./server/database')"], {
    cwd: repositoryRoot,
    env: { ...process.env, RENDER_EXTERNAL_URL: renderUrl, DATABASE_URL: '', MINECORD_PERSISTENT_DATA_DIR: '' },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Render requires DATABASE_URL on a persistent disk/i);
});

test('Render requires an absolute declared persistent-disk root', () => {
  assert.throws(() => resolveDatabasePath({
    RENDER_EXTERNAL_URL: renderUrl,
    DATABASE_URL: '/var/data/minecord.sqlite',
    MINECORD_PERSISTENT_DATA_DIR: 'var/data'
  }, baseDirectory), /verified absolute path/i);
});

test('Render rejects a database path outside the declared persistent-disk root', () => {
  assert.throws(() => resolveDatabasePath({
    RENDER_EXTERNAL_URL: renderUrl,
    DATABASE_URL: '/opt/render/project/src/server/minecord.sqlite',
    MINECORD_PERSISTENT_DATA_DIR: '/var/data'
  }, baseDirectory), /must be a file inside/i);
});

test('Render accepts a SQLite database path inside the declared disk mount', () => {
  assert.equal(resolveDatabasePath({
    RENDER_EXTERNAL_URL: renderUrl,
    DATABASE_URL: 'sqlite:////var/data/minecord.sqlite',
    MINECORD_PERSISTENT_DATA_DIR: '/var/data'
  }, baseDirectory), path.resolve('/var/data/minecord.sqlite'));
});

test('database path continues to reject non-SQLite connection URLs', () => {
  assert.throws(() => resolveDatabasePath({ DATABASE_URL: 'postgres://example.invalid/database' }, baseDirectory), /SQLite file path/i);
});

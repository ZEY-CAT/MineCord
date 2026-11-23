const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { activatePrivateDataDirectory, migratePrivateData, tableSummary } = require('../scripts/migrate-private-data');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

test('private migration prepares verified JSON and SQLite copies including committed WAL state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-private-migration-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'private');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  const sourceJson = path.join(source, 'data.json');
  const sourceDatabase = path.join(source, 'minecord.sqlite');
  const legacyBytes = Buffer.from('{"users":{"fixture":{"username":"fixture"}},"messages":{}}\n');
  fs.writeFileSync(sourceJson, legacyBytes);

  const database = new DatabaseSync(sourceDatabase);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO fixture VALUES (\'row-1\', \'committed-in-wal\');');
  const sourceSummary = tableSummary(sourceDatabase);
  const expectedJsonHash = digest(sourceJson);
  const legacyDestination = path.join(target, 'legacy-data.json');
  const activeDatabase = path.join(target, 'minecord.sqlite');
  const sourcePortalConfig = path.join(source, 'DEV-LOGINS.json');
  const portalDestination = path.join(target, 'DEV-LOGINS.json');
  fs.writeFileSync(sourcePortalConfig, '{"version":1,"users":{},"invitations":[]}\n');
  const backupDirectory = path.join(target, 'backup');

  try {
    const result = await migratePrivateData({
      sourceJson,
      sourceDatabase,
      dataDirectory: target,
      legacyDestination,
      activeDatabase,
      sourcePortalConfig,
      portalDestination,
      backupDirectory,
      expectedJsonHash
    });
    assert.equal(result.verified, true);
    assert.equal(digest(legacyDestination), expectedJsonHash);
    assert.equal(digest(path.join(backupDirectory, 'legacy-data.json')), expectedJsonHash);
    assert.equal(digest(portalDestination), digest(sourcePortalConfig));
    assert.equal(digest(path.join(backupDirectory, 'DEV-LOGINS.json')), digest(sourcePortalConfig));
    assert.deepEqual(tableSummary(activeDatabase), sourceSummary);
    assert.equal(digest(activeDatabase), digest(path.join(backupDirectory, 'minecord.sqlite')));
    const imported = new DatabaseSync(activeDatabase, { readOnly: true });
    try {
      assert.equal(imported.prepare('SELECT value FROM fixture WHERE id = ?').get('row-1').value, 'committed-in-wal');
    } finally {
      imported.close();
    }
    assert.equal(fs.existsSync(sourceJson), true, 'source JSON remains available for rollback');
    assert.equal(fs.existsSync(sourceDatabase), true, 'source database remains available for rollback');
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('private migration refuses an unexpected source fingerprint and never overwrites destinations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-private-migration-guard-'));
  const sourceJson = path.join(root, 'data.json');
  const sourceDatabase = path.join(root, 'minecord.sqlite');
  const target = path.join(root, 'private');
  fs.mkdirSync(target);
  fs.writeFileSync(sourceJson, '{"private":"fixture"}');
  const database = new DatabaseSync(sourceDatabase);
  database.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY);');
  database.close();
  const legacyDestination = path.join(target, 'legacy-data.json');
  const activeDatabase = path.join(target, 'minecord.sqlite');

  try {
    await assert.rejects(migratePrivateData({
      sourceJson, sourceDatabase, dataDirectory: target, legacyDestination, activeDatabase,
      sourcePortalConfig: path.join(root, 'DEV-LOGINS.json'), portalDestination: path.join(target, 'DEV-LOGINS.json'),
      backupDirectory: path.join(target, 'wrong-fingerprint'), expectedJsonHash: '0'.repeat(64)
    }), /fingerprint did not match/i);
    assert.equal(fs.existsSync(legacyDestination), false);

    fs.writeFileSync(activeDatabase, 'do-not-overwrite');
    await assert.rejects(migratePrivateData({
      sourceJson, sourceDatabase, dataDirectory: target, legacyDestination, activeDatabase,
      sourcePortalConfig: path.join(root, 'DEV-LOGINS.json'), portalDestination: path.join(target, 'DEV-LOGINS.json'),
      backupDirectory: path.join(target, 'destination-exists'), expectedJsonHash: digest(sourceJson)
    }), /destination files already exist/i);
    assert.equal(fs.readFileSync(activeDatabase, 'utf8'), 'do-not-overwrite');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('environment activation switches atomically after verification and preserves existing settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-env-activation-'));
  const environmentFile = path.join(root, '.env');
  const dataDirectory = path.join(root, 'private-data');
  fs.writeFileSync(environmentFile, 'TEST_SECRET=fixture-value\n');
  try {
    assert.equal(activatePrivateDataDirectory(dataDirectory, environmentFile), true);
    const parsed = require('dotenv').parse(fs.readFileSync(environmentFile, 'utf8'));
    assert.equal(parsed.TEST_SECRET, 'fixture-value');
    assert.equal(path.resolve(parsed.MINECORD_DATA_DIR), path.resolve(dataDirectory));
    assert.equal(activatePrivateDataDirectory(dataDirectory, environmentFile), false);
    assert.throws(() => activatePrivateDataDirectory(path.join(root, 'other'), environmentFile), /already points.*elsewhere/i);
    assert.equal(require('dotenv').parse(fs.readFileSync(environmentFile, 'utf8')).TEST_SECRET, 'fixture-value');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

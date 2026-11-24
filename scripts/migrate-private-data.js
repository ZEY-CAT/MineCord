const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { backup, DatabaseSync } = require('node:sqlite');
const { resolveDatabasePath, resolveLegacyDataPath, resolvePrivateDataDirectory, resolveDeveloperConfigPath } = require('../server/database-config');

const EXPECTED_LEGACY_SHA256 = 'D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function flushFile(file) {
  const handle = fs.openSync(file, 'r+');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}

function setPrivateDirectoryPermissions(directory) {
  if (process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700);
    return;
  }
  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const userSid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!userSid) throw new Error('Could not resolve the current Windows user SID to protect MineCord data.');
  execFileSync('icacls.exe', [
    directory,
    '/inheritance:r',
    '/grant:r',
    `*${userSid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F'
  ], { encoding: 'utf8', windowsHide: true });
}

function tableSummary(file) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA quick_check').all();
    if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') {
      throw new Error('SQLite integrity verification failed; no active paths were changed.');
    }
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return Object.fromEntries(tables.map(({ name }) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      return [name, database.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get().count];
    }));
  } finally {
    database.close();
  }
}

function assertAbsent(files) {
  const existing = files.filter(file => fs.existsSync(file));
  if (existing.length) throw new Error('Private data migration stopped because one or more destination files already exist; no existing destination was overwritten.');
}

function copyVerifiedToUnreferencedPath(source, destination) {
  assertAbsent([destination]);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  flushFile(destination);
  if (sha256File(source) !== sha256File(destination)) throw new Error('Private data copy verification failed; source and destination were preserved for rollback.');
}

async function createDatabaseBackup(sourcePath, destinationPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const before = tableSummary(sourcePath);
    await backup(source, destinationPath);
    const after = tableSummary(destinationPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('SQLite backup verification failed; table row counts differ.');
    }
  } finally {
    source.close();
  }
}

async function migratePrivateData(options = {}) {
  const sourceJson = path.resolve(options.sourceJson || path.join(__dirname, '..', 'server', 'data.json'));
  const sourceDatabase = path.resolve(options.sourceDatabase || path.join(__dirname, '..', 'server', 'minecord.sqlite'));
  const sourcePortalConfig = path.resolve(options.sourcePortalConfig || path.join(__dirname, '..', 'DEV-LOGINS.json'));
  const dataDirectory = path.resolve(options.dataDirectory || resolvePrivateDataDirectory(process.env, path.join(__dirname, '..', 'server')));
  const serverDirectory = path.join(__dirname, '..', 'server');
  const legacyDestination = path.resolve(options.legacyDestination || resolveLegacyDataPath(process.env, serverDirectory));
  const activeDatabase = path.resolve(options.activeDatabase || resolveDatabasePath(process.env, serverDirectory));
  const portalDestination = path.resolve(options.portalDestination || resolveDeveloperConfigPath(process.env, serverDirectory));
  const backupDirectory = path.resolve(options.backupDirectory || path.join(dataDirectory, `migration-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  const expectedJsonHash = options.expectedJsonHash || EXPECTED_LEGACY_SHA256;

  if (path.dirname(legacyDestination) !== dataDirectory || path.dirname(activeDatabase) !== dataDirectory || path.dirname(portalDestination) !== dataDirectory) {
    throw new Error('Configured active data files must be directly inside MINECORD_DATA_DIR; no files were copied.');
  }

  if (!fs.existsSync(sourceJson) || !fs.existsSync(sourceDatabase)) {
    throw new Error('Both legacy JSON and SQLite source files are required; migration did not begin.');
  }
  const sourceJsonHash = sha256File(sourceJson);
  const hasPortalConfig = fs.existsSync(sourcePortalConfig);
  const sourcePortalHash = hasPortalConfig ? sha256File(sourcePortalConfig) : null;
  if (expectedJsonHash && sourceJsonHash !== expectedJsonHash.toUpperCase()) {
    throw new Error('Legacy JSON fingerprint did not match the verified source; migration did not begin.');
  }
  const legacyObject = JSON.parse(fs.readFileSync(sourceJson, 'utf8'));
  if (!legacyObject || typeof legacyObject !== 'object' || Array.isArray(legacyObject)) {
    throw new Error('Legacy JSON structure is invalid; migration did not begin.');
  }
  assertAbsent([legacyDestination, activeDatabase, ...(hasPortalConfig ? [portalDestination] : []), backupDirectory]);

  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  setPrivateDirectoryPermissions(dataDirectory);
  fs.mkdirSync(backupDirectory, { mode: 0o700 });

  const backupJson = path.join(backupDirectory, 'legacy-data.json');
  const backupDatabase = path.join(backupDirectory, 'minecord.sqlite');
  const backupPortalConfig = path.join(backupDirectory, 'DEV-LOGINS.json');
  assertAbsent([backupJson, backupDatabase, ...(hasPortalConfig ? [backupPortalConfig] : [])]);

  fs.copyFileSync(sourceJson, backupJson, fs.constants.COPYFILE_EXCL);
  flushFile(backupJson);
  if (sha256File(backupJson) !== sourceJsonHash) throw new Error('Verified legacy JSON backup does not match its source.');
  if (hasPortalConfig) {
    fs.copyFileSync(sourcePortalConfig, backupPortalConfig, fs.constants.COPYFILE_EXCL);
    flushFile(backupPortalConfig);
    if (sha256File(backupPortalConfig) !== sourcePortalHash) throw new Error('Developer Portal backup verification failed.');
  }

  await createDatabaseBackup(sourceDatabase, backupDatabase);
  flushFile(backupDatabase);
  // These destinations are not active until the operator atomically updates MINECORD_DATA_DIR.
  copyVerifiedToUnreferencedPath(backupDatabase, activeDatabase);
  copyVerifiedToUnreferencedPath(backupJson, legacyDestination);
  if (hasPortalConfig) copyVerifiedToUnreferencedPath(backupPortalConfig, portalDestination);

  const activeSummary = tableSummary(activeDatabase);
  const backupSummary = tableSummary(backupDatabase);
  if (JSON.stringify(activeSummary) !== JSON.stringify(backupSummary) || sha256File(activeDatabase) !== sha256File(backupDatabase)) {
    throw new Error('Active SQLite verification failed; retain the source database and use the verified backup for rollback.');
  }
  if (sha256File(legacyDestination) !== sourceJsonHash) {
    throw new Error('Active legacy-data verification failed; retain the source JSON and use the verified backup for rollback.');
  }
  if (hasPortalConfig && sha256File(portalDestination) !== sourcePortalHash) {
    throw new Error('Active Developer Portal config verification failed; retain the source file and use the verified backup for rollback.');
  }

  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    sourceJsonSha256: sourceJsonHash,
    sourceJsonBytes: fs.statSync(sourceJson).size,
    portalConfigCopied: hasPortalConfig,
    ...(hasPortalConfig ? { portalConfigSha256: sourcePortalHash } : {}),
    sqliteIntegrity: 'ok',
    sqliteTableRowsMatch: true,
    backupDatabaseSha256: sha256File(backupDatabase),
    activeDatabaseSha256: sha256File(activeDatabase),
    activation: 'not-configured; switch MINECORD_DATA_DIR only after reviewing verification'
  };
  const manifestPath = path.join(backupDirectory, 'migration-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  flushFile(manifestPath);

  return {
    dataDirectory,
    activeDatabase,
    legacyDestination,
    portalDestination: hasPortalConfig ? portalDestination : null,
    backupDirectory,
    legacyBytes: manifest.sourceJsonBytes,
    verified: true
  };
}

function activatePrivateDataDirectory(dataDirectory, environmentFile = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(environmentFile) || fs.lstatSync(environmentFile).isSymbolicLink()) {
    throw new Error('Private data is prepared and verified, but .env is missing or linked; add MINECORD_DATA_DIR manually before starting MineCord.');
  }
  const contents = fs.readFileSync(environmentFile, 'utf8');
  const parsed = require('dotenv').parse(contents);
  const configured = String(parsed.MINECORD_DATA_DIR || '').trim();
  if (configured && path.resolve(configured) !== path.resolve(dataDirectory)) {
    throw new Error('Private data is prepared, but .env already points MINECORD_DATA_DIR elsewhere; no configuration was changed.');
  }
  if (configured) return false;

  const normalized = path.resolve(dataDirectory).replaceAll('\\', '/');
  const prefix = contents.length && !contents.endsWith('\n') ? '\n' : '';
  const updated = `${contents}${prefix}\n# Private MineCord runtime data directory.\nMINECORD_DATA_DIR=${JSON.stringify(normalized)}\n`;
  const temporaryFile = path.join(path.dirname(environmentFile), `.env.minecord-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  const handle = fs.openSync(temporaryFile, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, updated, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    // Same-directory rename switches the active data path as one filesystem operation.
    fs.renameSync(temporaryFile, environmentFile);
  } catch (error) {
    try { fs.unlinkSync(temporaryFile); } catch {}
    throw new Error(`Verified private data is prepared, but the atomic .env switch failed; the original .env is unchanged (${error.code || 'rename error'}).`);
  }
  return true;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  if (process.env.RENDER_EXTERNAL_URL) {
    console.error('This local migration tool will not operate against a Render environment.');
    process.exitCode = 1;
  } else {
    const requestedDirectory = process.argv[2] ? path.resolve(process.argv[2]) : '';
    const configuredDirectory = String(process.env.MINECORD_DATA_DIR || '').trim();
    if (requestedDirectory && configuredDirectory && path.resolve(configuredDirectory) !== requestedDirectory) {
      console.error('Private MineCord data migration stopped safely: .env already specifies a different MINECORD_DATA_DIR.');
      process.exitCode = 1;
    } else {
      if (requestedDirectory) process.env.MINECORD_DATA_DIR = requestedDirectory;
      migratePrivateData().then(result => {
        const activated = activatePrivateDataDirectory(result.dataDirectory);
        console.log(`Private MineCord data migration verified at ${result.dataDirectory}.`);
        console.log(`SQLite backup and active copy are verified; legacy JSON is ${result.legacyBytes} bytes and byte-identical.`);
        console.log(`Rollback backup: ${result.backupDirectory}`);
        console.log(activated ? 'MINECORD_DATA_DIR was appended to .env after verification.' : '.env already points to this verified data directory.');
      }).catch(error => {
        console.error(`Private MineCord data migration stopped safely: ${error.message}`);
        process.exitCode = 1;
      });
    }
  }
}

module.exports = { migratePrivateData, createDatabaseBackup, tableSummary, setPrivateDirectoryPermissions, activatePrivateDataDirectory };

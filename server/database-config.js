const os = require('node:os');
const path = require('node:path');

function pathInside(candidate, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function repositoryRoot(baseDirectory) {
  return path.resolve(baseDirectory, '..');
}

function assertOutsideRepository(candidate, baseDirectory, label) {
  if (pathInside(candidate, repositoryRoot(baseDirectory))) {
    throw new Error(`MineCord storage safety: ${label} must be outside the repository checkout.`);
  }
}

function resolvePostgresUrl(env = process.env) {
  const value = String(env.DATABASE_URL || '').trim();
  const unquoted = value.replace(/^(['"])(.*)\1$/, '$2').trim();
  return /^postgres(?:ql)?:\/\//i.test(unquoted) ? unquoted : null;
}

function usesPostgres(env = process.env) {
  return resolvePostgresUrl(env) !== null;
}

function resolvePrivateDataDirectory(env = process.env, baseDirectory = __dirname) {
  let directory;
  const configured = String(env.MINECORD_DATA_DIR || '').trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error('MINECORD_DATA_DIR must be an absolute path outside the repository checkout.');
    }
    directory = path.resolve(configured);
  } else if (env.RENDER_EXTERNAL_URL && !usesPostgres(env)) {
    const persistentRoot = String(env.MINECORD_PERSISTENT_DATA_DIR || '').trim();
    if (!persistentRoot || !path.isAbsolute(persistentRoot)) {
      throw new Error('MineCord storage safety: set MINECORD_PERSISTENT_DATA_DIR to the verified absolute path of the mounted Render disk.');
    }
    directory = path.resolve(persistentRoot);
  } else if (process.platform === 'win32') {
    const userDataRoot = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    directory = path.join(userDataRoot, 'MineCord', 'Data');
  } else {
    const userDataRoot = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    directory = path.join(userDataRoot, 'minecord');
  }
  assertOutsideRepository(directory, baseDirectory, 'MINECORD_DATA_DIR');
  return directory;
}

function configuredPath(value, env, baseDirectory) {
  if (!value && env.RENDER_EXTERNAL_URL) {
    throw new Error('MineCord storage safety: Render requires DATABASE_URL on a persistent disk.');
  }
  if (!value) return path.join(resolvePrivateDataDirectory(env, baseDirectory), 'minecord.sqlite');
  if (String(value).startsWith('sqlite:///')) return path.resolve(String(value).slice('sqlite:///'.length));
  if (/^[a-z]+:\/\//i.test(String(value))) {
    throw new Error('DATABASE_URL must be a SQLite file path or sqlite:/// URL.');
  }
  return path.resolve(String(value));
}

function resolveDatabasePath(env = process.env, baseDirectory = __dirname) {
  if (usesPostgres(env)) {
    throw new Error('DATABASE_URL must be a SQLite file path or sqlite:/// URL for this operation.');
  }
  const databaseFile = configuredPath(env.DATABASE_URL, env, baseDirectory);
  assertOutsideRepository(databaseFile, baseDirectory, 'DATABASE_URL');
  if (!env.RENDER_EXTERNAL_URL) return databaseFile;

  if (!env.DATABASE_URL) {
    throw new Error('MineCord storage safety: Render requires DATABASE_URL on a persistent disk.');
  }
  const persistentRoot = String(env.MINECORD_PERSISTENT_DATA_DIR || '').trim();
  if (!persistentRoot || !path.isAbsolute(persistentRoot)) {
    throw new Error('MineCord storage safety: set MINECORD_PERSISTENT_DATA_DIR to the verified absolute path of the mounted Render disk.');
  }
  const resolvedRoot = path.resolve(persistentRoot);
  const relative = path.relative(resolvedRoot, databaseFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('MineCord storage safety: DATABASE_URL must be a file inside MINECORD_PERSISTENT_DATA_DIR.');
  }
  return databaseFile;
}

function resolveLegacyDataPath(env = process.env, baseDirectory = __dirname) {
  const configured = String(env.MINECORD_LEGACY_DATA_FILE || '').trim();
  if (!configured && usesPostgres(env)) return null;
  const legacyFile = configured
    ? path.resolve(configured)
    : path.join(path.dirname(resolveDatabasePath(env, baseDirectory)), 'legacy-data.json');
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('MINECORD_LEGACY_DATA_FILE must be an absolute path outside the repository checkout.');
  }
  assertOutsideRepository(legacyFile, baseDirectory, 'MINECORD_LEGACY_DATA_FILE');
  return legacyFile;
}

function resolveDeveloperConfigPath(env = process.env, baseDirectory = __dirname) {
  const configured = String(env.MINECORD_DEV_LOGINS_PATH || '').trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('MINECORD_DEV_LOGINS_PATH must be an absolute path outside the repository checkout.');
  }
  const configFile = configured
    ? path.resolve(configured)
    : path.join(resolvePrivateDataDirectory(env, baseDirectory), 'DEV-LOGINS.json');
  assertOutsideRepository(configFile, baseDirectory, 'MINECORD_DEV_LOGINS_PATH');
  return configFile;
}

module.exports = { resolvePostgresUrl, usesPostgres, resolveDatabasePath, resolveLegacyDataPath, resolvePrivateDataDirectory, resolveDeveloperConfigPath };

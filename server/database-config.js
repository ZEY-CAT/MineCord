const path = require('node:path');

function configuredPath(value, baseDirectory) {
  if (!value) return path.join(baseDirectory, 'minecord.sqlite');
  if (String(value).startsWith('sqlite:///')) return path.resolve(String(value).slice('sqlite:///'.length));
  if (/^[a-z]+:\/\//i.test(String(value))) {
    throw new Error('DATABASE_URL must be a SQLite file path or sqlite:/// URL.');
  }
  return path.resolve(String(value));
}

function resolveDatabasePath(env = process.env, baseDirectory = __dirname) {
  const databaseFile = configuredPath(env.DATABASE_URL, baseDirectory);
  if (!env.RENDER_EXTERNAL_URL) return databaseFile;

  if (!env.DATABASE_URL) {
    throw new Error('MineCord storage safety: Render requires DATABASE_URL on a persistent disk; the local SQLite default is ephemeral.');
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

module.exports = { resolveDatabasePath };

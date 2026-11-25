const assert = require('node:assert/strict');
const { execFile, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { usesPostgres, resolvePostgresUrl, resolveDatabasePath, resolveLegacyDataPath, resolvePrivateDataDirectory, resolveDeveloperConfigPath } = require('../server/database-config');

const baseDirectory = path.resolve('test-server-root');
const renderUrl = 'https://minecord.example.onrender.com';
const renderDisk = path.resolve(path.parse(baseDirectory).root, 'var', 'data');

test('local development stores SQLite outside the repository in the configured private data directory', () => {
  const dataDirectory = path.join(require('node:os').tmpdir(), 'minecord-private-test-data');
  assert.equal(resolveDatabasePath({ MINECORD_DATA_DIR: dataDirectory }, baseDirectory), path.join(dataDirectory, 'minecord.sqlite'));
  assert.equal(resolvePrivateDataDirectory({ LOCALAPPDATA: dataDirectory, XDG_DATA_HOME: dataDirectory }, baseDirectory), path.join(dataDirectory, ...(process.platform === 'win32' ? ['MineCord', 'Data'] : ['minecord'])));
  assert.equal(resolveLegacyDataPath({ MINECORD_DATA_DIR: dataDirectory }, baseDirectory), path.join(dataDirectory, 'legacy-data.json'));
  assert.equal(resolveDeveloperConfigPath({ MINECORD_DATA_DIR: dataDirectory }, baseDirectory), path.join(dataDirectory, 'DEV-LOGINS.json'));
});

test('local storage paths cannot point into the repository or use a relative private root', () => {
  assert.throws(() => resolvePrivateDataDirectory({ MINECORD_DATA_DIR: 'private-data' }, baseDirectory), /must be an absolute path/i);
  assert.throws(() => resolvePrivateDataDirectory({ MINECORD_DATA_DIR: path.join(repositoryRootForTest(), 'server', 'private') }, baseDirectory), /outside the repository/i);
  assert.throws(() => resolveDatabasePath({ DATABASE_URL: path.join(repositoryRootForTest(), 'server', 'private.sqlite') }, baseDirectory), /outside the repository/i);
  assert.throws(() => resolveDeveloperConfigPath({ MINECORD_DEV_LOGINS_PATH: path.join(repositoryRootForTest(), 'DEV-LOGINS.json') }, baseDirectory), /outside the repository/i);
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
    MINECORD_PERSISTENT_DATA_DIR: renderDisk
  }, baseDirectory), /must be a file inside/i);
});

test('Render accepts a SQLite database path inside the declared disk mount', () => {
  assert.equal(resolveDatabasePath({
    RENDER_EXTERNAL_URL: renderUrl,
    DATABASE_URL: 'sqlite:///' + path.join(renderDisk, 'minecord.sqlite'),
    MINECORD_PERSISTENT_DATA_DIR: renderDisk
  }, baseDirectory), path.join(renderDisk, 'minecord.sqlite'));
});

test('database path continues to reject non-SQLite connection URLs', () => {
  assert.throws(() => resolveDatabasePath({ DATABASE_URL: 'postgres://example.invalid/database' }, baseDirectory), /SQLite file path/i);
});

for (const scheme of ['postgres', 'postgresql']) {
  test(scheme + ' URLs select PostgreSQL on Render even with pasted spaces or quotes', () => {
    const url = scheme + '://test-user@pooler.example.invalid:5432/test-database?sslmode=require';
    for (const value of [
      url, '  ' + url + '  ', '"' + url + '"', "'" + url + "'",
      'DATABASE_URL=' + url, '  DATABASE_URL = "' + url + '"  '
    ]) {
      const env = { DATABASE_URL: value, RENDER_EXTERNAL_URL: renderUrl };
      assert.equal(resolvePostgresUrl(env), url);
      assert.equal(usesPostgres(env), true);
      assert.equal(resolveLegacyDataPath(env, baseDirectory), null);
      assert.throws(() => resolveDatabasePath(env, baseDirectory), /SQLite file path/i);
    }
  });
}

test('Render server startup sends a pasted PostgreSQL assignment to the PostgreSQL worker', () => {
  const result = spawnSync(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      RENDER_EXTERNAL_URL: renderUrl,
      DATABASE_URL: 'DATABASE_URL="postgresql://synthetic@127.0.0.1:1/minecord?sslmode=disable"',
      MINECORD_LEGACY_DATA_FILE: '',
      MINECORD_DEV_LOGINS_PATH: '',
      MINECORD_DATA_DIR: ''
    },
    encoding: 'utf8',
    timeout: 15000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MineCord PostgreSQL operation failed \(connect: network: (?:ECONNREFUSED|EACCES|EPERM)\)/);
  assert.doesNotMatch(result.stderr, /postgresql:\/\/|synthetic|MineCord storage safety/);
});

test('Render startup requires PostgreSQL TLS and reports a driver failure without a code', async t => {
  const server = createServer(socket => {
    socket.once('data', request => {
      assert.equal(request.toString('hex'), '0000000804d2162f');
      socket.end('N');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = 'postgresql://synthetic:secret-marker@127.0.0.1:' + server.address().port + '/minecord?sslmode=disable';
  await assert.rejects(promisify(execFile)(process.execPath, ['-e', "require('./server/database')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, RENDER_EXTERNAL_URL: renderUrl, DATABASE_URL: url },
    timeout: 15000
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /MineCord PostgreSQL operation failed \(connect: tls\)/);
    assert.doesNotMatch(error.stderr, /postgresql:\/\/|synthetic|secret-marker/);
    return true;
  });
});

test('an unreadable PostgreSQL CA file fails closed without disclosing its path', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server/database')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      RENDER_EXTERNAL_URL: renderUrl,
      DATABASE_URL: 'postgresql://synthetic:secret-marker@127.0.0.1:1/minecord',
      MINECORD_POSTGRES_CA_FILE: path.join(__dirname, 'nonexistent-private-ca-marker', 'ca.pem')
    },
    encoding: 'utf8',
    timeout: 15000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MineCord PostgreSQL operation failed \(configuration: ca-file-unreadable\)/);
  assert.doesNotMatch(result.stderr, /postgresql:\/\/|secret-marker|nonexistent-private-ca-marker/);
});

function repositoryRootForTest() {
  return path.resolve(__dirname, '..');
}

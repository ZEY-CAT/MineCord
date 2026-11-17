const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, test } = require('node:test');
const { createDeveloperHubRouter } = require('../server/developer-hub');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-developer-hub-'));
const repositoryRoot = path.join(temporaryDirectory, 'repository');
const workspaceRoot = path.join(temporaryDirectory, 'workspaces');
fs.mkdirSync(path.join(repositoryRoot, 'server'), { recursive: true });
fs.mkdirSync(path.join(repositoryRoot, 'public'), { recursive: true });
fs.writeFileSync(path.join(repositoryRoot, 'README.md'), 'MineCord\n');
fs.writeFileSync(path.join(repositoryRoot, 'package.json'), '{}\n');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'source.js'), 'module.exports = "repository";\n');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'data.json'), '{"private":"user data"}');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'state.json'), '{"private":"runtime state"}');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'minecord.sqlite'), 'database');
fs.writeFileSync(path.join(repositoryRoot, 'server', '.env.txt'), 'secret');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'id_rsa.pem'), 'private key');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'oauth-config.js'), 'module.exports = { "client_secret": "a-sensitive-value-that-must-not-be-served" };\n');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'oversized.js'), 'x'.repeat(128 * 1024 + 1));
fs.writeFileSync(path.join(repositoryRoot, 'public', 'application.js'), 'export const page = true;\n');

const users = {
  approved: { id: 'approved-developer', username: 'approved', role: 'developer' },
  approvedSecond: { id: 'second-approved-developer', username: 'second', role: 'developer' },
  unapproved: { id: 'unapproved-developer', username: 'unapproved', role: 'developer' },
  ordinary: { id: 'approved-developer', username: 'ordinary', role: 'member' }
};
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => {
  req.minecordUser = users[req.get('x-test-user')] || null;
  next();
});
app.use('/api/developer-hub', createDeveloperHubRouter({
  repositoryRoot,
  workspaceRoot,
  approvedUserIds: ['approved-developer', 'second-approved-developer'],
  authenticate(req, res, next) {
    if (!req.minecordUser) return res.status(401).json({ error: 'Please sign in again.' });
    next();
  },
  originAllowed: req => !req.get('origin') || req.get('origin') === origin,
  audit: () => {}
}));
const server = http.createServer(app);
server.listen(0, '127.0.0.1');
const listening = once(server, 'listening');
let origin;
const ready = listening.then(() => {
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server.listening) {
    server.close();
    await once(server, 'close');
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(pathname, { user, ...options } = {}) {
  await ready;
  const headers = { ...(options.headers || {}) };
  if (user) headers['x-test-user'] = user;
  return fetch(`${origin}${pathname}`, { ...options, headers });
}

test('requires a signed-in, approved developer role on the backend', async () => {
  assert.equal((await request('/api/developer-hub')).status, 401);
  assert.equal((await request('/api/developer-hub/file?path=server%2Fsource.js')).status, 401);
  assert.equal((await request('/api/developer-hub', { user: 'ordinary' })).status, 403);
  assert.equal((await request('/api/developer-hub', { user: 'unapproved' })).status, 403);
  assert.equal((await request('/api/developer-hub/file?path=server%2Fsource.js', { user: 'unapproved' })).status, 403);
  const authorized = await request('/api/developer-hub', { user: 'approved' });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).developer.username, 'approved');
});

test('search returns approved file names without traversing protected paths', async () => {
  const response = await request('/api/developer-hub/search?q=source', { user: 'approved' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.results.some(entry => entry.path === 'server/source.js'));
  assert.ok(result.results.every(entry => !entry.path.includes('data.json') && !entry.path.includes('sqlite')));
});

test('lists and reads only allowlisted source while hiding protected paths', async () => {
  const listing = await request('/api/developer-hub/files?path=server', { user: 'approved' });
  assert.equal(listing.status, 200);
  const names = (await listing.json()).entries.map(entry => entry.name);
  assert.ok(names.includes('source.js'));
  for (const blocked of ['data.json', 'state.json', 'minecord.sqlite', '.env.txt', 'id_rsa.pem']) {
    assert.ok(!names.includes(blocked), `${blocked} must not appear in the browser`);
  }

  const source = await request('/api/developer-hub/file?path=server%2Fsource.js', { user: 'approved' });
  assert.equal(source.status, 200);
  assert.equal((await source.json()).content, 'module.exports = "repository";\n');
  for (const blocked of ['server/data.json', 'server/state.json', 'server/minecord.sqlite', 'server/.env.txt', 'server/id_rsa.pem']) {
    const response = await request(`/api/developer-hub/file?path=${encodeURIComponent(blocked)}`, { user: 'approved' });
    assert.equal(response.status, 404, `${blocked} must be blocked`);
  }
  assert.equal((await request('/api/developer-hub/file?path=server%2Foauth-config.js', { user: 'approved' })).status, 404);
});

test('blocks traversal and oversized files', async () => {
  assert.equal((await request('/api/developer-hub/file?path=server%2F..%2FREADME.md', { user: 'approved' })).status, 404);
  assert.equal((await request('/api/developer-hub/file?path=server%2Foversized.js', { user: 'approved' })).status, 413);
});

test('saves edits only to each approved developer isolated workspace', async () => {
  const original = 'module.exports = "repository";\n';
  const savedContent = 'module.exports = "workspace";\n';
  const rejected = await request('/api/developer-hub/file', {
    user: 'approved',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'server/source.js', content: savedContent })
  });
  assert.equal(rejected.status, 403, 'writes require same-origin validation');

  const saved = await request('/api/developer-hub/file', {
    user: 'approved',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ path: 'server/source.js', content: savedContent })
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, path: 'server/source.js', modified: true });
  assert.equal(fs.readFileSync(path.join(repositoryRoot, 'server', 'source.js'), 'utf8'), original);

  const workspaceFile = await request('/api/developer-hub/file?path=server%2Fsource.js', { user: 'approved' });
  assert.deepEqual(await workspaceFile.json(), {
    path: 'server/source.js',
    content: savedContent,
    originalContent: original,
    modified: true
  });
  const isolated = await request('/api/developer-hub/file?path=server%2Fsource.js', { user: 'approvedSecond' });
  assert.equal((await isolated.json()).content, original);
  const workspaceStatus = await request('/api/developer-hub/workspace', { user: 'approved' });
  assert.deepEqual((await workspaceStatus.json()).modifiedFiles, ['server/source.js']);
});

test('blocks likely secret material from being saved to the workspace', async () => {
  const response = await request('/api/developer-hub/file', {
    user: 'approved',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      path: 'server/source.js',
      content: 'const client_secret = "a-sensitive-value-that-is-not-safe";'
    })
  });
  assert.equal(response.status, 400);
});

test('rejects workspace roots that overlap the repository', () => {
  assert.throws(() => createDeveloperHubRouter({
    repositoryRoot,
    workspaceRoot: path.join(repositoryRoot, 'workspaces'),
    approvedUserIds: [],
    authenticate(_req, _res, next) { next(); }
  }), /outside the repository/);
});

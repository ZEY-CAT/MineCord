const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, test } = require('node:test');
const { createDevPortalRouter, hashPassword } = require('../server/dev-portal');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-dev-portal-'));
const repositoryRoot = path.join(temporaryDirectory, 'repository');
const publicDirectory = path.resolve(__dirname, '..', 'public');
const workspaceRoot = path.join(temporaryDirectory, 'workspaces');
const configPath = path.join(temporaryDirectory, 'DEV-LOGINS.json');
const vaultEncryptionKey = 'a'.repeat(64);
fs.mkdirSync(path.join(repositoryRoot, 'server'), { recursive: true });
fs.mkdirSync(path.join(repositoryRoot, 'public'), { recursive: true });
fs.writeFileSync(path.join(repositoryRoot, 'README.md'), 'MineCord\n');
fs.writeFileSync(path.join(repositoryRoot, 'package.json'), '{}\n');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'source.js'), 'module.exports = "repository";\n');
fs.writeFileSync(path.join(repositoryRoot, 'server', 'data.json'), '{"private":"user data"}');

const password = 'portal-test-password-is-long';
const saltFor = userPassword => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { passwordSalt: salt, passwordHash: hashPassword(userPassword, salt).toString('hex') };
};
const ownerId = crypto.randomUUID();
const developerId = crypto.randomUUID();
const secondDeveloperId = crypto.randomUUID();
const initialConfig = {
  version: 1,
  githubClientId: 'MineCordTestClientId',
  users: [
    { id: ownerId, username: 'ZEY-CAT', ...saltFor(password), role: 'owner', approved: true },
    { id: developerId, username: 'developer', ...saltFor(password), role: 'developer', approved: true },
    { id: secondDeveloperId, username: 'second-developer', ...saltFor(password), role: 'developer', approved: true }
  ],
  invitations: [],
  secrets: { TURN_SECRET: 'owner-only-test-value' }
};
fs.writeFileSync(configPath, JSON.stringify(initialConfig));

const githubCalls = [];
const openAiCalls = [];
let openAiOutput = 'MineCord assistant test response.';
let openAiStatus = 200;
let devicePollResponse = { access_token: 'gho_server_only_test_token' };
const fetchImpl = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || 'GET';
  if (url === 'https://api.openai.com/v1/responses') {
    openAiCalls.push({ headers: options.headers, body: JSON.parse(options.body) });
    if (openAiStatus !== 200) return new Response('{}', { status: openAiStatus });
    const events = [
      { type: 'response.output_text.delta', delta: openAiOutput },
      { type: 'response.completed' }
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(events, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  githubCalls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
  let value = {};
  if (url.endsWith('/login/device/code')) {
    value = { device_code: 'server-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };
  } else if (url.endsWith('/login/oauth/access_token')) {
    value = devicePollResponse;
  } else if (url.endsWith('/user')) {
    value = { login: 'test-developer' };
  } else if (url.endsWith('/repos/ZEY-CAT/MineCord')) {
    value = { full_name: 'ZEY-CAT/MineCord', permissions: { push: true } };
  } else if (url.endsWith('/branches?per_page=100')) {
    value = [{ name: 'main', commit: { sha: 'main-sha' } }, { name: 'feature/test', commit: { sha: 'feature-sha' } }];
  } else if (url.includes('/commits?sha=')) {
    value = [{ sha: 'commit-sha', commit: { message: 'A reviewed change', author: { name: 'Test', date: '2026-01-01T00:00:00Z' } }, html_url: 'https://github.com/ZEY-CAT/MineCord/commit/commit-sha' }];
  } else if (url.includes('/git/ref/heads/')) {
    value = { object: { sha: 'base-sha' } };
  } else if (url.includes('/git/commits/base-sha')) {
    value = { tree: { sha: 'tree-sha' } };
  } else if (url.endsWith('/check-runs?per_page=50')) {
    value = { check_runs: [{ name: 'test-and-build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/ZEY-CAT/MineCord/actions/runs/12' }] };
  } else if (url.includes('/contents/server/source.js?ref=main')) {
    value = { content: Buffer.from('module.exports = "repository";\n').toString('base64') };
  } else if (url.endsWith('/pulls')) {
    value = { number: 42, html_url: 'https://github.com/ZEY-CAT/MineCord/pull/42' };
  } else if (method === 'POST' && url.endsWith('/git/refs')) {
    value = { ref: 'refs/heads/dev/portal-test-deadbeef' };
  } else if (method === 'POST' && url.endsWith('/git/blobs')) {
    value = { sha: 'blob-sha' };
  } else if (method === 'POST' && url.endsWith('/git/trees')) {
    value = { sha: 'new-tree-sha' };
  } else if (method === 'POST' && url.endsWith('/git/commits')) {
    value = { sha: 'new-commit-sha' };
  } else if (method === 'PATCH' && url.includes('/git/refs/heads/')) {
    value = { object: { sha: 'new-commit-sha' } };
  }
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/dev', createDevPortalRouter({
  publicDirectory,
  repositoryRoot,
  workspaceRoot,
  configPath,
  vaultEncryptionKey,
  originAllowed: req => req.get('origin') === origin,
  fetchImpl,
  audit: () => {}
}));
const server = http.createServer(app);
server.listen(0, '127.0.0.1');
const ready = once(server, 'listening').then(() => {
  origin = `http://127.0.0.1:${server.address().port}`;
});
let origin;

after(async () => {
  if (server.listening) {
    server.close();
    await once(server, 'close');
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(pathname, { cookie, ...options } = {}) {
  await ready;
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${origin}${pathname}`, { ...options, headers });
}

async function login(username, passwordValue = password) {
  const response = await request('/dev/api/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: passwordValue })
  });
  return { response, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] };
}

test('serves a separate portal page and requires its own approved login', async () => {
  const page = await request('/dev');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Developer sign in/);
  assert.equal((await request('/dev/api/source/files')).status, 401);
  assert.equal((await request('/dev/api/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'missing', password })
  })).status, 401);
  const loggedIn = await login('developer');
  assert.equal(loggedIn.response.status, 200);
  assert.match(loggedIn.cookie, /^mc_dev_session=/);
  assert.match(loggedIn.response.headers.get('set-cookie'), /HttpOnly/i);
  const session = await request('/dev/api/session', { cookie: loggedIn.cookie });
  assert.deepEqual(await session.json(), {
    user: { id: developerId, username: 'developer', role: 'developer' }
  });
  assert.equal((await login('zey-cat')).response.status, 200);
});

test('requires same-origin writes and isolates file editing per portal developer', async () => {
  const first = await login('developer');
  const second = await login('ZEY-CAT');
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  const unapprovedOrigin = await request('/dev/api/source/file', {
    cookie: first.cookie,
    method: 'PUT',
    headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'server/source.js', content: 'changed\n' })
  });
  assert.equal(unapprovedOrigin.status, 403);
  const saved = await request('/dev/api/source/file', {
    cookie: first.cookie,
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'server/source.js', content: 'module.exports = "developer overlay";\n' })
  });
  assert.equal(saved.status, 200);
  assert.equal(fs.readFileSync(path.join(repositoryRoot, 'server', 'source.js'), 'utf8'), 'module.exports = "repository";\n');
  const otherWorkspace = await request('/dev/api/source/file?path=server%2Fsource.js', { cookie: second.cookie });
  assert.equal((await otherWorkspace.json()).content, 'module.exports = "repository";\n');
});

test('denies protected source files and workspace path traversal', async () => {
  const { cookie } = await login('developer');
  assert.equal((await request('/dev/api/source/file?path=server%2Fdata.json', { cookie })).status, 404);
  assert.equal((await request('/dev/api/source/file?path=server%2F..%2FREADME.md', { cookie })).status, 404);
});

test('owner-only vault cannot be read or changed by approved developers', async () => {
  const { cookie: developerCookie } = await login('developer');
  const { cookie: ownerCookie } = await login('ZEY-CAT');
  assert.equal((await request('/dev/api/secrets', { cookie: developerCookie })).status, 403);
  const listed = await request('/dev/api/secrets', { cookie: ownerCookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await listed.json(), {
    keys: ['TURN_SECRET'], encryptionConfigured: true, legacyEntriesNeedMigration: false
  });
  assert.equal((await request('/dev/api/secrets', {
    cookie: developerCookie,
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secrets: { ROOT_TOKEN: 'stolen' } })
  })).status, 403);
  const saved = await request('/dev/api/secrets', {
    cookie: ownerCookie,
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: { TURN_SECRET: 'updated-owner-value', OAUTH_SECRET: 'another-owner-value' } })
  });
  assert.equal(saved.status, 200);
  const responseBody = await saved.text();
  assert.deepEqual(JSON.parse(responseBody).keys, ['OAUTH_SECRET', 'TURN_SECRET']);
  assert.equal(responseBody.includes('updated-owner-value'), false);
  assert.equal(responseBody.includes('another-owner-value'), false);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.secrets.TURN_SECRET.algorithm, 'aes-256-gcm');
  assert.equal(config.secrets.OAUTH_SECRET.algorithm, 'aes-256-gcm');
  assert.equal(JSON.stringify(config.secrets).includes('updated-owner-value'), false);
  assert.equal(JSON.stringify(config.secrets).includes('another-owner-value'), false);
  const removed = await request('/dev/api/secrets', {
    cookie: ownerCookie,
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove: ['OAUTH_SECRET'] })
  });
  assert.deepEqual((await removed.json()).keys, ['TURN_SECRET']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(configPath, 'utf8')).secrets), ['TURN_SECRET']);
});

test('owner invitations are single-use and create isolated approved portal accounts', async () => {
  const { cookie: ownerCookie } = await login('ZEY-CAT');
  const inviteResponse = await request('/dev/api/invitations', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ lifetimeHours: 24 })
  });
  assert.equal(inviteResponse.status, 201);
  const invite = await inviteResponse.json();
  const shortPassword = await request('/dev/api/invitations/redeem', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invite.token, username: 'short-pass', password: 'short77' })
  });
  assert.equal(shortPassword.status, 400);
  const tooLongPassword = await request('/dev/api/invitations/redeem', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invite.token, username: 'long-pass', password: 'a'.repeat(201) })
  });
  assert.equal(tooLongPassword.status, 400);
  const redeemed = await request('/dev/api/invitations/redeem', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invite.token, username: 'new-dev', password: 'eight888' })
  });
  assert.equal(redeemed.status, 201);
  assert.equal((await request('/dev/api/invitations/redeem', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invite.token, username: 'another-dev', password: 'eight888' })
  })).status, 400);
  assert.equal((await login('new-dev', 'eight888')).response.status, 200);
  const maximumInviteResponse = await request('/dev/api/invitations', {
    cookie: ownerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ lifetimeHours: 24 })
  });
  assert.equal(maximumInviteResponse.status, 201);
  const maximumInvite = await maximumInviteResponse.json();
  const maximumPassword = 'a'.repeat(200);
  assert.equal((await request('/dev/api/invitations/redeem', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: maximumInvite.token, username: 'max-pass', password: maximumPassword })
  })).status, 201);
  assert.equal((await login('max-pass', maximumPassword)).response.status, 200);
});

test('GitHub device token remains server-side and explicit confirmation is required to push', async () => {
  const { cookie } = await login('developer');
  const device = await request('/dev/api/github/device', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(device.status, 200);
  assert.deepEqual(await device.json(), {
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 900
  });
  const poll = await request('/dev/api/github/device/poll', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.deepEqual(await poll.json(), { connected: true, login: 'test-developer' });
  assert.ok(!poll.headers.get('set-cookie')?.includes('gho_server_only_test_token'));
  const status = await request('/dev/api/github/status', { cookie });
  assert.deepEqual(await status.json(), {
    connected: true, login: 'test-developer', repository: 'ZEY-CAT/MineCord', canPush: true
  });
  const branches = await request('/dev/api/github/branches', { cookie });
  assert.deepEqual((await branches.json()).branches.map(branch => branch.name), ['main', 'feature/test']);
  const checks = await request('/dev/api/github/checks?branch=main', { cookie });
  assert.deepEqual((await checks.json()).checks, [{
    name: 'test-and-build', status: 'completed', conclusion: 'success',
    url: 'https://github.com/ZEY-CAT/MineCord/actions/runs/12'
  }]);
  const rejectedPush = await request('/dev/api/github/push', {
    cookie,
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: ['server/source.js'], branchName: 'portal-test', message: 'test change' })
  });
  assert.equal(rejectedPush.status, 400);
  assert.equal(githubCalls.some(call => call.url.endsWith('/pulls')), false);
});

test('explicit GitHub approval pushes only selected safe files and opens a pull request', async () => {
  const { cookie } = await login('developer');
  await request('/dev/api/github/device', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  await request('/dev/api/github/device/poll', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  const source = await request('/dev/api/source/file', { cookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'server/source.js', content: 'module.exports = "reviewed";\n' })
  });
  assert.equal(source.status, 200);
  const response = await request('/dev/api/github/push', {
    cookie,
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmPush: true, createPullRequest: true, baseBranch: 'main',
      branchName: 'portal-test', message: 'Add a reviewed portal change', files: ['server/source.js']
    })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(result.branch, /^dev\/portal-test-[a-f0-9]{8}$/);
  assert.equal(result.commit, 'new-commit-sha');
  assert.deepEqual(result.pullRequest, { number: 42, url: 'https://github.com/ZEY-CAT/MineCord/pull/42' });
  assert.equal(githubCalls.some(call => call.url.endsWith('/git/refs') && call.method === 'POST'), true);
  assert.equal(githubCalls.some(call => call.url.endsWith('/pulls') && call.method === 'POST'), true);
  assert.equal(githubCalls.some(call => call.url.endsWith('/merge')), false);
  assert.equal(fs.readFileSync(path.join(repositoryRoot, 'server', 'source.js'), 'utf8'), 'module.exports = "repository";\n');
});

test('GitHub push refuses dirty file baselines and secret content', async () => {
  const { cookie } = await login('developer');
  await request('/dev/api/github/device', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  await request('/dev/api/github/device/poll', {
    cookie, method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  const save = content => request('/dev/api/source/file', {
    cookie, method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'server/source.js', content })
  });
  const blockedSave = await save('const access_token = "sensitive_value_not_for_github";\n');
  assert.equal(blockedSave.status, 400, 'workspace saves must scan for secrets');
  const isolatedWorkspace = path.join(workspaceRoot, crypto.createHash('sha256').update(developerId).digest('hex'));
  fs.writeFileSync(path.join(isolatedWorkspace, 'server', 'source.js'), 'const access_token = "sensitive_value_not_for_github";\n');
  const response = await request('/dev/api/github/push', {
    cookie,
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmPush: true, createPullRequest: true, baseBranch: 'main',
      branchName: 'portal-secret-test', message: 'Prevent a secret from being pushed', files: ['server/source.js']
    })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /secret scanning/i);
});

test('portal owners can securely grant and revoke additional owner access', async () => {
  const { cookie: ownerCookie } = await login('zey-cat');
  const denied = await request(`/dev/api/users/${secondDeveloperId}/role`, {
    cookie: ownerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'owner', ownerPassword: 'wrong-password' })
  });
  assert.equal(denied.status, 403);
  const promoted = await request(`/dev/api/users/${secondDeveloperId}/role`, {
    cookie: ownerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'owner', ownerPassword: password })
  });
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).user.role, 'owner');
  const secondOwnerLogin = await login('second-developer');
  assert.equal(secondOwnerLogin.response.status, 200);
  const stillOwner = await request('/dev/api/ai/admin/config', { cookie: secondOwnerLogin.cookie });
  assert.equal(stillOwner.status, 200);
  const cannotDemotePrimaryOwner = await request(`/dev/api/users/${ownerId}/role`, {
    cookie: secondOwnerLogin.cookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', ownerPassword: password })
  });
  assert.equal(cannotDemotePrimaryOwner.status, 403);
  const selfDemotion = await request(`/dev/api/users/${secondDeveloperId}/role`, {
    cookie: secondOwnerLogin.cookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', ownerPassword: password })
  });
  assert.equal(selfDemotion.status, 400);
  const demoted = await request(`/dev/api/users/${secondDeveloperId}/role`, {
    cookie: ownerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', ownerPassword: password })
  });
  assert.equal(demoted.status, 200);
  assert.equal((await request('/dev/api/ai/admin/config', { cookie: secondOwnerLogin.cookie })).status, 403);
  const primaryOwnerProtection = await request(`/dev/api/users/${ownerId}/role`, {
    cookie: ownerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', ownerPassword: password })
  });
  assert.equal(primaryOwnerProtection.status, 403);
});

test('developers can change their portal password and other sessions are revoked', async () => {
  const first = await login('developer');
  const second = await login('developer');
  const rejected = await request('/dev/api/password', {
    cookie: first.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'incorrect', newPassword: 'new-portal-password-long' })
  });
  assert.equal(rejected.status, 403);
  const changed = await request('/dev/api/password', {
    cookie: first.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, newPassword: 'eight888' })
  });
  assert.equal(changed.status, 200);
  const shortPassword = await request('/dev/api/password', {
    cookie: first.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'eight888', newPassword: 'short77' })
  });
  assert.equal(shortPassword.status, 400);
  const tooLongPassword = await request('/dev/api/password', {
    cookie: first.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'eight888', newPassword: 'a'.repeat(201) })
  });
  assert.equal(tooLongPassword.status, 400);
  const maximumPassword = 'b'.repeat(200);
  assert.equal((await request('/dev/api/password', {
    cookie: first.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'eight888', newPassword: maximumPassword })
  })).status, 200);
  assert.equal((await request('/dev/api/session', { cookie: second.cookie })).status, 200);
  assert.deepEqual(await (await request('/dev/api/session', { cookie: second.cookie })).json(), { user: null });
  assert.equal((await login('developer', 'eight888')).response.status, 401);
  const replacement = await login('developer', maximumPassword);
  assert.equal(replacement.response.status, 200);
  assert.equal((await request('/dev/api/password', {
    cookie: replacement.cookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: maximumPassword, newPassword: password })
  })).status, 200);
});

test('AI uses encrypted owner credentials, isolates histories, filters context, streams and reviews patches', async () => {
  const unauthenticated = await request('/dev/api/ai/providers');
  assert.equal(unauthenticated.status, 401);
  const { cookie: ownerCookie } = await login('ZEY-CAT');
  const { cookie: developerCookie } = await login('developer');
  const deniedConfig = await request('/dev/api/ai/admin/config', { cookie: developerCookie });
  assert.equal(deniedConfig.status, 403);
  assert.equal((await request('/dev/api/ai/admin/config', {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1-mini' })
  })).status, 403);
  const missingProviders = await (await request('/dev/api/ai/providers', { cookie: developerCookie })).json();
  assert.equal(missingProviders.providers.openai.available, false);
  const missingCredentials = await request('/dev/api/ai/conversations', {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai' })
  });
  assert.equal(missingCredentials.status, 503);
  const missingError = await missingCredentials.json();
  assert.match(missingError.error, /not configured/i);
  assert.doesNotMatch(JSON.stringify(missingError), /sk-test|api key=/i);
  const saveConfig = await request('/dev/api/ai/admin/config', {
    cookie: ownerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1-mini', apiKey: 'sk-test_123456789012345678901234' })
  });
  assert.equal(saveConfig.status, 200);
  const configResponse = await saveConfig.text();
  assert.equal(configResponse.includes('sk-test_123456789012345678901234'), false);
  const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(localConfig.secrets.OPENAI_API_KEY.algorithm, 'aes-256-gcm');
  assert.equal(JSON.stringify(localConfig.secrets).includes('sk-test_123456789012345678901234'), false);
  const providersResponse = await request('/dev/api/ai/providers', { cookie: developerCookie });
  const providers = await providersResponse.json();
  assert.equal(providers.providers.openai.available, true);
  assert.equal(providers.providers.copilot.available, false);
  assert.equal(providers.providers.copilot.mode, 'external');
  assert.equal(JSON.stringify(providers).includes('sk-test_123456789012345678901234'), false);
  const preference = await request('/dev/api/ai/preference', {
    cookie: developerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'copilot' })
  });
  assert.deepEqual(await preference.json(), { preference: 'copilot' });
  assert.deepEqual((await (await request('/dev/api/ai/providers', { cookie: developerCookie })).json()).preference, 'copilot');
  assert.equal((await request('/dev/api/ai/conversations', { cookie: ownerCookie })).status, 200);
  const conversationResponse = await request('/dev/api/ai/conversations', {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai' })
  });
  assert.equal(conversationResponse.status, 201);
  const conversation = (await conversationResponse.json()).conversation;
  assert.equal((await request(`/dev/api/ai/conversations/${conversation.id}`, { cookie: ownerCookie })).status, 404);
  const newContent = 'Reviewed by the MineCord AI workspace.\n';
  openAiOutput = `Here is the proposed change.\n\`\`\`minecord-patches\n${JSON.stringify({ files: [{ path: 'README.md', content: newContent }] })}\n\`\`\``;
  const streamed = await request(`/dev/api/ai/conversations/${conversation.id}/chat`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Suggest a small README update', context: { paths: ['README.md'] } })
  });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
  const streamText = await streamed.text();
  assert.match(streamText, /event: delta/);
  assert.match(streamText, /event: done/);
  const apiCall = openAiCalls.at(-1);
  assert.equal(apiCall.headers.Authorization, 'Bearer sk-test_123456789012345678901234');
  assert.equal(apiCall.body.store, false);
  assert.match(apiCall.body.input[1].content, /README\.md/);
  assert.doesNotMatch(apiCall.body.input[1].content, /server\/data\.json|private.*user data/i);
  const proposal = JSON.parse(streamText.split('event: done\ndata: ')[1].split('\n')[0]).proposal;
  assert.equal(proposal.files[0].path, 'README.md');
  const unapproved = await request(`/dev/api/ai/proposals/${proposal.id}/apply`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
  assert.equal(unapproved.status, 400);
  const applied = await request(`/dev/api/ai/proposals/${proposal.id}/apply`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true })
  });
  assert.equal(applied.status, 200);
  const developerWorkspace = path.join(workspaceRoot, crypto.createHash('sha256').update(developerId).digest('hex'));
  assert.equal(fs.readFileSync(path.join(developerWorkspace, 'README.md'), 'utf8'), newContent);
  assert.equal(fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8'), 'MineCord\n');
  assert.equal((await request('/dev/api/ai/conversations', { cookie: ownerCookie })).status, 200);
  const beforeBlockedPrompt = openAiCalls.length;
  const blockedPrompt = await request(`/dev/api/ai/conversations/${conversation.id}/chat`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Please inspect this token sk-test_123456789012345678901234', context: { paths: [] } })
  });
  assert.equal(blockedPrompt.status, 400);
  assert.equal(openAiCalls.length, beforeBlockedPrompt);
  openAiOutput = `One more safe change.\n\`\`\`minecord-patches\n${JSON.stringify({ files: [{ path: 'README.md', content: 'Another proposed edit.\n' }] })}\n\`\`\``;
  const staleStream = await request(`/dev/api/ai/conversations/${conversation.id}/chat`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Propose another README edit', context: { paths: ['README.md'] } })
  });
  const staleProposal = JSON.parse((await staleStream.text()).split('event: done\ndata: ')[1].split('\n')[0]).proposal;
  assert.ok(staleProposal);
  const interveningEdit = await request('/dev/api/source/file', {
    cookie: developerCookie, method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'README.md', content: 'An intervening workspace edit.\n' })
  });
  assert.equal(interveningEdit.status, 200);
  const staleApply = await request(`/dev/api/ai/proposals/${staleProposal.id}/apply`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true })
  });
  assert.equal(staleApply.status, 409);
  const rejectedProposal = await request(`/dev/api/ai/proposals/${staleProposal.id}`, {
    cookie: developerCookie, method: 'DELETE', headers: { Origin: origin }
  });
  assert.equal(rejectedProposal.status, 200);
  assert.equal((await request(`/dev/api/ai/proposals/${staleProposal.id}/apply`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true })
  })).status, 404);
  const beforeBlockedContext = openAiCalls.length;
  const blockedContext = await request(`/dev/api/ai/conversations/${conversation.id}/chat`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Inspect private storage', context: { paths: ['server/data.json'] } })
  });
  assert.equal(blockedContext.status, 404);
  assert.equal(openAiCalls.length, beforeBlockedContext);
  openAiStatus = 401;
  const rejectedCredential = await request(`/dev/api/ai/conversations/${conversation.id}/chat`, {
    cookie: developerCookie, method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Check provider status', context: { paths: [] } })
  });
  assert.equal(rejectedCredential.status, 502);
  const providerError = await rejectedCredential.json();
  assert.match(providerError.error, /configured API key/i);
  assert.doesNotMatch(JSON.stringify(providerError), /sk-test/);
  openAiStatus = 200;
});

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const WebSocket = require('ws');

test('HTTP merge requires proof of both accounts and invalidates source sessions', { timeout: 60000 }, async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-merge-test-'));
  const databaseFile = path.join(tempDir, 'merge.sqlite');
  const init = spawnSync(process.execPath, ['-e', `require('./server/database').writeState({
    users: {}, servers: [], messages: {}, friends: {}, invites: {},
    oauthStates: {}, gameActivities: {}, dmRead: {}
  })`], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseFile },
    encoding: 'utf8'
  });
  if (init.status !== 0) throw new Error(`Could not initialize merge test database: ${init.stderr}`);

  const listener = http.createServer();
  const port = await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const assigned = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(assigned));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: origin,
      DATABASE_URL: databaseFile,
      APP_OWNER_USER_ID: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      MICROSOFT_CLIENT_ID: '',
      MICROSOFT_CLIENT_SECRET: '',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: ''
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  let sourceSocket;
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });

  async function waitForServer() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Merge test server exited: ${stderr}`);
      try {
        const response = await fetch(`${origin}/api/config`);
        if (response.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Merge test server did not start: ${stderr}`);
  }
  async function register(username) {
    const response = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username, password: 'Strong-merge-test-passphrase!' })
    });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';', 1)[0];
  }
  async function post(url, cookie, body) {
    return fetch(`${origin}${url}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body)
    });
  }

  try {
    await waitForServer();
    const targetCookie = await register('merge_target');
    const sourceCookie = await register('merge_source');
    sourceSocket = new WebSocket(origin.replace(/^http/, 'ws'), {
      headers: { Cookie: sourceCookie, Origin: origin }
    });
    await once(sourceSocket, 'open');
    const unauthenticated = await fetch(`${origin}/api/accounts/merge/target-password`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    const sourceWithoutTargetProof = await post('/api/accounts/merge/source-password', sourceCookie, {
      username: 'merge_target',
      password: 'Strong-merge-test-passphrase!'
    });
    assert.equal(sourceWithoutTargetProof.status, 401);
    const sameAccountProof = await post('/api/accounts/merge/source-password', targetCookie, {
      username: 'merge_target',
      password: 'Strong-merge-test-passphrase!'
    });
    assert.equal(sameAccountProof.status, 401);

    const badDestinationPassword = await post('/api/accounts/merge/target-password', targetCookie, { password: 'wrong' });
    assert.equal(badDestinationPassword.status, 401);
    const targetProof = await post('/api/accounts/merge/target-password', targetCookie, { password: 'Strong-merge-test-passphrase!' });
    assert.equal(targetProof.status, 200);
    const badSourcePassword = await post('/api/accounts/merge/source-password', targetCookie, { username: 'merge_source', password: 'wrong' });
    assert.equal(badSourcePassword.status, 401);
    const sourceProof = await post('/api/accounts/merge/source-password', targetCookie, {
      username: 'merge_source',
      password: 'Strong-merge-test-passphrase!'
    });
    assert.equal(sourceProof.status, 200);
    const { previewToken, preview } = await sourceProof.json();
    assert.equal(preview.destination.username, 'merge_target');
    assert.equal(preview.source.username, 'merge_source');

    const stolenPreview = await fetch(`${origin}/api/accounts/merge/preview/${encodeURIComponent(previewToken)}`, { headers: { Cookie: sourceCookie } });
    assert.equal(stolenPreview.status, 403);
    const rejectedConfirmation = await post('/api/accounts/merge/confirm', targetCookie, { token: previewToken, confirm: false });
    assert.equal(rejectedConfirmation.status, 400);
    const sourceSocketClosed = once(sourceSocket, 'close');
    const merge = await post('/api/accounts/merge/confirm', targetCookie, { token: previewToken, confirm: true });
    assert.equal(merge.status, 200);
    assert.equal((await merge.json()).username, 'merge_target');
    await sourceSocketClosed;

    const sourceSessionRevoked = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: sourceCookie } });
    assert.equal(sourceSessionRevoked.status, 401);
    const sourceUsernameAliasLogin = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: 'merge_source', password: 'Strong-merge-test-passphrase!' })
    });
    assert.equal(sourceUsernameAliasLogin.status, 200);
    assert.equal((await sourceUsernameAliasLogin.json()).user.username, 'merge_target');
    const mergedCookie = sourceUsernameAliasLogin.headers.get('set-cookie').split(';', 1)[0];
    const reauthenticatedTarget = await post('/api/accounts/merge/target-password', mergedCookie, {
      password: 'Strong-merge-test-passphrase!'
    });
    assert.equal(reauthenticatedTarget.status, 200);
    const repeatSourceProof = await post('/api/accounts/merge/source-password', mergedCookie, {
      username: 'merge_source',
      password: 'Strong-merge-test-passphrase!'
    });
    assert.equal(repeatSourceProof.status, 400);
  } finally {
    if (sourceSocket && sourceSocket.readyState !== WebSocket.CLOSED) {
      const closed = once(sourceSocket, 'close');
      sourceSocket.close();
      await closed;
    }
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = http.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(databaseFile, preloadFile) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['-r', preloadFile, 'server/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: origin,
      MICROSOFT_CALLBACK_URL: `${origin}/auth/microsoft/callback`,
      MICROSOFT_CLIENT_ID: 'oauth-test-client',
      MICROSOFT_CLIENT_SECRET: 'oauth-test-server-secret',
      DATABASE_URL: databaseFile,
      APP_OWNER_USER_ID: '',
      METERED_SECRET_KEY: ''
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`OAuth test server exited early: ${stderr}`);
    try {
      const response = await fetch(`${origin}/api/config`);
      if (response.ok) return { child, origin };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`OAuth test server did not start: ${stderr}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function beginMicrosoftSignIn(origin) {
  const response = await fetch(`${origin}/auth/microsoft`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get('location'));
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  const cookie = response.headers.getSetCookie()
    .find(value => value.startsWith('mc_oauth_state='))
    .split(';', 1)[0];
  assert.equal(decodeURIComponent(cookie.slice('mc_oauth_state='.length)), state);
  return { state, cookie };
}

function createTestFiles() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'minecord-oauth-state-'));
  const databaseFile = path.join(directory, 'oauth.sqlite');
  const preloadFile = path.join(directory, 'mock-provider.js');
  writeFileSync(preloadFile, `
    global.fetch = async input => {
      const url = String(input);
      if (url.includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
      }
      if (url === 'https://graph.microsoft.com/v1.0/me') {
        return new Response(JSON.stringify({ id: 'microsoft-account-test-id', displayName: 'OAuth Test Player' }), { status: 200 });
      }
      throw new Error('Unexpected provider URL in OAuth test.');
    };
  `);
  const initialized = spawnSync(process.execPath, ['-e', `require('./server/database').writeState({
    users:{},servers:[],messages:{},friends:{},invites:{},oauthStates:{},gameActivities:{},dmRead:{}
  })`], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseFile },
    encoding: 'utf8'
  });
  if (initialized.status !== 0) throw new Error(`Could not initialize OAuth test database: ${initialized.stderr}`);
  return { directory, databaseFile, preloadFile };
}

test('Microsoft OAuth state survives process changes and callback completes once', async t => {
  const files = createTestFiles();
  let first, callbackServer, restarted;
  t.after(async () => {
    if (first) await stopServer(first.child);
    if (callbackServer) await stopServer(callbackServer.child);
    if (restarted) await stopServer(restarted.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  first = await startServer(files.databaseFile, files.preloadFile);
  const { state, cookie } = await beginMicrosoftSignIn(first.origin);
  callbackServer = await startServer(files.databaseFile, files.preloadFile);
  const callbackUrl = `${callbackServer.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`;
  const withoutBrowserState = await fetch(callbackUrl, { redirect: 'manual' });
  assert.equal(withoutBrowserState.status, 400);
  const callback = await fetch(callbackUrl, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?oauth=success');
  const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith('mc_session='));
  assert.ok(sessionCookie);

  const profile = await fetch(`${callbackServer.origin}/api/auth/me`, {
    headers: { Cookie: sessionCookie.split(';', 1)[0] }
  });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.displayName, 'OAuth Test Player');

  await stopServer(first.child);
  first = null;
  await stopServer(callbackServer.child);
  callbackServer = null;
  restarted = await startServer(files.databaseFile, files.preloadFile);
  const replay = await fetch(`${restarted.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(replay.status, 400);
});

test('Microsoft OAuth rejects missing and unknown state without accepting a callback', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const missing = await fetch(`${server.origin}/auth/microsoft/callback?code=approved-test-code`);
  assert.equal(missing.status, 400);
  const unknown = await fetch(`${server.origin}/auth/microsoft/callback?state=not-issued&code=approved-test-code`);
  assert.equal(unknown.status, 400);
});

test('Microsoft OAuth rejects a callback from a different provider', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const { state, cookie } = await beginMicrosoftSignIn(server.origin);
  const mismatched = await fetch(`${server.origin}/auth/google/callback?state=${encodeURIComponent(state)}&code=approved-test-code`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(mismatched.status, 400);
  const correctProvider = await fetch(`${server.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(correctProvider.status, 302);
  assert.equal(correctProvider.headers.get('location'), '/?oauth=success');
});

test('Microsoft OAuth rejects expired state', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const { state } = await beginMicrosoftSignIn(server.origin);
  const database = new DatabaseSync(files.databaseFile);
  database.prepare('UPDATE oauth_states SET expires_at = 0 WHERE state = ?').run(state);
  database.close();
  const expired = await fetch(`${server.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`);
  assert.equal(expired.status, 400);
});

test('Microsoft OAuth refuses to begin when its state cannot be persisted', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const database = new DatabaseSync(files.databaseFile);
  database.exec(`CREATE TRIGGER reject_oauth_state BEFORE INSERT ON oauth_states
    BEGIN SELECT RAISE(ABORT, 'simulated OAuth state persistence failure'); END`);
  database.close();
  const response = await fetch(`${server.origin}/auth/microsoft`, { redirect: 'manual' });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('location'), null);
});

test('OAuth account linking requires the initiating browser cookie and preserves the MINECORD session', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const registration = await fetch(`${server.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ username: 'oauth_link_user', password: 'Long-oauth-test-passphrase!' })
  });
  assert.equal(registration.status, 201);
  const sessionCookie = registration.headers.getSetCookie().find(value => value.startsWith('mc_session=')).split(';', 1)[0];
  const start = await fetch(`${server.origin}/api/auth/links/microsoft/start`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json', Origin: server.origin },
    body: '{}'
  });
  assert.equal(start.status, 200);
  const state = new URL((await start.json()).authorizeUrl).searchParams.get('state');
  const stateSetCookie = start.headers.getSetCookie().find(value => value.startsWith('mc_oauth_state='));
  const stateCookie = stateSetCookie.split(';', 1)[0];
  assert.equal(decodeURIComponent(stateCookie.slice('mc_oauth_state='.length)), state);
  assert.match(stateSetCookie, /httponly/i);
  assert.match(stateSetCookie, /samesite=lax/i);
  assert.match(stateSetCookie, /path=\/auth\/microsoft\/callback/i);

  const callbackUrl = `${server.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`;
  const unbound = await fetch(callbackUrl, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(unbound.status, 400);
  const linked = await fetch(callbackUrl, { headers: { Cookie: `${sessionCookie}; ${stateCookie}` }, redirect: 'manual' });
  assert.equal(linked.status, 302);
  assert.equal(linked.headers.get('location'), '/?account_link=success');

  const currentSession = await fetch(`${server.origin}/api/auth/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(currentSession.status, 200);
  assert.equal((await currentSession.json()).user.username, 'oauth_link_user');
});

test('Minecraft linking state is browser-bound and still requires the original MINECORD session', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const registration = await fetch(`${server.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ username: 'minecraft_link_user', password: 'Long-oauth-test-passphrase!' })
  });
  const sessionCookie = registration.headers.getSetCookie().find(value => value.startsWith('mc_session=')).split(';', 1)[0];
  async function startMinecraftLink() {
    const response = await fetch(`${server.origin}/auth/minecraft/link`, {
      headers: { Cookie: sessionCookie },
      redirect: 'manual'
    });
    assert.equal(response.status, 302);
    const state = new URL(response.headers.get('location')).searchParams.get('state');
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('mc_oauth_state=')).split(';', 1)[0];
    return {
      state,
      cookie,
      callbackUrl: `${server.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`
    };
  }

  const first = await startMinecraftLink();
  const unbound = await fetch(first.callbackUrl, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(unbound.status, 400);
  const bound = await fetch(first.callbackUrl, { headers: { Cookie: `${sessionCookie}; ${first.cookie}` }, redirect: 'manual' });
  assert.equal(bound.status, 302);
  assert.equal(bound.headers.get('location'), '/?minecraft_link_error=link_failed');

  const second = await startMinecraftLink();
  const withoutSession = await fetch(second.callbackUrl, { headers: { Cookie: second.cookie }, redirect: 'manual' });
  assert.equal(withoutSession.status, 401);
});

test('account-merge OAuth proof requires the originating browser and session', async t => {
  const files = createTestFiles();
  const server = await startServer(files.databaseFile, files.preloadFile);
  t.after(async () => {
    await stopServer(server.child);
    rmSync(files.directory, { recursive: true, force: true });
  });

  const registration = await fetch(`${server.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ username: 'merge_oauth_user', password: 'Long-oauth-test-passphrase!' })
  });
  const sessionCookie = registration.headers.getSetCookie().find(value => value.startsWith('mc_session=')).split(';', 1)[0];
  const start = await fetch(`${server.origin}/api/accounts/merge/target-oauth/start`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ provider: 'microsoft' })
  });
  assert.equal(start.status, 200);
  const state = new URL((await start.json()).authorizeUrl).searchParams.get('state');
  const stateCookie = start.headers.getSetCookie().find(value => value.startsWith('mc_oauth_state=')).split(';', 1)[0];
  const callbackUrl = `${server.origin}/auth/microsoft/callback?state=${encodeURIComponent(state)}&code=approved-test-code`;

  const unbound = await fetch(callbackUrl, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(unbound.status, 400);
  const verified = await fetch(callbackUrl, { headers: { Cookie: `${sessionCookie}; ${stateCookie}` }, redirect: 'manual' });
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.get('location'), '/#merge-error=target-proof-failed');
});

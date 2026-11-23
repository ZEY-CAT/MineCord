const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const marker = '(async()=>{\n  show(\'login\',true);';
const start = html.indexOf(marker);
if (start < 0) throw new Error('Could not find MineCord authentication startup.');
const endMarker = '\n})();';
const end = html.indexOf(endMarker, start);
if (end < 0) throw new Error('Could not find the end of MineCord authentication startup.');
const startupScript = html.slice(start, end + endMarker.length)
  .replace('(async()=>{', 'globalThis.__startup=(async()=>{');
const loginMatch = html.match(/async function login\(createAccount\)\{[\s\S]*?\}\$\('password'\)\.onkeydown/);
if (!loginMatch) throw new Error('Could not find MineCord local login and registration handler.');
const loginScript = loginMatch[0].slice(0, -"$('password').onkeydown".length);

test('login offers the canonical MineCord website route and a copy-link fallback', () => {
  assert.match(html, /Sign in with website/);
  assert.match(html, /location\.href='https:\/\/minecord-8vg2\.onrender\.com\/app'/);
  assert.match(html, /Copy sign-in link/);
  assert.match(html, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(html, /MineCord sign-in link copied\./);
});

async function runStartup({ search = '', authenticated = false, inviteResponse } = {}) {
  const loginError = { textContent: '' };
  const shown = [];
  const alerts = [];
  const redirects = [];
  const historyUpdates = [];
  const requests = [];
  const oauthButtons = [{}, {}, {}];
  const context = {
    URLSearchParams,
    encodeURIComponent,
    location: {
      search,
      hash: '',
      replace: value => redirects.push(value)
    },
    history: { replaceState: (_state, _title, url) => historyUpdates.push(url) },
    document: { querySelectorAll: () => oauthButtons },
    localStorage: { getItem: key => key === 'gamerUi' ? 'false' : null },
    show: (id, visible) => shown.push([id, visible]),
    showAlert: (message, title) => alerts.push({ message, title }),
    connect: () => { context.connections += 1; },
    connections: 0,
    renderActivities: () => {},
    setInterval: () => {},
    fetch: async url => {
      requests.push(String(url));
      if (url === '/api/auth/me') {
        return { ok: authenticated, json: async () => ({ user: { username: 'test-user' } }) };
      }
      if (String(url).startsWith('/api/invite/preview?')) {
        return inviteResponse || { ok: true, json: async () => ({ server: { id: 'server' } }) };
      }
      if (url === '/api/config') {
        return { ok: true, json: async () => ({ google: false, microsoft: false, github: false }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  context.window = context;
  context.$ = id => id === 'loginError' ? loginError : null;
  vm.createContext(context);
  vm.runInContext(startupScript, context);
  await context.__startup;
  await new Promise(resolve => setImmediate(resolve));
  return { context, loginError, shown, alerts, redirects, historyUpdates, requests, oauthButtons };
}

async function runLogin({ registration = false, search = '', password = 'a-valid-test-password' } = {}) {
  const loginError = { textContent: '' };
  const shown = [];
  const redirects = [];
  const requests = [];
  const context = {
    URLSearchParams,
    encodeURIComponent,
    location: { search, replace: value => redirects.push(value) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ user: { username: 'test-user' } }) };
    },
    show: (id, visible) => shown.push([id, visible]),
    connect: () => { context.connections += 1; },
    connections: 0
  };
  context.$ = id => {
    if (id === 'username') return { value: 'test-user' };
    if (id === 'password') return { value: password };
    if (id === 'loginError') return loginError;
    return null;
  };
  vm.createContext(context);
  vm.runInContext(loginScript, context);
  await context.login(registration);
  return { loginError, shown, redirects, requests, connections: context.connections };
}

test('ordinary authenticated login and registration enter the app without invitation messaging', async () => {
  for (const flow of ['login', 'registration']) {
    const result = await runLogin({ registration: flow === 'registration' });
    assert.equal(result.requests[0].url, `/api/auth/${flow === 'registration' ? 'register' : 'login'}`);
    assert.equal(result.redirects.length, 0, `${flow} must not redirect to an invitation`);
    assert.deepEqual(result.shown.slice(-1)[0], ['login', false]);
    assert.equal(result.connections, 1);
    assert.equal(result.loginError.textContent, '');
  }
  const sessionStartup = await runStartup({ authenticated: true });
  assert.deepEqual(sessionStartup.shown.slice(-1)[0], ['login', false]);
  assert.equal(sessionStartup.loginError.textContent, '');
});

test('registration validates 8–200 characters in the UI without restricting sign-in', async () => {
  const passwordInput = html.match(/<input id="password"[^>]*>/)?.[0];
  assert.ok(passwordInput);
  assert.doesNotMatch(passwordInput, /\bmaxlength=/i);

  const tooShortRegistration = await runLogin({ registration: true, password: 'seven77' });
  assert.equal(tooShortRegistration.requests.length, 0);
  assert.match(tooShortRegistration.loginError.textContent, /8-200 characters/);

  const minimumRegistration = await runLogin({ registration: true, password: 'eight888' });
  assert.equal(minimumRegistration.requests[0].url, '/api/auth/register');

  const maximumRegistration = await runLogin({ registration: true, password: 'x'.repeat(200) });
  assert.equal(maximumRegistration.requests[0].url, '/api/auth/register');

  const longRegistration = await runLogin({ registration: true, password: 'x'.repeat(201) });
  assert.equal(longRegistration.requests.length, 0);
  assert.match(longRegistration.loginError.textContent, /8-200 characters/);

  const legacyShortPasswordLogin = await runLogin({ password: 'oldpass' });
  assert.equal(legacyShortPasswordLogin.requests[0].url, '/api/auth/login');

  const longLegacyPasswordLogin = await runLogin({ password: 'x'.repeat(201) });
  assert.equal(longLegacyPasswordLogin.requests[0].url, '/api/auth/login');
  assert.equal(JSON.parse(longLegacyPasswordLogin.requests[0].options.body).password.length, 201);
});

test('OAuth login without an invitation returns to the normal app and cleans OAuth query state', async () => {
  const result = await runStartup({ search: '?oauth=success', authenticated: true });
  assert.deepEqual(result.redirects, []);
  assert.deepEqual(result.historyUpdates, ['/app']);
  assert.deepEqual(result.shown.slice(-1)[0], ['login', false]);
  assert.equal(result.loginError.textContent, '');
});

test('a valid invitation remains active and redirects an authenticated user to acceptance', async () => {
  const code = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const result = await runStartup({ search: `?invite=${code}`, authenticated: true });
  assert.deepEqual(result.redirects, [`/invite/${code}`]);
  assert.equal(result.historyUpdates.length, 0);

  const unauthenticated = await runStartup({ search: `?invite=${code}` });
  assert.equal(unauthenticated.loginError.textContent, 'Sign in or create an account to accept this server invitation.');
  assert.equal(unauthenticated.historyUpdates.length, 0);
  const afterPasswordLogin = await runLogin({ search: `?invite=${code}` });
  assert.deepEqual(afterPasswordLogin.redirects, [`/invite/${code}`]);
});

test('expired and malformed invitations show errors and clear stale invitation state', async () => {
  const expiredCode = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const expired = await runStartup({
    search: `?invite=${expiredCode}&tab=home`,
    inviteResponse: {
      ok: false,
      json: async () => ({ error: 'This invitation has expired, been revoked, or already been used.' })
    }
  });
  assert.equal(expired.loginError.textContent, 'This invitation has expired, been revoked, or already been used.');
  assert.deepEqual(expired.historyUpdates, ['/app?tab=home']);
  assert.deepEqual(expired.redirects, []);
  const expiredForSignedInUser = await runStartup({
    search: `?invite=${expiredCode}`,
    authenticated: true,
    inviteResponse: {
      ok: false,
      json: async () => ({ error: 'This invitation has expired, been revoked, or already been used.' })
    }
  });
  assert.deepEqual(expiredForSignedInUser.alerts, [{
    message: 'This invitation has expired, been revoked, or already been used.',
    title: 'Server Invitation'
  }]);

  const malformed = await runStartup({ search: '?invite=not-a-token' });
  assert.equal(malformed.loginError.textContent, 'This invitation link is invalid.');
  assert.deepEqual(malformed.historyUpdates, ['/app']);
  assert.equal(malformed.requests.some(url => url.includes('/api/invite/preview?')), false);
});

test('stale invitation state cannot redirect a subsequent normal login', async () => {
  const staleCode = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const expired = await runStartup({
    search: `?invite=${staleCode}`,
    inviteResponse: { ok: false, json: async () => ({ error: 'This invitation is no longer valid.' }) }
  });
  assert.deepEqual(expired.historyUpdates, ['/app']);

  const laterLogin = await runStartup({ authenticated: true });
  assert.deepEqual(laterLogin.redirects, []);
  assert.deepEqual(laterLogin.shown.slice(-1)[0], ['login', false]);
  assert.equal(laterLogin.context.connections, 1);
  assert.equal(laterLogin.loginError.textContent, '');
  const laterPasswordLogin = await runLogin();
  assert.deepEqual(laterPasswordLogin.redirects, []);
  assert.equal(laterPasswordLogin.connections, 1);
});

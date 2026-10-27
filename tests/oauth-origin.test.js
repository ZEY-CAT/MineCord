const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  normalizeOrigin,
  callbackUrl,
  callbackUrlFromState,
  originFromHost,
  originAllowed,
  isAllowedOrigin
} = require('../server/oauth-origin');

const localOptions = {
  appUrl: 'http://127.0.0.1:3000',
  port: 3000,
  allowedOrigins: ''
};

test('OAuth local origins follow the initiating LAN host and port', () => {
  assert.equal(
    originFromHost({ headers: { host: '192.168.1.50:3000' } }, localOptions),
    'http://192.168.1.50:3000'
  );
  assert.equal(
    originFromHost({ headers: { host: '10.0.0.20:3000' } }, localOptions),
    'http://10.0.0.20:3000'
  );
  assert.equal(
    originFromHost({ headers: { host: '192.168.1.50:4000' } }, localOptions),
    'http://127.0.0.1:3000'
  );
  assert.equal(
    originFromHost({ headers: { host: 'evil.example:3000' } }, localOptions),
    'http://127.0.0.1:3000'
  );
  assert.equal(isAllowedOrigin('http://192.168.1.50:3000', localOptions), true);
  assert.equal(isAllowedOrigin('https://192.168.1.50:3000', localOptions), false);
  assert.equal(isAllowedOrigin('http://192.168.1.50:4000', localOptions), false);
});

test('OAuth callback overrides do not send LAN flows back to localhost', () => {
  const options = {
    ...localOptions,
    env: { MICROSOFT_CALLBACK_URL: 'http://localhost:3000/auth/microsoft/callback' }
  };
  assert.equal(
    callbackUrl('microsoft', 'http://192.168.1.50:3000', options),
    'http://192.168.1.50:3000/auth/microsoft/callback'
  );
  assert.equal(
    callbackUrl('microsoft', 'http://127.0.0.1:3000', options),
    'http://127.0.0.1:3000/auth/microsoft/callback'
  );

  const publicOptions = {
    appUrl: 'https://minecord.example',
    port: 443,
    env: { MICROSOFT_CALLBACK_URL: 'https://minecord.example/auth/microsoft/callback' }
  };
  assert.equal(
    callbackUrl('microsoft', 'http://192.168.1.50:3000', publicOptions),
    'https://minecord.example/auth/microsoft/callback'
  );
});

test('OAuth state callback and explicit allowed origins are honored safely', () => {
  const state = {
    origin: 'http://192.168.1.50:3000',
    redirectUri: 'http://192.168.1.50:3000/auth/github/callback'
  };
  assert.equal(
    callbackUrlFromState('github', state, { headers: { host: '192.168.1.50:3000' } }, localOptions),
    'http://192.168.1.50:3000/auth/github/callback'
  );
  assert.equal(
    callbackUrlFromState('github', {}, { headers: { host: '192.168.1.50:3000' } }, localOptions),
    'http://192.168.1.50:3000/auth/github/callback'
  );

  const namedHostOptions = {
    ...localOptions,
    allowedOrigins: 'http://minecord.local:3000'
  };
  assert.equal(
    originFromHost({ headers: { host: 'minecord.local:3000' } }, namedHostOptions),
    'http://minecord.local:3000'
  );
  assert.equal(
    originAllowed(
      { headers: { origin: 'http://minecord.local:3000', host: 'minecord.local:3000' } },
      namedHostOptions
    ),
    true
  );
  assert.equal(
    originAllowed(
      { headers: { origin: 'http://evil.local:3000', host: 'minecord.local:3000' } },
      namedHostOptions
    ),
    false
  );
});

test('OAuth production origins reject LAN and malformed origins', () => {
  const options = {
    appUrl: 'https://minecord.example',
    port: 443,
    allowedOrigins: ''
  };
  assert.equal(
    originAllowed(
      { headers: { origin: 'https://minecord.example', host: 'minecord.example' } },
      options
    ),
    true
  );
  assert.equal(
    originAllowed(
      { headers: { origin: 'http://192.168.1.50:3000', host: '192.168.1.50:3000' } },
      options
    ),
    false
  );
  assert.equal(
    originFromHost({ headers: { host: '192.168.1.50:3000' } }, options),
    'https://minecord.example'
  );
  assert.equal(normalizeOrigin('https://minecord.example/path'), null);
  assert.equal(normalizeOrigin('https://user:pass@minecord.example'), null);
  assert.equal(normalizeOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeOrigin('https://minecord.example/?query=1'), null);
});

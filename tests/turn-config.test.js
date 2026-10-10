const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { createRtcConfig, DEFAULT_CREDENTIAL_TTL_SECONDS } = require('../server/turn-config');

test('RTC config provides STUN fallback and explains missing TURN setup', () => {
  const config = createRtcConfig('user-123', {});
  assert.deepEqual(config.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
  assert.equal(config.turn.configured, false);
  assert.match(config.warnings[0], /TURN relay is not configured/);
});

test('TURN REST credentials are short-lived, user-bound, and support configured transports', () => {
  const env = {
    STUN_URL: 'stun:stun.example.test:3478',
    TURN_URL: 'turn:turn.example.test:3478?transport=udp,turn:turn.example.test:3478?transport=tcp,turns:turn.example.test:5349?transport=tcp',
    TURN_SHARED_SECRET: 'test-only-shared-secret',
    TURN_CREDENTIAL_TTL_SECONDS: '900'
  };
  const now = 1_800_000_000_000;
  const config = createRtcConfig('user-123', env, now);
  assert.equal(config.turn.configured, true);
  assert.equal(config.turn.expiresAt, Math.floor(now / 1000) + 900);
  assert.deepEqual(config.iceServers[0].urls, ['stun:stun.l.google.com:19302', 'stun:stun.example.test:3478']);
  const turn = config.iceServers[1];
  assert.deepEqual(turn.urls, env.TURN_URL.split(','));
  assert.equal(turn.username, `${config.turn.expiresAt}:user-123`);
  assert.equal(turn.credential, crypto.createHmac('sha1', env.TURN_SHARED_SECRET).update(turn.username).digest('base64'));
  assert.equal(JSON.stringify(config).includes(env.TURN_SHARED_SECRET), false);
  assert.deepEqual(config.warnings, []);
});

test('TURN config never returns incomplete or legacy permanent credentials', () => {
  const incomplete = createRtcConfig('user-123', {
    TURN_URL: 'turn:turn.example.test:3478?transport=udp',
    TURN_USERNAME: 'permanent-user',
    TURN_CREDENTIAL: 'permanent-password'
  });
  assert.equal(incomplete.turn.configured, false);
  assert.equal(incomplete.iceServers.length, 1);
  assert.equal(JSON.stringify(incomplete).includes('permanent-user'), false);
  assert.equal(JSON.stringify(incomplete).includes('permanent-password'), false);
  assert.equal(incomplete.warnings.length, 2);
});

test('invalid TURN transports are rejected rather than silently advertised', () => {
  assert.throws(
    () => createRtcConfig('user-123', { TURN_URL: 'turns:turn.example.test:5349?transport=udp', TURN_SHARED_SECRET: 'secret' }),
    /cannot use UDP transport with a TLS TURN URL/
  );
  assert.throws(
    () => createRtcConfig('user-123', { TURN_URL: 'turn:turn.example.test:3478?transport=ws', TURN_SHARED_SECRET: 'secret' }),
    /transport must be udp or tcp/
  );
});

test('invalid temporary-credential TTL falls back to the safe default', () => {
  const config = createRtcConfig('user-123', {
    TURN_URL: 'turn:turn.example.test:3478',
    TURN_SHARED_SECRET: 'test-only-shared-secret',
    TURN_CREDENTIAL_TTL_SECONDS: '999999'
  }, 1_800_000_000_000);
  assert.equal(config.turn.expiresAt, Math.floor(1_800_000_000_000 / 1000) + DEFAULT_CREDENTIAL_TTL_SECONDS);
});

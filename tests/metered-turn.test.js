const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { CREDENTIAL_TTL_SECONDS, createMeteredTurnService } = require('../server/metered-turn');

const TURN_ICE_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: [
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp'
    ],
    username: 'temporary-turn-user',
    credential: 'temporary-turn-password'
  }
];

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockDatabase() {
  const records = new Map();
  return {
    records,
    findMeteredTurnCredential(userId) { return records.get(userId) || null; },
    saveMeteredTurnCredential(userId, credential) {
      records.set(userId, {
        username: credential.username,
        api_key: credential.apiKey,
        ice_servers: credential.iceServers,
        created_at: credential.createdAt,
        expires_at: credential.expiresAt
      });
    }
  };
}

test('Metered credentials are created with 24-hour expiry and ICE config is fetched server-side', async () => {
  const database = mockDatabase();
  const requests = [];
  const secretKey = 'test-metered-secret';
  const service = createMeteredTurnService({
    env: { METERED_APP_NAME: 'minecord', METERED_SECRET_KEY: secretKey },
    database,
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (requests.length === 1) return response({ username: 'provider-user', password: 'provider-password', apiKey: 'scoped-api-key' });
      return response(TURN_ICE_SERVERS);
    }
  });

  const config = await service.configForUser('opaque-account-id');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.origin, 'https://minecord.metered.live');
  assert.equal(requests[0].url.pathname, '/api/v1/turn/credential');
  assert.equal(requests[0].url.searchParams.get('secretKey'), secretKey);
  assert.equal(requests[0].options.method, 'POST');
  const creationBody = JSON.parse(requests[0].options.body);
  assert.equal(creationBody.expiryInSeconds, CREDENTIAL_TTL_SECONDS);
  assert.equal(creationBody.expiryInSeconds, 86400);
  assert.ok(creationBody.label.startsWith('minecord-'));
  assert.equal(creationBody.label.includes('opaque-account-id'), false);
  assert.equal(requests[1].url.pathname, '/api/v1/turn/credentials');
  assert.equal(requests[1].url.searchParams.get('apiKey'), 'scoped-api-key');
  assert.deepEqual(config.iceServers[0].urls, ['stun:stun.relay.metered.ca:80']);
  assert.deepEqual(config.iceServers[1], TURN_ICE_SERVERS[1]);
  assert.equal(config.turn.configured, true);
  assert.equal(config.turn.expiresAt, 1_800_086_400_000);
  assert.equal(JSON.stringify(config).includes(secretKey), false);
  assert.equal(JSON.stringify(config).includes('scoped-api-key'), false);
  assert.equal(database.records.get('opaque-account-id').api_key, 'scoped-api-key');
});

test('Metered credential and ICE config are reused for each account until expiry', async () => {
  const database = mockDatabase();
  let now = 1_800_000_000_000;
  let requests = 0;
  let created = 0;
  const service = createMeteredTurnService({
    env: { METERED_SECRET_KEY: 'test-metered-secret' },
    database,
    now: () => now,
    fetchImpl: async url => {
      requests++;
      if (new URL(url).pathname.endsWith('/credential')) {
        created++;
        return response({ username: `provider-user-${created}`, apiKey: `scoped-api-key-${created}` });
      }
      return response(TURN_ICE_SERVERS);
    }
  });

  await service.configForUser('user-1');
  await service.configForUser('user-1');
  assert.equal(requests, 2);
  now += CREDENTIAL_TTL_SECONDS * 1000;
  const refreshed = await service.configForUser('user-1');
  assert.equal(requests, 4);
  assert.equal(refreshed.turn.expiresAt, now + CREDENTIAL_TTL_SECONDS * 1000);
});

test('Metered credentials persist in SQLite across server processes', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-metered-'));
  const databaseFile = path.join(tempDir, 'state.sqlite');
  const env = { ...process.env, DATABASE_URL: databaseFile };
  try {
    const write = spawnSync(process.execPath, ['-e', `
      const db=require('./server/database');
      db.writeState({
        users:{alice:{id:'user-1',displayName:'Alice',createdAt:1}},
        servers:[],messages:{},friends:{},invites:{},oauthStates:{},gameActivities:{},dmRead:{}
      });
      db.saveMeteredTurnCredential('user-1',{
        username:'metered-user',apiKey:'scoped-api-key',
        iceServers:[{urls:'stun:stun.relay.metered.ca:80'}],
        createdAt:1000,expiresAt:86500000
      });
    `], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr || write.stdout);
    const read = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict');
      const db=require('./server/database');
      const record=db.findMeteredTurnCredential('user-1');
      assert.equal(record.username,'metered-user');
      assert.equal(record.api_key,'scoped-api-key');
      assert.deepEqual(record.ice_servers,[{urls:'stun:stun.relay.metered.ca:80'}]);
      assert.equal(record.expires_at,86500000);
      assert.equal(db.findMeteredTurnCredential('other-user'),null);
    `], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr || read.stdout);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Metered credential provisioning is serialized across simultaneous requests', async () => {
  const database = mockDatabase();
  const requests = [];
  let releaseCreation;
  const creationGate = new Promise(resolve => { releaseCreation = resolve; });
  const service = createMeteredTurnService({
    env: { METERED_SECRET_KEY: 'test-metered-secret' },
    database,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.pathname.endsWith('/credential')) {
        await creationGate;
        return response({ username: 'one-user', apiKey: 'one-api-key' });
      }
      return response(TURN_ICE_SERVERS);
    }
  });

  const first = service.configForUser('same-user');
  const second = service.configForUser('same-user');
  releaseCreation();
  await Promise.all([first, second]);
  assert.equal(requests.filter(url => url.pathname.endsWith('/credential')).length, 1);
});

test('Metered per-credential usage query uses the server secret and only the signed-in credential', async () => {
  const database = mockDatabase();
  database.saveMeteredTurnCredential('user-1', {
    username: 'metered-user-1',
    apiKey: 'account-scoped-api-key',
    iceServers: TURN_ICE_SERVERS,
    createdAt: 1_800_000_000_000,
    expiresAt: 1_800_086_400_000
  });
  const requests = [];
  const secretKey = 'test-metered-secret';
  const service = createMeteredTurnService({
    env: { METERED_SECRET_KEY: secretKey },
    database,
    now: () => 1_800_000_100_000,
    fetchImpl: async url => {
      requests.push(new URL(url));
      return response({ usageInGB: 1.25 });
    }
  });

  const usage = await service.usageForUser('user-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/api/v1/turn/current_usage_for_user');
  assert.equal(requests[0].searchParams.get('secretKey'), secretKey);
  assert.equal(requests[0].searchParams.get('username'), 'metered-user-1');
  assert.deepEqual(usage, { usageInGB: 1.25, checkedAt: 1_800_000_100_000, expiresAt: 1_800_086_400_000 });
});

test('Metered API errors are sanitized and malformed ICE configuration is rejected', async () => {
  const database = mockDatabase();
  const secretKey = 'never-return-this-test-secret';
  const rejected = createMeteredTurnService({
    env: { METERED_SECRET_KEY: secretKey },
    database,
    fetchImpl: async () => response({ error: secretKey }, 401)
  });
  await assert.rejects(rejected.configForUser('user-1'), error => {
    assert.equal(error.message, 'Metered TURN service rejected the request (HTTP 401).');
    assert.equal(error.message.includes(secretKey), false);
    return true;
  });

  const malformed = createMeteredTurnService({
    env: { METERED_SECRET_KEY: 'another-test-secret' },
    database: mockDatabase(),
    fetchImpl: async url => new URL(url).pathname.endsWith('/credential')
      ? response({ username: 'user', apiKey: 'key' })
      : response([{ urls: 'https://untrusted.example', username: 'x', credential: 'y' }])
  });
  await assert.rejects(malformed.configForUser('user-2'), /invalid ICE server configuration/);
});

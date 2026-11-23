const assert = require('node:assert/strict');
const { test } = require('node:test');
const { linkVerifiedBedrockAccount, listMineCordGameAccounts } = require('../server/minecraft-accounts');

const bedrockProfile = (username = 'VerifiedPlayer', xuid = '1234567890123456') => ({
  source: 'xbox-profile',
  username,
  xuid,
  linkedAt: 1700000000000
});

test('verified Xbox linking stores a normalized Bedrock account in the shared persistent state', () => {
  const user = { id: 'user-1', username: 'alice' };
  const state = { users: { alice: user }, gameAccounts: [{ owner: 'alice', edition: 'eaglercraft', username: 'https://eaglercraft.com/play' }] };
  const linked = linkVerifiedBedrockAccount(state, user, bedrockProfile());

  assert.equal(linked.owner, 'alice');
  assert.equal(linked.edition, 'bedrock');
  assert.equal(linked.username, 'VerifiedPlayer');
  assert.equal(linked.xuid, '1234567890123456');
  assert.deepEqual(JSON.parse(linked.rawData), { source: 'xbox-profile', verified: true });
  assert.equal(state.gameAccounts.length, 2, 'linking preserves other editions');
  assert.equal(listMineCordGameAccounts(state, user).find(account => account.edition === 'bedrock').verified, true);
});

test('Xbox account linking rejects invalid provider results and XUID reuse by another account', () => {
  const alice = { id: 'user-1', username: 'alice' };
  const bob = { id: 'user-2', username: 'bob' };
  const state = { users: { alice, bob }, gameAccounts: [] };
  linkVerifiedBedrockAccount(state, alice, bedrockProfile());

  assert.throws(() => linkVerifiedBedrockAccount(state, bob, bedrockProfile('Impostor')), error => error.code === 'BEDROCK_ACCOUNT_ALREADY_LINKED');
  assert.throws(() => linkVerifiedBedrockAccount(state, bob, { ...bedrockProfile(), source: 'manual' }), error => error.code === 'INVALID_BEDROCK_PROFILE');
  assert.throws(() => linkVerifiedBedrockAccount(state, bob, bedrockProfile('Bad\nName')), error => error.code === 'INVALID_BEDROCK_PROFILE');
  assert.equal(state.gameAccounts.length, 1);
});

test('account listing marks legacy manual links unverified and exposes verified Java OAuth profiles', () => {
  const user = {
    id: 'user-3',
    username: 'charlie',
    minecraft: { source: 'minecraft-services', username: 'OfficialName', uuid: 'a'.repeat(32), linkedAt: 1700000000000 }
  };
  const state = {
    users: { charlie: user },
    gameAccounts: [
      { owner: 'charlie', edition: 'bedrock', username: 'OldClaim', xuid: '1234567890123456', rawData: JSON.stringify({ manuallyLinked: true }) },
      { owner: 'charlie', edition: 'java', username: 'FabricatedName', uuid: 'not-a-uuid', rawData: JSON.stringify({ source: 'minecraft-services' }) }
    ]
  };
  const accounts = listMineCordGameAccounts(state, user);
  assert.equal(accounts.find(account => account.edition === 'bedrock').verified, false);
  assert.equal(accounts.find(account => account.edition === 'java' && account.username === 'FabricatedName').verified, false);
  assert.deepEqual(accounts.find(account => account.edition === 'java' && account.verified), {
    edition: 'java', username: 'OfficialName', uuid: 'a'.repeat(32), xuid: null, linkedAt: 1700000000000, verified: true
  });
});

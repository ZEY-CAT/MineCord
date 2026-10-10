const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeData, previewFor } = require('../server/account-merge');
const { findLinkedUser } = require('../server/account-links');

function fixture() {
  return {
    users: {
      target: {
        id: 'target-id', username: 'target', displayName: 'Target', avatar: 'target.png',
        role: 'new_member', oauthAccounts: [{ provider: 'google', id: 'target-google' }],
        passwordHash: 'target-hash', passwordSalt: 'target-salt', minecraft: null
      },
      source: {
        id: 'source-id', username: 'source', displayName: 'Source', avatar: 'source.png',
        role: 'administrator',
        oauth: { provider: 'microsoft', id: 'source-ms' },
        oauthAccounts: [{ provider: 'github', id: 'source-gh' }],
        passwordHash: 'source-hash', passwordSalt: 'source-salt',
        minecraft: { username: 'SourceCraft', uuid: 'source-uuid' }
      },
      friend: {
        id: 'friend-id', username: 'friend', displayName: 'Friend', role: 'member',
        oauthAccounts: [{ provider: 'google', id: 'friend-google' }]
      }
    },
    servers: [{
      id: 'server-id', owner: 'source', members: ['source', 'target', 'friend'],
      channels: [{ id: 'general', name: 'general', type: 'text' }]
    }],
    channels: {},
    messages: {
      'server-id:general': [{ id: 'channel-msg', from: 'source', text: 'server history', at: 5 }],
      'dm:friend::source': [
        { id: 'dm-1', from: 'source', to: 'friend', text: 'source history', at: 2 },
        { id: 'dm-2', from: 'friend', to: 'source', text: 'reply', at: 3 }
      ],
      'dm:source::target': [{ id: 'archive-1', from: 'source', to: 'target', text: 'keep private history', at: 4 }]
    },
    friends: {
      'friend::source': { a: 'friend', b: 'source', status: 'accepted', by: 'friend' },
      'friend::target': { a: 'friend', b: 'target', status: 'pending', by: 'target' }
    },
    invites: { invite: { serverId: 'server-id', createdBy: 'source', expires: 1234 } },
    gameActivities: { source: { java: { game: 'java', lastSeenAt: 50 } } },
    dmRead: { source: { 'dm:friend::source': 'dm-1' } },
    roleAudit: [],
    oauthStates: {},
    shop: {
      balances: { 'target-id': 40, 'source-id': 80 },
      inventory: {
        'target-id': [{ itemId: 'demo-decoration-aurora', equipped: true, ownedAt: 1 }],
        'source-id': [{ itemId: 'demo-decoration-ember', equipped: true, ownedAt: 2 }]
      },
      transactions: [{ id: 'purchase-1', userId: 'source-id', itemId: 'demo-decoration-ember', amount: -20, kind: 'purchase', createdAt: 3 }],
      idempotency: { 'source-id:purchase-key': 'purchase-1' },
      demoGrants: { 'source-id': true }
    }
  };
}

test('account merge preserves and deduplicates supported account data', () => {
  const data = fixture();
  const before = structuredClone(data);
  const preview = previewFor(data, data.users.target, data.users.source);
  assert.equal(preview.counts.dmMessages, 3);
  assert.equal(preview.conflicts.some(conflict => conflict.field === 'displayName'), true);

  let id = 0;
  const { state, audit } = mergeData(data, 'target-id', 'source-id', 1000, prefix => `${prefix}-${++id}`);
  assert.deepEqual(data, before, 'migration builder does not mutate live state before commit');
  assert.ok(state.users.target);
  assert.equal(state.users.source, undefined);
  assert.equal(state.users.target.username, 'target');
  assert.equal(state.users.target.role, 'new_member', 'source privilege is never inherited');
  assert.deepEqual(state.users.target.minecraft, { username: 'SourceCraft', uuid: 'source-uuid' });
  assert.deepEqual(new Set(state.users.target.oauthAccounts.map(item => `${item.provider}:${item.id}`)), new Set([
    'google:target-google', 'microsoft:source-ms', 'github:source-gh'
  ]));
  assert.equal(findLinkedUser(state.users, 'microsoft', 'source-ms').id, 'target-id');
  assert.equal(findLinkedUser(state.users, 'github', 'source-gh').id, 'target-id');
  assert.deepEqual(state.servers[0].members, ['target', 'friend']);
  assert.equal(state.servers[0].owner, 'target');
  assert.equal(Object.keys(state.friends).length, 1);
  assert.equal(Object.values(state.friends)[0].status, 'accepted');
  assert.equal(state.invites.invite.createdBy, 'target');
  assert.deepEqual(state.messages['dm:friend::target'].map(message => message.id), ['dm-1', 'dm-2']);
  assert.equal(state.messages['server-id:general'][0].from, 'target');
  assert.equal(state.mergedDmArchives[0].messages[0].text, 'keep private history');
  assert.equal(state.shop.balances['target-id'], 120);
  assert.equal(state.shop.balances['source-id'], undefined);
  assert.deepEqual(state.shop.inventory['target-id'].map(item => item.itemId), ['demo-decoration-aurora', 'demo-decoration-ember']);
  assert.equal(state.shop.inventory['target-id'][0].equipped, true);
  assert.equal(state.shop.inventory['target-id'][1].equipped, false, 'destination cosmetic wins an equipped-slot conflict');
  assert.equal(state.shop.transactions[0].userId, 'target-id');
  assert.equal(state.shop.idempotency['target-id:purchase-key'], 'purchase-1');
  assert.equal(state.gameActivities.target.java.lastSeenAt, 50);
  assert.equal(state.mergedUsernames.source, 'target');
  assert.equal(audit.actorUserId, 'target-id');
  assert.equal(JSON.stringify(audit).includes('source-hash'), false);
});

test('merge keeps full combined message history and same-provider identities', () => {
  const data = fixture();
  data.users.target.oauthAccounts.push({ provider: 'github', id: 'target-github' });
  data.messages['dm:friend::target'] = Array.from({ length: 600 }, (_, index) => ({
    id: `target-${index}`, from: 'target', to: 'friend', text: 'target history', at: index
  }));
  data.messages['dm:friend::source'].push(...Array.from({ length: 600 }, (_, index) => ({
    id: `source-${index}`, from: 'source', to: 'friend', text: 'source history', at: index + 600
  })));

  const { state } = mergeData(data, 'target-id', 'source-id', 1000, prefix => `${prefix}-id`);
  assert.equal(state.messages['dm:friend::target'].length, 1202);
  assert.equal(findLinkedUser(state.users, 'github', 'target-github').id, 'target-id');
  assert.equal(findLinkedUser(state.users, 'github', 'source-gh').id, 'target-id');
});

test('merge rejects self-merges, merged sources, and identities attached to another account', () => {
  const self = fixture();
  assert.throws(() => mergeData(self, 'target-id', 'target-id', 1000, () => 'id'), /no longer available/i);

  const mergedSource = fixture();
  mergedSource.users.source.mergedInto = 'target-id';
  assert.throws(() => mergeData(mergedSource, 'target-id', 'source-id', 1000, () => 'id'), /already been merged/i);

  const duplicateIdentity = fixture();
  duplicateIdentity.users.third = {
    id: 'third-id', username: 'third', role: 'member',
    oauthAccounts: [{ provider: 'github', id: 'source-gh' }]
  };
  assert.throws(() => mergeData(duplicateIdentity, 'target-id', 'source-id', 1000, () => 'id'), /belongs to another/i);
  assert.equal(duplicateIdentity.users.source.username, 'source', 'rejected migration leaves input unchanged');
});

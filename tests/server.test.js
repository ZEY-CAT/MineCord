const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const WebSocket = require('ws');

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-test-'));
const databaseFile = path.join(tempDir, 'minecord.sqlite');
const init = spawnSync(process.execPath, ['-e', `const { DatabaseSync } = require('node:sqlite');
const legacy = new DatabaseSync(process.env.DATABASE_URL);
legacy.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', minecraft TEXT, created_at INTEGER NOT NULL)");
legacy.close();
require('./server/database').writeState({
  users: {}, servers: [], messages: {}, friends: {}, invites: {},
  oauthStates: {}, gameActivities: {}, dmRead: {}
})`], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: databaseFile },
  encoding: 'utf8'
});
if (init.status !== 0) throw new Error(`Could not initialize isolated test database: ${init.stderr}`);

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

async function startServer(port, ownerUserId = '') {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: origin,
      DATABASE_URL: databaseFile,
      APP_OWNER_USER_ID: ownerUserId,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      MICROSOFT_CLIENT_ID: '',
      MICROSOFT_CLIENT_SECRET: '',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      STUN_URL: '',
      TURN_URL: '',
      TURN_USERNAME: '',
      TURN_CREDENTIAL: '',
      TURN_SHARED_SECRET: '',
      TURN_CREDENTIAL_TTL_SECONDS: '',
      METERED_APP_NAME: 'minecord',
      METERED_SECRET_KEY: '',
      METERED_CREDENTIAL_TTL_SECONDS: ''
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${stderr}`);
    try {
      const response = await fetch(`${origin}/api/config`);
      if (response.ok) return { child, origin };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Server did not start: ${stderr}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function createAccount(origin, username) {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username, password: 'A-long-test-passphrase!' })
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  return cookie;
}

async function openSocket(origin, cookie) {
  const socket = new WebSocket(origin.replace(/^http/, 'ws'), {
    headers: { Cookie: cookie, Origin: origin }
  });
  const readyResult = waitFor(socket, message => message.type === 'ready')
    .then(ready => ({ ready }), error => ({ error }));
  try {
    await once(socket, 'open');
  } catch (error) {
    await readyResult;
    throw error;
  }
  const result = await readyResult;
  if (result.error) throw result.error;
  const { ready } = result;
  return { socket, ready };
}

function waitFor(socket, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for WebSocket message: ${predicate.toString()}`)), timeout);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(message)) finish(null, message);
    };
    const onError = error => finish(error);
    const onClose = (code, reason) => finish(new Error(`WebSocket closed before expected message (${code}): ${reason}`));
    function finish(error, message) {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
      error ? reject(error) : resolve(message);
    }
    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

function sendAndWait(socket, message, predicate) {
  const result = waitFor(socket, predicate);
  socket.send(JSON.stringify(message));
  return result;
}

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, 'close');
  socket.close();
  await closed;
}

test('accounts, server permissions, DM history, unread state, and reconnects', { timeout: 60000 }, async () => {
  const port = await availablePort();
  let running = await startServer(port);
  let aliceSocket, bobSocket, charlieSocket;
  try {
    const frontendResponse = await fetch(running.origin);
    assert.equal(frontendResponse.status, 200);
    assert.match(await frontendResponse.text(), /<title>MINECORD<\/title>/);
    const frontendScript = await fetch(`${running.origin}/features.js`);
    assert.equal(frontendScript.status, 200);
    assert.match(await frontendScript.text(), /MINECORD Shop/);
    const licensedFont = await fetch(`${running.origin}/fonts/vt323.ttf`);
    assert.equal(licensedFont.status, 200);
    assert.ok((await licensedFont.arrayBuffer()).byteLength > 100000);
    const rejectedOrigin = await fetch(`${running.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ username: 'alice', password: 'A-long-test-passphrase!' })
    });
    assert.equal(rejectedOrigin.status, 403);
    const unauthorizedRtcConfig = await fetch(`${running.origin}/api/rtc-config`);
    assert.equal(unauthorizedRtcConfig.status, 401);
    const unauthorizedRtcUsage = await fetch(`${running.origin}/api/rtc-usage`);
    assert.equal(unauthorizedRtcUsage.status, 401);
    const aliceCookie = await createAccount(running.origin, 'alice');
    const rtcResponse = await fetch(`${running.origin}/api/rtc-config`, { headers: { Cookie: aliceCookie } });
    assert.equal(rtcResponse.headers.get('cache-control'), 'no-store');
    const rtcConfig = await rtcResponse.json();
    assert.deepEqual(rtcConfig.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
    assert.equal(rtcConfig.turn.configured, false);
    assert.match(rtcConfig.warnings.join(' '), /TURN relay is not configured/);
    const usageWithoutMetered = await fetch(`${running.origin}/api/rtc-usage`, { headers: { Cookie: aliceCookie } });
    assert.equal(usageWithoutMetered.status, 503);
    let bobCookie = await createAccount(running.origin, 'bob');
    const aliceProfileResponse = await fetch(`${running.origin}/api/auth/me`, { headers: { Cookie: aliceCookie } });
    const aliceProfile = await aliceProfileResponse.json();
    assert.equal(aliceProfile.user.role, 'new_member');
    const rejectedOnboarding = await fetch(`${running.origin}/api/onboarding/complete`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ acceptedGuidelines: false, displayName: 'alice' })
    });
    assert.equal(rejectedOnboarding.status, 400);
    const completedAliceOnboarding = await fetch(`${running.origin}/api/onboarding/complete`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ acceptedGuidelines: true, displayName: 'Alice' })
    });
    assert.equal((await completedAliceOnboarding.json()).user.role, 'member');
    const completedBobOnboarding = await fetch(`${running.origin}/api/onboarding/complete`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ acceptedGuidelines: true, displayName: 'Bob' })
    });
    assert.equal((await completedBobOnboarding.json()).user.role, 'member');
    assert.equal((await fetch(`${running.origin}/api/onboarding/complete`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ acceptedGuidelines: true, displayName: 'Bob' })
    })).status, 409);
    const unlinkedResponse = await fetch(`${running.origin}/api/auth/links`, { headers: { Cookie: aliceCookie } });
    const unlinked = await unlinkedResponse.json();
    assert.deepEqual(unlinked.accounts, []);
    assert.equal(unlinked.hasLocalPassword, true);
    assert.equal((await fetch(`${running.origin}/api/auth/links`, { headers: { Origin: running.origin } })).status, 401);
    const unavailableLink = await fetch(`${running.origin}/api/auth/links/google/start`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: '{}'
    });
    assert.equal(unavailableLink.status, 503);
    const crossOriginLink = await fetch(`${running.origin}/api/auth/links/google/start`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: '{}'
    });
    assert.equal(crossOriginLink.status, 403);
    const shopUnauthenticated = await fetch(`${running.origin}/api/shop`);
    assert.equal(shopUnauthenticated.status, 401);
    const shopState = await fetch(`${running.origin}/api/shop`, { headers: { Cookie: bobCookie } });
    assert.equal(shopState.status, 200);
    const shop = await shopState.json();
    assert.equal(shop.balance, 1000);
    assert.ok(shop.catalog.some(item => item.id === 'demo-decoration-aurora' && item.price === 180));
    assert.equal(shop.currency.label, 'TEST CURRENCY · NO REAL-WORLD VALUE');
    const invalidShopItem = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'administrator-role', idempotencyKey: 'test_idempotency_invalid' })
    });
    assert.equal(invalidShopItem.status, 400);
    const purchaseBody = { itemId: 'demo-decoration-aurora', idempotencyKey: 'demo_purchase_key_0001', price: 1 };
    const purchaseResponse = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify(purchaseBody)
    });
    assert.equal(purchaseResponse.status, 201);
    const purchase = await purchaseResponse.json();
    assert.equal(purchase.transaction.amount, -180);
    assert.equal(purchase.balance, 820);
    const replayResponse = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify(purchaseBody)
    });
    assert.equal((await replayResponse.json()).balance, 820);
    const reusedKeyForDifferentItem = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'demo-nameplate-neon', idempotencyKey: purchaseBody.idempotencyKey })
    });
    assert.equal(reusedKeyForDifferentItem.status, 409);
    const duplicatePurchase = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'demo-decoration-aurora', idempotencyKey: 'demo_purchase_key_0002' })
    });
    assert.equal(duplicatePurchase.status, 409);
    const equipped = await fetch(`${running.origin}/api/shop/equip`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'demo-decoration-aurora', equipped: true })
    });
    assert.equal(equipped.status, 200);
    assert.equal((await equipped.json()).inventory[0].equipped, true);
    const notOwned = await fetch(`${running.origin}/api/shop/equip`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'demo-theme-midnight', equipped: true })
    });
    assert.equal(notOwned.status, 403);
    assert.equal((await fetch(`${running.origin}/api/admin/users`, { headers: { Cookie: aliceCookie } })).status, 403);
    await stopServer(running.child);
    running = await startServer(port, aliceProfile.user.id);
    const ownerProfileResponse = await fetch(`${running.origin}/api/auth/me`, { headers: { Cookie: aliceCookie } });
    assert.equal((await ownerProfileResponse.json()).user.role, 'app_owner');
    const promoted = await fetch(`${running.origin}/api/admin/users/bob/role`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'developer' })
    });
    assert.equal(promoted.status, 200);
    assert.equal((await promoted.json()).user.role, 'developer');
    const auditResponse = await fetch(`${running.origin}/api/admin/roles/audit`, { headers: { Cookie: aliceCookie } });
    assert.equal((await auditResponse.json()).entries[0].newRole, 'Developer');
    const promotedAdministrator = await fetch(`${running.origin}/api/admin/users/bob/role`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'administrator' })
    });
    assert.equal(promotedAdministrator.status, 200);
    assert.equal((await fetch(`${running.origin}/api/admin/users`, { headers: { Cookie: bobCookie } })).status, 403);
    const administratorCannotManageRoles = await fetch(`${running.origin}/api/admin/users/alice/role`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'member' })
    });
    assert.equal(administratorCannotManageRoles.status, 403);
    const restoredDeveloper = await fetch(`${running.origin}/api/admin/users/bob/role`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'developer' })
    });
    assert.equal(restoredDeveloper.status, 200);
    const cannotCreateOwner = await fetch(`${running.origin}/api/admin/users/bob/role`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'app_owner' })
    });
    assert.equal(cannotCreateOwner.status, 400);
    const bobCannotManageRoles = await fetch(`${running.origin}/api/admin/users/alice/role`, {
      method: 'POST',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'member' })
    });
    assert.equal(bobCannotManageRoles.status, 403);
    const ownerCannotDemoteConfiguredOwner = await fetch(`${running.origin}/api/admin/users/alice/role`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ role: 'member' })
    });
    assert.equal(ownerCannotDemoteConfiguredOwner.status, 400);
    const invalidLogin = await fetch(`${running.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ username: 'alice', password: 'wrong-password' })
    });
    assert.equal(invalidLogin.status, 401);
    const validLogin = await fetch(`${running.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ username: 'alice', password: 'A-long-test-passphrase!' })
    });
    assert.equal(validLogin.status, 200);
    const invalidGoogleState = await fetch(`${running.origin}/auth/google/callback?state=invalid&code=unused`);
    const invalidMicrosoftState = await fetch(`${running.origin}/auth/microsoft/callback?state=invalid&code=unused`);
    assert.equal(invalidGoogleState.status, 400);
    assert.equal(invalidMicrosoftState.status, 400);

    const alice = await openSocket(running.origin, aliceCookie);
    const bob = await openSocket(running.origin, bobCookie);
    aliceSocket = alice.socket;
    bobSocket = bob.socket;
    assert.deepEqual(alice.ready.servers, []);
    assert.deepEqual(bob.ready.servers, []);

    const serverCreated = sendAndWait(aliceSocket, { type: 'create_server', name: 'Test Server' }, message => message.type === 'server_created');
    const serverMessage = await serverCreated;
    const serverId = serverMessage.server.id;
    const channelCreated = await sendAndWait(aliceSocket, {
      type: 'create_channel', serverId, name: 'test-room', channelType: 'text'
    }, message => message.type === 'channel_created' && message.serverId === serverId);
    const channelScope = `${serverId}:${channelCreated.channel.id}`;
    const deniedHistory = sendAndWait(bobSocket, { type: 'history', scope: channelScope }, message => message.type === 'error');
    const deniedJoin = sendAndWait(bobSocket, { type: 'join_server', serverId }, message => message.type === 'error');
    const deniedPost = sendAndWait(bobSocket, { type: 'message', scope: channelScope, text: 'not allowed' }, message => message.type === 'error');
    await Promise.all([deniedHistory, deniedJoin, deniedPost]);

    const invite = await sendAndWait(aliceSocket, { type: 'invite_create', serverId }, message => message.type === 'invite');
    const joined = await sendAndWait(bobSocket, { type: 'invite_join', code: invite.code }, message => message.type === 'server_joined');
    assert.equal(joined.server.id, serverId);
    const serverDelivery = waitFor(bobSocket, message => message.type === 'message' && message.scope === channelScope);
    aliceSocket.send(JSON.stringify({ type: 'message', scope: channelScope, text: 'channel message' }));
    assert.equal((await serverDelivery).item.text, 'channel message');

    const friendRequest = waitFor(bobSocket, message => message.type === 'friend_request');
    aliceSocket.send(JSON.stringify({ type: 'friend_request', to: 'bob' }));
    await friendRequest;
    const acceptedAtAlice = waitFor(aliceSocket, message => message.type === 'friend_status' && message.status === 'accepted');
    const acceptedAtBob = sendAndWait(bobSocket, { type: 'friend_accept', with: 'alice' }, message => message.type === 'friend_status' && message.status === 'accepted');
    await Promise.all([acceptedAtAlice, acceptedAtBob]);

    const friendProfileUpdate = waitFor(bobSocket, message => message.type === 'friend_profile' && message.user?.username === 'alice');
    const updatedAliceProfile = await sendAndWait(aliceSocket, {
      type: 'profile', displayName: 'Alice Friend', avatar: 'https://images.example/avatar.png'
    }, message => message.type === 'profile');
    assert.equal(updatedAliceProfile.me.avatar, 'https://images.example/avatar.png');
    assert.equal((await friendProfileUpdate).user.displayName, 'Alice Friend');
    const unsafeAvatar = sendAndWait(aliceSocket, {
      type: 'profile', displayName: 'Alice Friend', avatar: 'javascript:alert(1)'
    }, message => message.type === 'error');
    assert.match((await unsafeAvatar).message, /HTTPS image URL/);

    const room = `${serverId}:voice`;
    const aliceVoiceMembers = sendAndWait(aliceSocket, { type: 'voice_join', room }, message => message.type === 'voice_members' && message.room === room);
    assert.deepEqual((await aliceVoiceMembers).members, ['alice']);
    const bobVoiceJoined = sendAndWait(bobSocket, { type: 'voice_join', room }, message => message.type === 'voice_members' && message.room === room);
    const aliceVoicePeerJoined = waitFor(aliceSocket, message => message.type === 'voice_peer_joined' && message.peer === 'bob');
    await Promise.all([bobVoiceJoined, aliceVoicePeerJoined]);
    const aliceSawVoiceRejoin = waitFor(aliceSocket, message => message.type === 'voice_peer_rejoined' && message.peer === 'bob');
    const bobRejoinedVoice = sendAndWait(bobSocket, { type: 'voice_join', room }, message => message.type === 'voice_members' && message.room === room);
    await Promise.all([aliceSawVoiceRejoin, bobRejoinedVoice]);
    const unauthorizedRoomSignal = sendAndWait(bobSocket, {
      type: 'voice_signal', room, to: 'charlie', data: { description: { type: 'offer', sdp: 'test-sdp' } }
    }, message => message.type === 'error');
    assert.match((await unauthorizedRoomSignal).message, /voice channel/);
    const invalidRoomSignal = sendAndWait(aliceSocket, {
      type: 'voice_signal', room, to: 'bob', data: { description: { type: 'offer', sdp: 'test-sdp' }, candidate: {} }
    }, message => message.type === 'error');
    assert.match((await invalidRoomSignal).message, /signaling data/);
    const roomSignal = waitFor(bobSocket, message => message.type === 'voice_signal' && message.from === 'alice');
    aliceSocket.send(JSON.stringify({ type: 'voice_signal', room, to: 'bob', data: { description: { type: 'offer', sdp: 'test-sdp' } } }));
    assert.equal((await roomSignal).data.description.type, 'offer');
    const aliceLeftVoice = waitFor(bobSocket, message => message.type === 'voice_peer_left' && message.peer === 'alice');
    aliceSocket.send(JSON.stringify({ type: 'voice_leave', room }));
    await aliceLeftVoice;
    bobSocket.send(JSON.stringify({ type: 'voice_leave', room }));

    const incomingCallPromise = waitFor(bobSocket, message => message.type === 'incoming_call');
    const startedCall = await sendAndWait(aliceSocket, { type: 'call_start', to: 'bob', callType: 'private' }, message => message.type === 'call_started');
    const incomingCall = await incomingCallPromise;
    assert.deepEqual(startedCall.participants, ['alice']);
    assert.deepEqual(incomingCall.participants, ['alice']);
    const prematureSignal = sendAndWait(aliceSocket, {
      type: 'call_signal', callId: startedCall.callId, to: 'bob', data: { description: { type: 'offer', sdp: 'test-sdp' } }
    }, message => message.type === 'error');
    assert.match((await prematureSignal).message, /Join the call/);
    const bobAcceptedCall = sendAndWait(bobSocket, { type: 'call_accept', callId: startedCall.callId }, message => message.type === 'call_accepted');
    const aliceSawBobJoin = waitFor(aliceSocket, message => message.type === 'call_member_joined' && message.user === 'bob');
    await Promise.all([bobAcceptedCall, aliceSawBobJoin]);
    const malformedCallSignal = sendAndWait(aliceSocket, {
      type: 'call_signal', callId: startedCall.callId, to: 'bob', data: { candidate: { candidate: 'x'.repeat(5000) } }
    }, message => message.type === 'error');
    assert.match((await malformedCallSignal).message, /signaling data/);
    const acceptedSignal = waitFor(bobSocket, message => message.type === 'call_signal' && message.from === 'alice');
    aliceSocket.send(JSON.stringify({
      type: 'call_signal', callId: startedCall.callId, to: 'bob',
      data: { description: { type: 'offer', sdp: 'test-sdp' } }
    }));
    assert.equal((await acceptedSignal).data.description.type, 'offer');
    const callEnded = waitFor(aliceSocket, message => message.type === 'call_ended' && message.callId === startedCall.callId);
    bobSocket.send(JSON.stringify({ type: 'call_end', callId: startedCall.callId }));
    await callEnded;

    const delivered = waitFor(bobSocket, message => message.type === 'dm' && message.message.text === 'first DM');
    aliceSocket.send(JSON.stringify({ type: 'dm', to: 'bob', text: 'first DM' }));
    assert.equal((await delivered).unread, 1);
    await closeSocket(bobSocket);
    bobSocket = null;
    aliceSocket.send(JSON.stringify({ type: 'dm', to: 'bob', text: 'second DM while offline' }));
    await waitFor(aliceSocket, message => message.type === 'dm' && message.message.text === 'second DM while offline');
    await closeSocket(aliceSocket);
    aliceSocket = null;
    await stopServer(running.child);

    running = await startServer(port);
    const bobReconnect = await openSocket(running.origin, bobCookie);
    bobSocket = bobReconnect.socket;
    assert.deepEqual(bobReconnect.ready.friends, ['alice']);
    const bobRoleAfterRestart = await fetch(`${running.origin}/api/auth/me`, { headers: { Cookie: bobCookie } });
    assert.equal((await bobRoleAfterRestart.json()).user.role, 'developer');
    assert.ok(bobReconnect.ready.dmPeers.includes('alice'));
    assert.equal(bobReconnect.ready.dmUnread.alice, 2);
    assert.equal(bobReconnect.ready.dmLastMessages.alice.text, 'second DM while offline');
    const dmHistory = await sendAndWait(bobSocket, { type: 'dm_history', username: 'alice' }, message => message.type === 'dm_history');
    assert.deepEqual(dmHistory.messages.map(message => message.text), ['first DM', 'second DM while offline']);
    await sendAndWait(bobSocket, { type: 'dm_read', username: 'alice' }, message => message.type === 'dm_unread' && message.count === 0);
    await closeSocket(bobSocket);
    bobSocket = null;
    await stopServer(running.child);

    running = await startServer(port);
    const bobAgain = await openSocket(running.origin, bobCookie);
    bobSocket = bobAgain.socket;
    assert.ok(bobAgain.ready.dmPeers.includes('alice'));
    assert.equal(bobAgain.ready.dmUnread.alice, undefined);
    const charlieCookie = await createAccount(running.origin, 'charlie');
    const charlie = await openSocket(running.origin, charlieCookie);
    charlieSocket = charlie.socket;
    assert.deepEqual(charlie.ready.servers, []);
    assert.equal(charlie.ready.me.role, 'new_member');
    const charlieShop = await fetch(`${running.origin}/api/shop`, { headers: { Cookie: charlieCookie } });
    assert.equal(charlieShop.status, 200);
    const charliePurchase = await fetch(`${running.origin}/api/shop/purchase`, {
      method: 'POST',
      headers: { Cookie: charlieCookie, 'Content-Type': 'application/json', Origin: running.origin },
      body: JSON.stringify({ itemId: 'demo-decoration-aurora', idempotencyKey: 'new_member_purchase_1' })
    });
    assert.equal(charliePurchase.status, 403);
    assert.deepEqual(charlie.ready.online, ['charlie']);
    const privateHistoryDenied = sendAndWait(charlieSocket, { type: 'dm_history', username: 'alice' }, message => message.type === 'error');
    await privateHistoryDenied;
  } finally {
    for (const socket of [aliceSocket, bobSocket, charlieSocket]) {
      if (socket) await closeSocket(socket).catch(() => {});
    }
    await stopServer(running.child);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

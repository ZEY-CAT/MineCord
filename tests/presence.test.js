const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'A-long-test-passphrase!';

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

function initializeDatabase(databaseFile) {
  const script = `require('./server/database').writeState({
    users: {}, servers: [], messages: {}, friends: {}, invites: {},
    oauthStates: {}, gameActivities: {}, dmRead: {}, groupDms: {}, groupRead: {},
    gameServers: [], gameAccounts: [], eaglercraftLinks: []
  })`;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseFile },
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(`Could not initialize isolated database: ${result.stderr}`);
}

async function startServer(port, databaseFile) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
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
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function createAccount(origin, username) {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username, password: PASSWORD })
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  return cookie;
}

function waitFor(socket, predicate, timeout = 10000) {
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

async function openSocket(origin, cookie) {
  const socket = new WebSocket(origin.replace(/^http/, 'ws'), {
    headers: { Cookie: cookie, Origin: origin }
  });
  const readyResult = waitFor(socket, message => message.type === 'ready').then(
    ready => ({ ready }),
    error => ({ error })
  );
  try {
    await once(socket, 'open');
  } catch (error) {
    await readyResult;
    throw error;
  }
  const result = await readyResult;
  if (result.error) throw result.error;
  return { socket, ready: result.ready };
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, 'close');
  socket.close();
  await closed;
}

async function befriend(origin, a, b, aName, bName) {
  const request = waitFor(b.socket, message => message.type === 'friend_request' && message.from === aName);
  a.socket.send(JSON.stringify({ type: 'friend_request', to: bName }));
  await request;
  const acceptedA = waitFor(a.socket, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === bName);
  const acceptedB = waitFor(b.socket, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === aName);
  b.socket.send(JSON.stringify({ type: 'friend_accept', with: aName }));
  await Promise.all([acceptedA, acceptedB]);
}

async function withServer(databaseFile, fn) {
  const port = await availablePort();
  let running = await startServer(port, databaseFile);
  try {
    return await fn(running, port);
  } finally {
    await stopServer(running.child);
  }
}

function tempDatabase() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minecord-presence-test-'));
  const databaseFile = path.join(dir, 'minecord.sqlite');
  initializeDatabase(databaseFile);
  return { dir, databaseFile };
}

function removeTemp(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {}
}

test('accepted friends can DM after friendship fallback migration, reconnects, and refreshes', { timeout: 60000 }, async () => {
  const { dir, databaseFile } = tempDatabase();
  let running;
  let alice, bob, charlie;
  try {
    const port = await availablePort();
    running = await startServer(port, databaseFile);
    const origin = running.origin;
    const aliceCookie = await createAccount(origin, 'dm_alice');
    const bobCookie = await createAccount(origin, 'dm_bob');
    const charlieCookie = await createAccount(origin, 'dm_charlie');
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);
    charlie = await openSocket(origin, charlieCookie);
    await befriend(origin, alice, bob, 'dm_alice', 'dm_bob');
    const baseline = waitFor(bob.socket, message => message.type === 'dm' && message.message.text === 'baseline DM');
    alice.socket.send(JSON.stringify({ type: 'dm', to: 'dm_bob', text: 'baseline DM' }));
    await baseline;

    // Simulate the exact persisted-state shape that used to trigger the bug:
    // app_state has no friends, while the normalized friends table still has
    // rows keyed by user IDs. The old loader treated those IDs as usernames.
    await stopServer(running.child);
    running = null;
    const db = new DatabaseSync(databaseFile);
    const row = db.prepare('SELECT value FROM app_state WHERE id = 1').get();
    const state = JSON.parse(row.value);
    state.friends = {};
    db.prepare('UPDATE app_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    db.close();

    running = await startServer(port, databaseFile);
    alice = await openSocket(running.origin, aliceCookie);
    bob = await openSocket(running.origin, bobCookie);
    assert.deepEqual(alice.ready.friends, ['dm_bob']);
    assert.deepEqual(bob.ready.friends, ['dm_alice']);

    const afterRestart = waitFor(bob.socket, message => message.type === 'dm' && message.message.text === 'after fallback repair');
    alice.socket.send(JSON.stringify({ type: 'dm', to: 'dm_bob', text: 'after fallback repair' }));
    const delivered = await afterRestart;
    assert.equal(delivered.unread, 2);

    const reverse = waitFor(alice.socket, message => message.type === 'dm' && message.message.text === 'reverse direction');
    bob.socket.send(JSON.stringify({ type: 'dm', to: 'dm_alice', text: 'reverse direction' }));
    await reverse;

    const history = await sendAndWait(alice.socket, { type: 'dm_history', username: 'dm_bob' }, message => message.type === 'dm_history');
    assert.deepEqual(history.messages.map(message => message.text), ['baseline DM', 'after fallback repair', 'reverse direction']);

    charlie = await openSocket(running.origin, charlieCookie);
    const rejected = await sendAndWait(charlie.socket, { type: 'dm', to: 'dm_alice', text: 'not a friend' }, message => message.type === 'error');
    assert.match(rejected.message, /accepted friends only/);

    const request = waitFor(alice.socket, message => message.type === 'friend_request' && message.from === 'dm_charlie');
    charlie.socket.send(JSON.stringify({ type: 'friend_request', to: 'dm_alice' }));
    await request;
    const pendingDm = await sendAndWait(charlie.socket, { type: 'dm', to: 'dm_alice', text: 'pending request' }, message => message.type === 'error');
    assert.match(pendingDm.message, /accepted friends only/);

    // Restart after the pending request so canonicalized a/b ordering cannot
    // accidentally make the recipient look like the requester.
    await stopServer(running.child);
    running = null;
    running = await startServer(port, databaseFile);
    alice = await openSocket(running.origin, aliceCookie);
    bob = await openSocket(running.origin, bobCookie);
    charlie = await openSocket(running.origin, charlieCookie);
    assert.deepEqual(alice.ready.friends, ['dm_bob']);
    assert.deepEqual(alice.ready.pendingFriendRequests, ['dm_charlie']);

    const rejectedStatus = waitFor(charlie.socket, message => message.type === 'friend_status' && message.status === 'rejected' && message.user === 'dm_alice');
    alice.socket.send(JSON.stringify({ type: 'friend_reject', with: 'dm_charlie' }));
    await rejectedStatus;
    const rejectedDm = await sendAndWait(charlie.socket, { type: 'dm', to: 'dm_alice', text: 'rejected request' }, message => message.type === 'error');
    assert.match(rejectedDm.message, /accepted friends only/);

    await closeSocket(bob.socket);
    bob = await openSocket(running.origin, bobCookie);
    assert.deepEqual(bob.ready.friends, ['dm_alice']);
    assert.equal(bob.ready.dmUnread.dm_alice, 2);
    const reconnectDm = waitFor(bob.socket, message => message.type === 'dm' && message.message.text === 'after reconnect');
    alice.socket.send(JSON.stringify({ type: 'dm', to: 'dm_bob', text: 'after reconnect' }));
    await reconnectDm;

    // Removing a friendship must preserve the existing conversation history
    // while closing the send path. This avoids deleting user data and still
    // enforces the accepted-friends-only authorization boundary.
    const removed = waitFor(alice.socket, message => message.type === 'friend_status' && message.status === 'removed' && message.user === 'dm_bob');
    alice.socket.send(JSON.stringify({ type: 'friend_remove', with: 'dm_bob' }));
    await removed;
    const historyAfterRemoval = await sendAndWait(alice.socket, { type: 'dm_history', username: 'dm_bob' }, message => message.type === 'dm_history');
    assert.equal(historyAfterRemoval.messages.length, 4);
    const bobHistoryAfterRemoval = await sendAndWait(bob.socket, { type: 'dm_history', username: 'dm_alice' }, message => message.type === 'dm_history');
    assert.equal(bobHistoryAfterRemoval.messages.length, 4);
    const blockedAfterRemoval = await sendAndWait(alice.socket, { type: 'dm', to: 'dm_bob', text: 'must be blocked' }, message => message.type === 'error');
    assert.match(blockedAfterRemoval.message, /accepted friends only/);
  } finally {
    await closeSocket(alice?.socket);
    await closeSocket(bob?.socket);
    await closeSocket(charlie?.socket);
    if (running) await stopServer(running.child);
    removeTemp(dir);
  }
});

test('presence transitions broadcast in real time, persist, hide Offline, and are self-only', { timeout: 60000 }, async () => {
  const { dir, databaseFile } = tempDatabase();
  let running;
  let alice, bob, bobSecond;
  try {
    const port = await availablePort();
    running = await startServer(port, databaseFile);
    const origin = running.origin;
    const aliceCookie = await createAccount(origin, 'presence_alice');
    const bobCookie = await createAccount(origin, 'presence_bob');
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);
    await befriend(origin, alice, bob, 'presence_alice', 'presence_bob');
    assert.equal(alice.ready.me.presence, 'online');
    assert.equal(alice.ready.me.manualPresence, 'online');

    const bobSeesAway = waitFor(bob.socket, message => message.type === 'presence' && message.members?.presence_alice?.presence === 'away' && message.online.includes('presence_alice'));
    const awayAck = await sendAndWait(alice.socket, { type: 'presence_update', status: 'away' }, message => message.type === 'presence_updated' && message.user.presence === 'away');
    assert.equal(awayAck.user.manualPresence, 'away');
    await bobSeesAway;

    const bobSeesDnd = waitFor(bob.socket, message => message.type === 'presence' && message.members?.presence_alice?.presence === 'dnd' && message.online.includes('presence_alice'));
    await sendAndWait(alice.socket, { type: 'presence_update', status: 'dnd' }, message => message.type === 'presence_updated' && message.user.presence === 'dnd');
    await bobSeesDnd;

    const bobSeesOffline = waitFor(bob.socket, message => message.type === 'presence' && message.members?.presence_alice?.presence === 'offline' && !message.online.includes('presence_alice'));
    const offlineAck = await sendAndWait(alice.socket, { type: 'presence_update', status: 'offline' }, message => message.type === 'presence_updated' && message.user.presence === 'offline');
    assert.equal(offlineAck.user.manualPresence, 'offline');
    await bobSeesOffline;

    const offlineDm = waitFor(bob.socket, message => message.type === 'dm' && message.message.text === 'DM still works while hidden');
    alice.socket.send(JSON.stringify({ type: 'dm', to: 'presence_bob', text: 'DM still works while hidden' }));
    await offlineDm;

    await closeSocket(alice.socket);
    const bobSeesStillOffline = waitFor(bob.socket, message => message.type === 'presence' && message.members?.presence_alice?.presence === 'offline' && !message.online.includes('presence_alice'));
    alice = await openSocket(origin, aliceCookie);
    assert.equal(alice.ready.me.presence, 'offline');
    assert.equal(alice.ready.me.manualPresence, 'offline');
    await bobSeesStillOffline;

    const bobSeesOnline = waitFor(bob.socket, message => message.type === 'presence' && message.members?.presence_alice?.presence === 'online' && message.online.includes('presence_alice'));
    await sendAndWait(alice.socket, { type: 'presence_update', status: 'online' }, message => message.type === 'presence_updated' && message.user.presence === 'online');
    await bobSeesOnline;

    // A payload cannot target another account: the server only applies the
    // status to the authenticated socket owner.
    await sendAndWait(alice.socket, { type: 'presence_update', status: 'dnd', username: 'presence_bob' }, message => message.type === 'presence_updated' && message.user.username === 'presence_alice');
    bobSecond = await openSocket(origin, bobCookie);
    assert.equal(bobSecond.ready.me.manualPresence, 'online');
    assert.equal(bobSecond.ready.me.presence, 'online');
    await closeSocket(bobSecond.socket);
    bobSecond = null;

    await sendAndWait(alice.socket, { type: 'presence_update', status: 'online' }, message => message.type === 'presence_updated' && message.user.presence === 'online');
    const secondTab = await openSocket(origin, aliceCookie);
    const bobStillOnline = waitFor(bob.socket, message => message.type === 'presence' && message.online.includes('presence_alice'));
    await closeSocket(secondTab.socket);
    await bobStillOnline;
    const bobSeesDisconnect = waitFor(bob.socket, message => message.type === 'presence' && !message.online.includes('presence_alice') && message.members?.presence_alice?.presence === 'offline');
    await closeSocket(alice.socket);
    alice = null;
    await bobSeesDisconnect;
  } finally {
    await closeSocket(alice?.socket);
    await closeSocket(bob?.socket);
    await closeSocket(bobSecond?.socket);
    if (running) await stopServer(running.child);
    removeTemp(dir);
  }
});

test('In Call follows voice and call lifecycle, multiple calls, disconnects, and multiple tabs', { timeout: 90000 }, async () => {
  const { dir, databaseFile } = tempDatabase();
  let running;
  let alice, bob, carol, aliceSecond;
  try {
    const port = await availablePort();
    running = await startServer(port, databaseFile);
    const origin = running.origin;
    const aliceCookie = await createAccount(origin, 'call_alice');
    const bobCookie = await createAccount(origin, 'call_bob');
    const carolCookie = await createAccount(origin, 'call_carol');
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);
    carol = await openSocket(origin, carolCookie);
    await befriend(origin, alice, bob, 'call_alice', 'call_bob');
    await befriend(origin, alice, carol, 'call_alice', 'call_carol');
    await sendAndWait(alice.socket, { type: 'presence_update', status: 'away' }, message => message.type === 'presence_updated' && message.user.presence === 'away');

    const created = await sendAndWait(alice.socket, { type: 'create_server', name: 'Presence Voice' }, message => message.type === 'server_created');
    const room = `${created.server.id}:voice`;
    const bobSeesVoiceCall = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'in_call' && message.online.includes('call_alice'));
    await sendAndWait(alice.socket, { type: 'voice_join', room }, message => message.type === 'voice_members' && message.room === room);
    await bobSeesVoiceCall;
    const bobSeesVoiceEnded = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'away' && message.online.includes('call_alice'));
    alice.socket.send(JSON.stringify({ type: 'voice_leave', room }));
    await bobSeesVoiceEnded;

    const bobIncoming = waitFor(bob.socket, message => message.type === 'incoming_call' && message.from === 'call_alice');
    const bobSeesCallStarted = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'in_call');
    const aliceSeesBobStillOnlineWhileRinging = waitFor(alice.socket, message => message.type === 'presence' && message.members?.call_bob?.presence === 'online');
    const firstCall = await sendAndWait(alice.socket, { type: 'call_start', to: 'call_bob', callType: 'private' }, message => message.type === 'call_started');
    await bobIncoming;
    await bobSeesCallStarted;
    await aliceSeesBobStillOnlineWhileRinging;
    const aliceSeesBobInCall = waitFor(alice.socket, message => message.type === 'presence' && message.members?.call_bob?.presence === 'in_call');
    await sendAndWait(bob.socket, { type: 'call_accept', callId: firstCall.callId }, message => message.type === 'call_accepted');
    await aliceSeesBobInCall;

    const bobSeesDndDuringCall = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.manualPresence === 'dnd' && message.members?.call_alice?.presence === 'in_call');
    const dndAck = await sendAndWait(alice.socket, { type: 'presence_update', status: 'dnd' }, message => message.type === 'presence_updated' && message.user.presence === 'in_call' && message.user.manualPresence === 'dnd');
    assert.equal(dndAck.user.presence, 'in_call');
    await bobSeesDndDuringCall;

    const bobSeesRestoredDnd = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'dnd');
    const aliceSeesBobRestored = waitFor(alice.socket, message => message.type === 'presence' && message.members?.call_bob?.presence === 'online');
    alice.socket.send(JSON.stringify({ type: 'call_end', callId: firstCall.callId }));
    await Promise.all([bobSeesRestoredDnd, aliceSeesBobRestored]);

    // Two simultaneous calls keep the derived status In Call until both end.
    const bobIncomingAgain = waitFor(bob.socket, message => message.type === 'incoming_call');
    const callOne = await sendAndWait(alice.socket, { type: 'call_start', to: 'call_bob', callType: 'private' }, message => message.type === 'call_started');
    await bobIncomingAgain;
    await sendAndWait(bob.socket, { type: 'call_accept', callId: callOne.callId }, message => message.type === 'call_accepted');
    const carolIncoming = waitFor(carol.socket, message => message.type === 'incoming_call');
    const callTwo = await sendAndWait(alice.socket, { type: 'call_start', to: 'call_carol', callType: 'private' }, message => message.type === 'call_started');
    await carolIncoming;
    await sendAndWait(carol.socket, { type: 'call_accept', callId: callTwo.callId }, message => message.type === 'call_accepted');
    const stillInCall = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'in_call');
    alice.socket.send(JSON.stringify({ type: 'call_end', callId: callOne.callId }));
    await stillInCall;
    const backToDnd = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'dnd');
    alice.socket.send(JSON.stringify({ type: 'call_end', callId: callTwo.callId }));
    await backToDnd;

    // Disconnecting while in a call must not leave anyone stuck In Call.
    const disconnectIncoming = waitFor(bob.socket, message => message.type === 'incoming_call');
    const disconnectCall = await sendAndWait(alice.socket, { type: 'call_start', to: 'call_bob', callType: 'private' }, message => message.type === 'call_started');
    await disconnectIncoming;
    await sendAndWait(bob.socket, { type: 'call_accept', callId: disconnectCall.callId }, message => message.type === 'call_accepted');
    const bobSeesCallEnded = waitFor(bob.socket, message => message.type === 'call_ended' && message.callId === disconnectCall.callId);
    const bobSeesAliceOffline = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'offline' && !message.online.includes('call_alice'));
    await closeSocket(alice.socket);
    alice = null;
    await Promise.all([bobSeesCallEnded, bobSeesAliceOffline]);
    alice = await openSocket(origin, aliceCookie);
    assert.equal(alice.ready.me.manualPresence, 'dnd');
    assert.equal(alice.ready.me.presence, 'dnd');

    // A second tab must keep the account online, and closing the tab that is
    // not in the call must not clear In Call.
    aliceSecond = await openSocket(origin, aliceCookie);
    const bobSeesInCallFromTab = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'in_call');
    const tabIncoming = waitFor(bob.socket, message => message.type === 'incoming_call');
    const tabCall = await sendAndWait(alice.socket, { type: 'call_start', to: 'call_bob', callType: 'private' }, message => message.type === 'call_started');
    await tabIncoming;
    await sendAndWait(bob.socket, { type: 'call_accept', callId: tabCall.callId }, message => message.type === 'call_accepted');
    await bobSeesInCallFromTab;
    const bobStillSeesInCall = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'in_call' && message.online.includes('call_alice'));
    await closeSocket(aliceSecond.socket);
    aliceSecond = null;
    await bobStillSeesInCall;
    const bobSeesFinalOffline = waitFor(bob.socket, message => message.type === 'presence' && message.members?.call_alice?.presence === 'offline' && !message.online.includes('call_alice'));
    await closeSocket(alice.socket);
    alice = null;
    await bobSeesFinalOffline;
  } finally {
    await closeSocket(alice?.socket);
    await closeSocket(bob?.socket);
    await closeSocket(carol?.socket);
    await closeSocket(aliceSecond?.socket);
    if (running) await stopServer(running.child);
    removeTemp(dir);
  }
});

test('pending and accepted friendships persist across restarts without duplicate requests', { timeout: 60000 }, async () => {
  const { dir, databaseFile } = tempDatabase();
  let running;
  let alice, bob;
  try {
    const port = await availablePort();
    running = await startServer(port, databaseFile);
    const origin = running.origin;
    const aliceCookie = await createAccount(origin, 'persist_alice');
    const bobCookie = await createAccount(origin, 'persist_bob');
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);

    const incoming = waitFor(bob.socket, message => message.type === 'friend_request' && message.from === 'persist_alice');
    const pendingAtAlice = waitFor(alice.socket, message => message.type === 'friend_status' && message.status === 'pending' && message.user === 'persist_bob');
    alice.socket.send(JSON.stringify({ type: 'friend_request', to: 'persist_bob' }));
    await Promise.all([incoming, pendingAtAlice]);

    // Clicking Add Friend again must be idempotent and must not create a second row.
    const repeatedBeforeRestart = await sendAndWait(alice.socket, { type: 'friend_request', to: 'persist_bob' }, message => message.type === 'friend_status' && message.status === 'pending' && message.user === 'persist_bob');
    assert.ok(repeatedBeforeRestart);
    let database = new DatabaseSync(databaseFile, { readOnly: true });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM friends').get().count, 1);
    database.close();

    // A full server/app restart must retain the pending request in both directions.
    await closeSocket(alice.socket);
    await closeSocket(bob.socket);
    alice = null;
    bob = null;
    await stopServer(running.child);
    running = null;
    running = await startServer(port, databaseFile);
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);
    assert.deepEqual(alice.ready.friends, []);
    assert.deepEqual(alice.ready.pendingFriendRequests, []);
    assert.deepEqual(alice.ready.sentFriendRequests, ['persist_bob']);
    assert.deepEqual(bob.ready.friends, []);
    assert.deepEqual(bob.ready.pendingFriendRequests, ['persist_alice']);
    assert.deepEqual(bob.ready.sentFriendRequests, []);

    const repeatedAfterRestart = await sendAndWait(alice.socket, { type: 'friend_request', to: 'persist_bob' }, message => message.type === 'friend_status' && message.status === 'pending' && message.user === 'persist_bob');
    assert.ok(repeatedAfterRestart);
    database = new DatabaseSync(databaseFile, { readOnly: true });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM friends').get().count, 1);
    database.close();

    const acceptedAtAlice = waitFor(alice.socket, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === 'persist_bob');
    const acceptedAtBob = waitFor(bob.socket, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === 'persist_alice');
    bob.socket.send(JSON.stringify({ type: 'friend_accept', with: 'persist_alice' }));
    await Promise.all([acceptedAtAlice, acceptedAtBob]);

    // Duplicate accept and post-accept request clicks are harmless.
    const repeatedAccept = await sendAndWait(bob.socket, { type: 'friend_accept', with: 'persist_alice' }, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === 'persist_alice');
    assert.ok(repeatedAccept);
    const alreadyFriends = await sendAndWait(alice.socket, { type: 'friend_request', to: 'persist_bob' }, message => message.type === 'friend_status' && message.status === 'accepted' && message.user === 'persist_bob');
    assert.ok(alreadyFriends);

    // Restart once more: the accepted friendship must be present for both users.
    await closeSocket(alice.socket);
    await closeSocket(bob.socket);
    alice = null;
    bob = null;
    await stopServer(running.child);
    running = null;
    running = await startServer(port, databaseFile);
    alice = await openSocket(origin, aliceCookie);
    bob = await openSocket(origin, bobCookie);
    assert.deepEqual(alice.ready.friends, ['persist_bob']);
    assert.deepEqual(bob.ready.friends, ['persist_alice']);
    assert.deepEqual(alice.ready.sentFriendRequests, []);
    assert.deepEqual(bob.ready.pendingFriendRequests, []);

    // Logging out and back in must reload the same server-side friendship.
    const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: aliceCookie } });
    assert.equal(logout.status, 200);
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: 'persist_alice', password: PASSWORD })
    });
    assert.equal(login.status, 200);
    const freshCookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(freshCookie);
    await closeSocket(alice.socket);
    alice = await openSocket(origin, freshCookie);
    assert.deepEqual(alice.ready.friends, ['persist_bob']);

    // A second connected device/tab sees the same persisted relationship.
    const aliceSecond = await openSocket(origin, freshCookie);
    assert.deepEqual(aliceSecond.ready.friends, ['persist_bob']);
    await closeSocket(aliceSecond.socket);
  } finally {
    await closeSocket(alice?.socket);
    await closeSocket(bob?.socket);
    if (running) await stopServer(running.child);
    removeTemp(dir);
  }
});

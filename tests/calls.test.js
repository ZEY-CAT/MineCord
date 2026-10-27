const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
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

async function startServer(port, databaseFile, extraEnv = {}) {
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
      METERED_CREDENTIAL_TTL_SECONDS: '',
      ...extraEnv
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

async function openSocket(origin, cookie) {
  const socket = new WebSocket(origin.replace('http', 'ws'), { headers: { Cookie: cookie, Origin: origin } });
  // Attach the ready listener before awaiting "open". The server can send
  // "ready" immediately, and under parallel test load it may arrive before the
  // open await resumes. Registering first prevents a rare lost-message race.
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

function sendAndWait(socket, payload, predicate, timeout = 10000) {
  const expected = waitFor(socket, predicate, timeout);
  socket.send(JSON.stringify(payload));
  return expected;
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, 'close');
  socket.close();
  await closed;
}

async function befriend(origin, firstSocket, secondSocket, firstUsername, secondUsername) {
  await sendAndWait(firstSocket, { type: 'friend_request', to: secondUsername }, message => message.type === 'friend_status' && message.status === 'pending');
  await sendAndWait(secondSocket, { type: 'friend_accept', with: firstUsername }, message => message.type === 'friend_status' && message.status === 'accepted');
  void origin;
}

test('incoming calls reach every tab, cancel cleanly, time out, and survive caller disconnects', { timeout: 60000 }, async () => {
  const port = await availablePort();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-calls-'));
  const databaseFile = path.join(tempDir, 'minecord.sqlite');
  initializeDatabase(databaseFile);
  let running;
  let aliceSocket;
  let bobSocket;
  let bobTabTwo;
  try {
    running = await startServer(port, databaseFile, { CALL_RING_TIMEOUT_MS: '1200' });
    const aliceCookie = await createAccount(running.origin, 'caller_alice');
    const bobCookie = await createAccount(running.origin, 'receiver_bob');
    const alice = await openSocket(running.origin, aliceCookie);
    aliceSocket = alice.socket;
    assert.ok(Number.isInteger(alice.ready.maxCallParticipants) && alice.ready.maxCallParticipants >= 2);
    const bob = await openSocket(running.origin, bobCookie);
    bobSocket = bob.socket;
    const bobSecond = await openSocket(running.origin, bobCookie);
    bobTabTwo = bobSecond.socket;
    await befriend(running.origin, aliceSocket, bobSocket, 'caller_alice', 'receiver_bob');

    // Every connected tab receives the same incoming call exactly once.
    const firstTabIncoming = waitFor(bobSocket, message => message.type === 'incoming_call');
    const secondTabIncoming = waitFor(bobTabTwo, message => message.type === 'incoming_call');
    const started = await sendAndWait(aliceSocket, { type: 'call_start', to: 'receiver_bob', callType: 'private' }, message => message.type === 'call_started');
    const incomingOne = await firstTabIncoming;
    const incomingTwo = await secondTabIncoming;
    assert.equal(incomingOne.callId, started.callId);
    assert.equal(incomingTwo.callId, started.callId);
    assert.equal(incomingOne.from, 'caller_alice');
    assert.equal(incomingOne.expiresInMs, 1200);

    // Accepting in one tab closes the ringing prompt in the other tab.
    const accepted = sendAndWait(bobSocket, { type: 'call_accept', callId: started.callId }, message => message.type === 'call_accepted');
    const aliceJoined = waitFor(aliceSocket, message => message.type === 'call_member_joined' && message.user === 'receiver_bob');
    const secondTabSync = waitFor(bobTabTwo, message => message.type === 'call_state_sync' && message.callId === started.callId && message.state === 'accepted');
    await Promise.all([accepted, aliceJoined, secondTabSync]);

    // Ending from the caller closes the call for both accounts and both Bob tabs.
    const bobEnded = waitFor(bobSocket, message => message.type === 'call_ended' && message.callId === started.callId);
    const bobSecondEnded = waitFor(bobTabTwo, message => message.type === 'call_ended' && message.callId === started.callId);
    aliceSocket.send(JSON.stringify({ type: 'call_end', callId: started.callId }));
    await Promise.all([bobEnded, bobSecondEnded]);

    // Caller cancellation must dismiss a still-ringing recipient instead of leaving it stuck.
    const cancelIncoming = waitFor(bobSocket, message => message.type === 'incoming_call');
    const cancelStarted = await sendAndWait(aliceSocket, { type: 'call_start', to: 'receiver_bob', callType: 'private' }, message => message.type === 'call_started');
    await cancelIncoming;
    const cancelled = waitFor(bobSocket, message => message.type === 'call_cancelled' && message.callId === cancelStarted.callId);
    aliceSocket.send(JSON.stringify({ type: 'call_end', callId: cancelStarted.callId }));
    assert.equal((await cancelled).reason, 'ended');
    const lateAccept = await sendAndWait(bobSocket, { type: 'call_accept', callId: cancelStarted.callId }, message => message.type === 'error');
    assert.match(lateAccept.message, /no longer awaiting/);

    // Ringing calls expire and notify both sides.
    const timeoutIncoming = waitFor(bobSocket, message => message.type === 'incoming_call');
    const timeoutStarted = await sendAndWait(aliceSocket, { type: 'call_start', to: 'receiver_bob', callType: 'private' }, message => message.type === 'call_started');
    await timeoutIncoming;
    const [timedOutCaller, timedOutReceiver] = await Promise.all([
      waitFor(aliceSocket, message => message.type === 'call_ended' && message.callId === timeoutStarted.callId, 5000),
      waitFor(bobSocket, message => message.type === 'call_cancelled' && message.callId === timeoutStarted.callId, 5000)
    ]);
    assert.equal(timedOutCaller.reason, 'timeout');
    assert.equal(timedOutReceiver.reason, 'timeout');

    // A caller disconnect while ringing also dismisses the recipient prompt.
    const disconnectIncoming = waitFor(bobSocket, message => message.type === 'incoming_call');
    const disconnectStarted = await sendAndWait(aliceSocket, { type: 'call_start', to: 'receiver_bob', callType: 'private' }, message => message.type === 'call_started');
    await disconnectIncoming;
    const disconnectCancelled = waitFor(bobSocket, message => message.type === 'call_cancelled' && message.callId === disconnectStarted.callId);
    await closeSocket(aliceSocket);
    aliceSocket = null;
    assert.equal((await disconnectCancelled).reason, 'caller_disconnected');
  } finally {
    if (aliceSocket) await closeSocket(aliceSocket).catch(() => {});
    if (bobSocket) await closeSocket(bobSocket).catch(() => {});
    if (bobTabTwo) await closeSocket(bobTabTwo).catch(() => {});
    await stopServer(running?.child);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('video calls carry media type, allow participant invitations, and synchronize media state', { timeout: 60000 }, async () => {
  const port = await availablePort();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-video-calls-'));
  const databaseFile = path.join(tempDir, 'minecord.sqlite');
  initializeDatabase(databaseFile);
  let running;
  let aliceSocket;
  let bobSocket;
  let carolSocket;
  let daveSocket;
  try {
    running = await startServer(port, databaseFile, { CALL_RING_TIMEOUT_MS: '30000' });
    const aliceCookie = await createAccount(running.origin, 'video_alice');
    const bobCookie = await createAccount(running.origin, 'video_bob');
    const carolCookie = await createAccount(running.origin, 'video_carol');
    const daveCookie = await createAccount(running.origin, 'video_dave');
    aliceSocket = (await openSocket(running.origin, aliceCookie)).socket;
    bobSocket = (await openSocket(running.origin, bobCookie)).socket;
    carolSocket = (await openSocket(running.origin, carolCookie)).socket;
    daveSocket = (await openSocket(running.origin, daveCookie)).socket;
    await befriend(running.origin, aliceSocket, bobSocket, 'video_alice', 'video_bob');
    await befriend(running.origin, aliceSocket, carolSocket, 'video_alice', 'video_carol');

    const bobIncoming = waitFor(bobSocket, message => message.type === 'incoming_call' && message.from === 'video_alice');
    const started = await sendAndWait(aliceSocket, { type: 'call_start', to: 'video_bob', callType: 'private', mediaType: 'video' }, message => message.type === 'call_started');
    assert.equal(started.mediaType, 'video');
    assert.equal(started.typeName, 'private');
    assert.deepEqual(started.invited, ['video_bob']);
    const bobRinging = await bobIncoming;
    assert.equal(bobRinging.mediaType, 'video');

    const bobAccepted = sendAndWait(bobSocket, { type: 'call_accept', callId: started.callId }, message => message.type === 'call_accepted');
    const aliceSawBob = waitFor(aliceSocket, message => message.type === 'call_member_joined' && message.user === 'video_bob');
    const [bobAcceptance] = await Promise.all([bobAccepted, aliceSawBob]);
    assert.equal(bobAcceptance.mediaType, 'video');

    const bobSeesAliceMedia = waitFor(bobSocket, message => message.type === 'call_media' && message.user === 'video_alice');
    aliceSocket.send(JSON.stringify({ type: 'call_media', callId: started.callId, audio: true, video: true }));
    assert.deepEqual(await bobSeesAliceMedia, {
      type: 'call_media', callId: started.callId, user: 'video_alice', audio: true, video: true
    });

    const aliceSeesBobMedia = waitFor(aliceSocket, message => message.type === 'call_media' && message.user === 'video_bob');
    bobSocket.send(JSON.stringify({ type: 'call_media', callId: started.callId, audio: true, video: false }));
    assert.equal((await aliceSeesBobMedia).video, false);

    const carolIncoming = waitFor(carolSocket, message => message.type === 'incoming_call' && message.callId === started.callId);
    const aliceInvited = waitFor(aliceSocket, message => message.type === 'call_invite_sent' && message.callId === started.callId);
    const bobSawInvitation = waitFor(bobSocket, message => message.type === 'call_member_invited' && message.users?.includes('video_carol'));
    aliceSocket.send(JSON.stringify({ type: 'call_invite', callId: started.callId, to: ['video_carol'] }));
    const [carolRinging, inviteSent, invitedEvent] = await Promise.all([carolIncoming, aliceInvited, bobSawInvitation]);
    assert.deepEqual(inviteSent.targets, ['video_carol']);
    assert.equal(inviteSent.typeName, 'group');
    assert.equal(carolRinging.mediaType, 'video');
    assert.equal(carolRinging.typeName, 'group');
    assert.equal(invitedEvent.by, 'video_alice');

    // Repeated invitations and invitations from non-participants are rejected.
    const duplicateInvite = await sendAndWait(aliceSocket, { type: 'call_invite', callId: started.callId, to: ['video_carol'] }, message => message.type === 'error');
    assert.match(duplicateInvite.message, /already in this call|already invited/i);
    const outsiderInvite = await sendAndWait(daveSocket, { type: 'call_invite', callId: started.callId, to: ['video_bob'] }, message => message.type === 'error');
    assert.match(outsiderInvite.message, /Join the call/);

    const carolAccepted = sendAndWait(carolSocket, { type: 'call_accept', callId: started.callId }, message => message.type === 'call_accepted');
    const aliceSawCarol = waitFor(aliceSocket, message => message.type === 'call_member_joined' && message.user === 'video_carol');
    const bobSawCarol = waitFor(bobSocket, message => message.type === 'call_member_joined' && message.user === 'video_carol');
    const [carolAcceptance] = await Promise.all([carolAccepted, aliceSawCarol, bobSawCarol]);
    assert.deepEqual([...carolAcceptance.participants].sort(), ['video_alice', 'video_bob', 'video_carol']);
    assert.equal(carolAcceptance.mediaType, 'video');

    // Camera/screen-share style renegotiation is a valid signaling payload.
    const aliceRenegotiation = waitFor(aliceSocket, message => message.type === 'call_signal' && message.from === 'video_bob' && message.data?.renegotiate === true);
    bobSocket.send(JSON.stringify({ type: 'call_signal', callId: started.callId, to: 'video_alice', data: { renegotiate: true } }));
    assert.equal((await aliceRenegotiation).data.renegotiate, true);
    const invalidSignal = await sendAndWait(bobSocket, { type: 'call_signal', callId: started.callId, to: 'video_alice', data: { unexpected: true } }, message => message.type === 'error');
    assert.match(invalidSignal.message, /Invalid call signaling/);

    const bobEnded = waitFor(bobSocket, message => message.type === 'call_ended' && message.callId === started.callId);
    const carolEnded = waitFor(carolSocket, message => message.type === 'call_ended' && message.callId === started.callId);
    aliceSocket.send(JSON.stringify({ type: 'call_end', callId: started.callId }));
    await Promise.all([bobEnded, carolEnded]);
  } finally {
    if (aliceSocket) await closeSocket(aliceSocket).catch(() => {});
    if (bobSocket) await closeSocket(bobSocket).catch(() => {});
    if (carolSocket) await closeSocket(carolSocket).catch(() => {});
    if (daveSocket) await closeSocket(daveSocket).catch(() => {});
    await stopServer(running?.child);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('group calls deliver the right membership and keep accepted participants connected after a decline', { timeout: 60000 }, async () => {
  const port = await availablePort();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'minecord-group-calls-'));
  const databaseFile = path.join(tempDir, 'minecord.sqlite');
  initializeDatabase(databaseFile);
  let running;
  let aliceSocket;
  let bobSocket;
  let carolSocket;
  try {
    running = await startServer(port, databaseFile, { CALL_RING_TIMEOUT_MS: '30000' });
    const aliceCookie = await createAccount(running.origin, 'group_alice');
    const bobCookie = await createAccount(running.origin, 'group_bob');
    const carolCookie = await createAccount(running.origin, 'group_carol');
    aliceSocket = (await openSocket(running.origin, aliceCookie)).socket;
    bobSocket = (await openSocket(running.origin, bobCookie)).socket;
    carolSocket = (await openSocket(running.origin, carolCookie)).socket;
    await befriend(running.origin, aliceSocket, bobSocket, 'group_alice', 'group_bob');
    await befriend(running.origin, aliceSocket, carolSocket, 'group_alice', 'group_carol');

    const bobIncoming = waitFor(bobSocket, message => message.type === 'incoming_call' && message.typeName === 'group');
    const carolIncoming = waitFor(carolSocket, message => message.type === 'incoming_call' && message.typeName === 'group');
    const started = await sendAndWait(aliceSocket, { type: 'call_start', to: ['group_bob', 'group_carol'], callType: 'group' }, message => message.type === 'call_started');
    assert.equal(started.typeName, 'group');
    assert.equal((await bobIncoming).typeName, 'group');
    assert.equal((await carolIncoming).typeName, 'group');

    const bobAccepted = sendAndWait(bobSocket, { type: 'call_accept', callId: started.callId }, message => message.type === 'call_accepted');
    const aliceSawBob = waitFor(aliceSocket, message => message.type === 'call_member_joined' && message.user === 'group_bob');
    const [bobAcceptance] = await Promise.all([bobAccepted, aliceSawBob]);
    assert.deepEqual([...bobAcceptance.participants].sort(), ['group_alice', 'group_bob']);

    const aliceSawDecline = waitFor(aliceSocket, message => message.type === 'call_declined' && message.user === 'group_carol');
    const bobSawDecline = waitFor(bobSocket, message => message.type === 'call_declined' && message.user === 'group_carol');
    carolSocket.send(JSON.stringify({ type: 'call_decline', callId: started.callId }));
    await Promise.all([aliceSawDecline, bobSawDecline]);

    // The two remaining participants still have a working media-signaling path.
    const bobSignal = waitFor(bobSocket, message => message.type === 'call_signal' && message.from === 'group_alice');
    aliceSocket.send(JSON.stringify({ type: 'call_signal', callId: started.callId, to: 'group_bob', data: { description: { type: 'offer', sdp: 'group-test' } } }));
    assert.equal((await bobSignal).data.description.type, 'offer');

    const aliceEnded = waitFor(aliceSocket, message => message.type === 'call_ended' && message.callId === started.callId);
    bobSocket.send(JSON.stringify({ type: 'call_end', callId: started.callId }));
    await aliceEnded;
  } finally {
    if (aliceSocket) await closeSocket(aliceSocket).catch(() => {});
    if (bobSocket) await closeSocket(bobSocket).catch(() => {});
    if (carolSocket) await closeSocket(carolSocket).catch(() => {});
    await stopServer(running?.child);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

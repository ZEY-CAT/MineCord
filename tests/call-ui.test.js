const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const calls = readFileSync(path.join(ROOT, 'public', 'calls.js'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));

function button(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`, 'i'));
  assert.ok(match, `Expected a ${id} button in public/index.html`);
  return match[0];
}

test('call actions use distinct Lucide-style icons and accessible labels', () => {
  const voice = button('callBtn');
  const video = button('videoCallBtn');
  const group = button('groupCallBtn');
  const invite = button('inviteBtn');

  assert.match(voice, /#icon-call/);
  assert.match(voice, /aria-label="Start voice call"/);
  assert.match(video, /#icon-video/);
  assert.match(video, /aria-label="Start video call"/);
  assert.match(group, /#icon-group-call/);
  assert.doesNotMatch(group, /#icon-video/);
  assert.match(group, /aria-label="Start group call"/);
  assert.match(invite, /#icon-user-plus/);
  assert.match(invite, /aria-label="Invite people to this server"/);

  assert.match(html, /<symbol id="icon-video-off"/);
  assert.match(html, /<symbol id="icon-mic-off"/);
  assert.match(html, /<symbol id="icon-user-plus"/);
  assert.match(html, /<symbol id="icon-group-call"/);
  assert.match(html, /<symbol id="icon-hangup"/);
});

test('call surface has persistent End call and complete media controls', () => {
  const start = html.indexOf('<div id="callBar"');
  const end = html.indexOf('<div id="callInviteModal"', start);
  const bar = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(bar, /id="endCall"[^>]*class="[^"]*danger[^"]*callEnd/);
  assert.match(bar, /aria-label="End call"/);
  assert.match(bar, />End call</);
  assert.match(bar, /id="muteBtn"/);
  assert.match(bar, /id="cameraBtn"/);
  assert.match(bar, /id="addCallPeopleBtn"/);
  assert.match(bar, /id="deafenBtn"/);
  assert.match(bar, /id="callVideoGrid"/);
  assert.match(bar, /id="callAvatarGrid"/);
  assert.match(bar, /id="callLocalVideo"/);
  assert.match(bar, /id="callAudioDevice"/);
  assert.match(bar, /aria-label="Your camera preview"/);
});

test('calls.js implements real media, negotiation, invitations, and cleanup', () => {
  assert.match(calls, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(calls, /new RTCPeerConnection/);
  assert.match(calls, /createOffer/);
  assert.match(calls, /setRemoteDescription/);
  assert.match(calls, /onicecandidate/);
  assert.match(calls, /type: 'call_invite'/);
  assert.match(calls, /type: 'call_media'/);
  assert.match(calls, /call_member_invited/);
  assert.match(calls, /enumerateDevices/);
  assert.match(calls, /replaceTrack/);
  assert.match(calls, /\.stop\(\)/);
  assert.match(calls, /function finishCall/);
  assert.match(calls, /function restartCallPeer/);
  assert.match(calls, /activeCall\.invited/);
});

test('voice-only calls render avatars instead of an empty video area', () => {
  assert.match(calls, /function renderCallAvatarGrid/);
  assert.match(calls, /function renderCallVideoGrid/);
  assert.match(calls, /callAvatarGrid/);
  assert.match(calls, /Waiting for someone to join/);
});

test('mobile call layout keeps controls in the viewport', () => {
  assert.match(head, /\.callBar\{position:fixed;[^}]*bottom:18px/);
  assert.match(head, /@media\(max-width:768px\)\{[\s\S]*?\.callBar\{[^}]*left:8px[^}]*right:8px[^}]*bottom:8px/);
  assert.match(head, /\.callFooter\{[^}]*position:sticky[^}]*bottom:0/);
  assert.match(head, /\.callButtons\{[^}]*flex-wrap:wrap/);
});

test('server invitations stay separate from active-call invitations', () => {
  assert.match(html, /id="inviteModal"/);
  assert.match(html, /id="inviteSearchInput"/);
  assert.match(html, /id="inviteLinkInput"/);
  assert.match(html, /id="inviteServerName"/);
  assert.match(html, /id="callInviteModal"/);
  assert.match(html, /id="callInviteSearch"/);
  assert.match(calls, /openInviteModal/);
  assert.notEqual(html.indexOf('id="inviteModal"'), html.indexOf('id="callInviteModal"'));
});

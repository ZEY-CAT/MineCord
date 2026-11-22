const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const extensionDir = path.resolve(__dirname, '..', 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const detector = fs.readFileSync(path.join(extensionDir, 'detector.js'), 'utf8');

function contentScriptMatches(value) {
  const url = new URL(value);
  return manifest.content_scripts[0].matches.some(pattern => {
    const match = new URL(pattern);
    if (url.origin !== match.origin) return false;
    return match.pathname.endsWith('*')
      ? url.pathname.startsWith(match.pathname.slice(0, -1))
      : url.pathname === match.pathname;
  });
}

function detect(url, hasCanvas = true) {
  const messages = [];
  const canvas = {
    width: 640,
    height: 360,
    getBoundingClientRect: () => ({ width: 640, height: 360 })
  };
  runInNewContext(detector, {
    URL,
    location: new URL(url),
    chrome: { runtime: { sendMessage: message => { messages.push(message); return Promise.resolve(); } } },
    document: {
      visibilityState: 'visible',
      documentElement: {},
      querySelectorAll: () => hasCanvas ? [canvas] : [],
      addEventListener() {}
    },
    MutationObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {} },
    setInterval: () => 1,
    clearInterval() {}
  });
  return JSON.parse(JSON.stringify(messages));
}

test('Eaglercraft extension matches only the supported game page patterns', () => {
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev/eaglercraft-26.2-u1.html*',
    'https://eaglercraft.com/play'
  ]);
  assert.equal(contentScriptMatches('https://eaglercraft.com/play?version=26.2'), true);
  assert.equal(contentScriptMatches('https://eaglercraft.com/playground?version=26.2'), false);
  assert.equal(contentScriptMatches('https://unrelated.example/play?version=26.2'), false);
  assert.deepEqual(detect('https://eaglercraft.com/play?version=26.2'), [
    { type: 'eaglercraft-state', active: true }
  ]);
  assert.deepEqual(detect('https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev/eaglercraft-26.2-u1.html?v=u1-20260930'), [
    { type: 'eaglercraft-state', active: true }
  ]);
  assert.deepEqual(detect('https://eaglercraft.com/play?version=26.1'), []);
  assert.deepEqual(detect('https://unrelated.example/play?version=26.2'), []);
  assert.deepEqual(detect('https://eaglercraft.com/other?version=26.2'), []);
  assert.deepEqual(detect('https://eaglercraft.com/play?version=26.2', false), [
    { type: 'eaglercraft-state', active: false }
  ]);
});

test('extension popup uses the accessible responsive pairing interface and shared theme', () => {
  const popup = fs.readFileSync(path.join(extensionDir, 'popup.html'), 'utf8');
  const theme = fs.readFileSync(path.join(extensionDir, 'options.css'), 'utf8');
  const popupLogic = fs.readFileSync(path.join(extensionDir, 'popup.js'), 'utf8');
  for (const id of ['server', 'code', 'pair', 'unpair', 'status', 'options']) assert.match(popup, new RegExp(`id="${id}"`));
  assert.match(popup, /href="options\.css"/);
  assert.match(popup, /aria-live="polite"/);
  assert.match(popup, /type="url"/);
  assert.match(theme, /body\.popup/);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
  assert.match(popupLogic, /requestOriginPermission/);
  assert.match(popupLogic, /serverOrigin/);
});

test('download archive is a valid ZIP containing the exact current extension sources', () => {
  const { createEaglercraftArchive } = require('../server/extension-archive');
  const archive = createEaglercraftArchive(extensionDir);
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50);
  const count = archive.readUInt16LE(endOffset + 10);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const files = new Map();
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 10), 0, 'entries use standard uncompressed ZIP storage');
    const checksum = archive.readUInt32LE(cursor + 16);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(archive.readUInt32LE(localOffset + 14), checksum);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const content = archive.subarray(contentOffset, contentOffset + size);
    assert.equal(content.length, size);
    assert.deepEqual(content, fs.readFileSync(path.join(extensionDir, name)), `${name} matches source`);
    files.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, endOffset);
  assert.ok(files.has('popup.html'));
  assert.ok(files.has('options.css'));
  assert.match(files.get('popup.html').toString('utf8'), /Private game activity sharing/);
});

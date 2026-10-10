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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('MineCord Companion offers original pets, persistent preferences, and all requested animations', () => {
  const html = read('public/index.html');
  const script = read('public/companion.js');
  const css = read('public/companion.css');
  for (const skin of ['slime', 'fox', 'bee', 'axolotl']) assert.match(script, new RegExp(`^\\s+${skin}:`, 'm'));
  for (const animation of ['idle', 'walking', 'sleeping', 'happy', 'excited', 'playful']) {
    assert.match(script, new RegExp(`'${animation}'`));
    assert.match(css, new RegExp(`mc-pet-animation-${animation}`));
  }
  assert.match(script, /minecord\.companion\.v1\./);
  assert.match(script, /minecord:pet-reaction/);
  assert.match(script, /overlay-ready/);
  assert.match(script, /set_companion_overlay/);
  assert.match(script, /if \(!menu\.hidden\) \{\s*widget\.hidden = false;/);
  assert.match(script, /typeof online !== 'undefined'/);
  assert.match(html, /src="\/companion\.js"/);
  assert.match(read('public/companion.html'), /companion\.js/);
  assert.doesNotMatch(script, /setInterval\s*\(/);
});

test('the companion overlay receives only activity categories, never private message text', () => {
  const script = read('public/companion.js');
  assert.match(script, /channel\?\.postMessage\(\{ type: 'reaction', kind \}\)/);
  assert.match(script, /\['message', 'dm', 'group_dm_message'\]\.includes\(message\?\.type\)/);
  assert.doesNotMatch(script, /postMessage\(\{[^}]*message\.message/);
  assert.doesNotMatch(script, /postMessage\(\{[^}]*\.text/);
  assert.match(script, /preferences\.reactionsEnabled/);
  assert.match(script, /document\.visibilityState/);
});

test('Android keeps the pet in-app and leaves desktop overlays unavailable', () => {
  const script = read('public/companion.js');
  const rust = read('src-tauri/src/lib.rs');
  const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  assert.match(script, /Android\|iPhone\|iPad/);
  assert.match(rust, /#\[cfg\(mobile\)\][\s\S]*desktop pet overlay is not available/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
});

test('PWA worker caches the app shell without caching auth, API, or message responses', () => {
  const worker = read('public/sw.js');
  const notifications = read('public/notifications.js');
  assert.match(worker, /addEventListener\('install'/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /pathname\.startsWith\('\/auth\/'\)/);
  assert.match(worker, /pathname\.startsWith\('\/download'/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /new Set\(\['message', 'friendOnline', 'call', 'invite'\]\)/);
  assert.match(notifications, /You have a new message in MineCord\./);
  assert.doesNotMatch(notifications, /message\.message\.text/);
  assert.match(notifications, /requestPermission/);
  assert.match(notifications, /typeof friendsList !== 'undefined'/);
});

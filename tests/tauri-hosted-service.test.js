const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
const hostedOrigin = 'https://minecord-8vg2.onrender.com';

test('Tauri desktop opens the same hosted service in development and release', () => {
  assert.equal(tauri.build.devUrl, hostedOrigin);
  assert.equal(tauri.app.windows.find(window => window.label === 'main').url, hostedOrigin);
  assert.equal(new URL(tauri.build.devUrl).origin, new URL(tauri.app.windows[0].url).origin);
});

test('Tauri remote APIs are scoped to the official hosted origin', () => {
  assert.deepEqual(capability.remote.urls, [hostedOrigin]);
  assert.deepEqual(capability.permissions, ['core:default']);
  assert.equal(tauri.app.withGlobalTauri, true);
});

test('Tauri packaging does not bundle a local account database or Node backend', () => {
  assert.equal(tauri.bundle.resources, undefined);
  const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
  assert.doesNotMatch(rust, /DATABASE_URL|minecord\.sqlite|server\.js|Command::new/);
});

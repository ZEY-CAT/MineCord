const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Electron sends only validated MineCord OAuth starts to the system browser', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.js');
  const config = JSON.parse(read('package.json'));
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /setAsDefaultProtocolClient\('minecord'/);
  assert.match(main, /minecord:open-external-auth/);
  assert.match(main, /https:\/\/minecord-8vg2\.onrender\.com/);
  assert.match(main, /google\|microsoft\|github/);
  assert.match(main, /shell\.openExternal\(url\.toString\(\)\)/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /ipcRenderer\.invoke\('minecord:open-external-auth'/);
  assert.doesNotMatch(preload, /nodeIntegration/);
  assert.deepEqual(config.build.protocols, [{ name: 'MINECORD sign-in return', schemes: ['minecord'] }]);
});

test('Electron and Tauri clients correlate deep-link returns with the pending PKCE request', () => {
  const main = read('desktop/main.js');
  const frontend = read('public/native-oauth.js');
  assert.match(main, /url\.protocol !== 'minecord:'/);
  assert.match(main, /url\.hostname !== 'oauth'/);
  assert.match(main, /minecord:oauth-url/);
  assert.match(frontend, /window\.minecordDesktop\?\.onOAuthUrl/);
  assert.match(frontend, /pending\.state !== state/);
  assert.match(frontend, /credentials: 'same-origin'/);
  assert.match(frontend, /minecord:\/\/|protocol !== 'minecord:'/);
});

test('Electron opens the canonical MineCord application route', () => {
  const main = read('desktop/main.js');
  assert.match(main, /win\.loadURL\(new URL\('\/app', serverUrl\)\.toString\(\)\)/);
});

test('browser sign-in opens only the canonical app path in the external browser', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.js');
  const frontend = read('public/native-oauth.js');
  assert.match(main, /minecord:open-app-in-browser/);
  assert.match(main, /new URL\('\/app', serverUrl\)/);
  assert.match(main, /url\.pathname !== '\/app'/);
  assert.match(preload, /openAppInBrowser: \(\) => ipcRenderer\.invoke\('minecord:open-app-in-browser'\)/);
  assert.match(frontend, /window\.minecordDesktop\?\.openAppInBrowser/);
  assert.match(frontend, /loginBrowserActions/);
  assert.match(frontend, /Copy sign-in link/);
});

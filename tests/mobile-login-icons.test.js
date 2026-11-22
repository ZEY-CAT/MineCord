const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { PNG } = require('pngjs');
const { test } = require('node:test');
const { buildAuthorizationUrl } = require('../server/account-links');

const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

test('PWA manifest points to the app route and separate any/maskable MineCord icons', () => {
  const manifest = JSON.parse(read('public/manifest.json'));
  assert.equal(manifest.start_url, '/app');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(new Set(manifest.icons.map(icon => icon.purpose)), new Set(['any', 'maskable']));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, 'public', icon.src.split('?')[0].slice(1))), icon.src);
  }
  assert.ok(fs.existsSync(path.join(root, 'public/icons/apple-touch-icon.png')));
  const appHtml = read('public/index.html');
  assert.match(appHtml, /viewport-fit=cover/);
  assert.match(appHtml, /apple-mobile-web-app-capable/);
  assert.match(appHtml, /icons\/apple-touch-icon\.png/);
});

test('fixed navigation labels use normal capitalization and layout does not force uppercase', () => {
  const appHtml = read('public/index.html');
  assert.match(appHtml, />Channels<\/div>/);
  assert.match(appHtml, />Direct messages /);
  assert.match(appHtml, />Friends<\/div>/);
  assert.doesNotMatch(appHtml, /text-transform:\s*uppercase/i);
});

test('generated PWA and Android raster icons are nonblank and correctly sized', () => {
  const images = [
    ['public/icons/icon-192.png', 192], ['public/icons/icon-512.png', 512],
    ['public/icons/maskable-192.png', 192], ['public/icons/maskable-512.png', 512],
    ['public/icons/apple-touch-icon.png', 180], ['assets/minecord-icon.png', 512],
    ['src-tauri/icons/icon.png', 512],
    ['src-tauri/gen/android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
    ['src-tauri/gen/android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
    ['src-tauri/gen/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
    ['src-tauri/gen/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
    ['src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192]
  ];
  for (const [filename, dimension] of images) {
    const png = PNG.sync.read(fs.readFileSync(path.join(root, filename)));
    assert.equal(png.width, dimension, filename);
    assert.equal(png.height, dimension, filename);
    const colors = new Set();
    for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]},${png.data[i + 3]}`);
    assert.ok(colors.size > 8, `${filename} must contain the MineCord mark, not a blank placeholder`);
  }
});

test('Android uses an adaptive launcher icon and a branded launch screen', () => {
  const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  const adaptive = read('src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  const adaptiveRound = read('src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
  const foreground = read('src-tauri/gen/android/app/src/main/res/drawable/ic_launcher_foreground.xml');
  const splash = read('src-tauri/gen/android/app/src/main/res/drawable/launch_screen.xml');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(adaptive, /<adaptive-icon/);
  assert.match(adaptiveRound, /<adaptive-icon/);
  assert.match(adaptive, /@drawable\/ic_launcher_foreground/);
  assert.match(foreground, /#8BE0A0/);
  assert.match(splash, /@color\/launcher_background/);
});

test('favicon and desktop icon containers include the generated MineCord artwork', () => {
  const ico = fs.readFileSync(path.join(root, 'public/favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  const pngOffset = ico.readUInt32LE(18);
  assert.deepEqual(ico.subarray(pngOffset, pngOffset + 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const icns = fs.readFileSync(path.join(root, 'src-tauri/icons/icon.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  for (const type of ['ic07', 'ic08', 'ic09', 'ic10']) assert.ok(icns.includes(Buffer.from(type)));
});

test('Google and Microsoft OAuth request account selection without changing secure PKCE return handling', () => {
  const original = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID };
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.MICROSOFT_CLIENT_ID = 'microsoft-client';
  try {
    for (const provider of ['google', 'microsoft']) {
      const url = new URL(buildAuthorizationUrl(provider, 'state-value', 'https://minecord.example/auth/callback'));
      assert.equal(url.searchParams.get('prompt'), 'select_account');
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const auth = read('public/native-oauth.js');
  assert.match(auth, /loginBrowserActions/);
  assert.match(auth, /Sign in with browser/);
  assert.match(auth, /Copy sign-in link/);
  assert.match(auth, /Browser and app sessions are separate/);
  assert.match(auth, /minecordDesktop\?\.openAppInBrowser/);
  const desktop = read('desktop/main.js');
  assert.match(desktop, /minecord:open-app-in-browser/);
  assert.match(desktop, /url\.pathname !== '\/app'/);
});

test('Google/Microsoft Java and Bedrock linking requests show an account chooser', () => {
  const server = read('server/server.js');
  assert.equal((server.match(/prompt:'select_account'/g) || []).length, 2);
});

test('browser sign-in and copy-link buttons independently perform their advertised actions', async () => {
  const listeners = new Map();
  const makeButton = text => ({
    textContent: text,
    classList: { remove() {}, add() {} },
    removeAttribute() {},
    before() {},
    addEventListener(name, callback) { listeners.set(`${text}:${name}`, callback); }
  });
  const browserButton = makeButton('Sign in with website');
  const copyButton = makeButton('Copy sign-in link');
  const nodes = { loginError: { textContent: '' } };
  const made = [];
  const document = {
    querySelectorAll(selector) {
      if (selector === '#login .oauthButton') return [];
      if (selector === '#login button') return [browserButton, copyButton];
      return [];
    },
    createElement(tag) {
      const node = { tag, setAttribute() {}, append() {}, after() {} };
      made.push(node);
      return node;
    },
    getElementById(id) { return nodes[id]; }
  };
  const copied = [];
  const opened = [];
  const window = { open: (...args) => { opened.push(args); return {}; } };
  runInNewContext(read('public/native-oauth.js'), {
    URL,
    window,
    location: { origin: 'https://minecord-8vg2.onrender.com', assign() {} },
    document,
    navigator: { clipboard: { writeText: async value => copied.push(value) } }
  });
  await listeners.get('Sign in with website:click')();
  await listeners.get('Copy sign-in link:click')();
  assert.deepEqual(opened, [['https://minecord-8vg2.onrender.com/app', '_blank', 'noopener,noreferrer']]);
  assert.deepEqual(copied, ['https://minecord-8vg2.onrender.com/app']);
  assert.match(nodes.loginError.textContent, /link copied/i);
  assert.equal(made[0].className, 'loginBrowserActions');
  assert.match(made[1].textContent, /Browser and app sessions are separate/);
});

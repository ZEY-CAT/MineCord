const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hostedOrigin = 'https://minecord-8vg2.onrender.com';

test('desktop and Android start directly on the MineCord application route', () => {
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const android = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.android.conf.json'), 'utf8'));
  const generated = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'assets', 'tauri.conf.json'), 'utf8'));

  assert.equal(desktop.app.windows.find(window => window.label === 'main').url, `${hostedOrigin}/app`);
  assert.equal(android.app.windows.find(window => window.label === 'main').url, `${hostedOrigin}/app`);
  assert.equal(generated.app.windows.find(window => window.label === 'main').url, `${hostedOrigin}/app`);
});

test('Android declares the universal flavor requested by Tauri APK builds', () => {
  const gradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts'), 'utf8');

  assert.match(gradle, /flavorDimensions\s*\+=\s*"distribution"/);
  assert.match(gradle, /create\("universal"\)\s*\{\s*dimension\s*=\s*"distribution"/);
});

test('Android only evaluates init scripts manually when document-start scripts are unavailable', () => {
  const webView = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'com', 'minecord', 'app', 'generated', 'RustWebView.kt'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'com', 'minecord', 'app', 'generated', 'RustWebViewClient.kt'), 'utf8');

  assert.match(webView, /WebViewCompat\.addDocumentStartJavaScript\(this, script, setOf\("\*"\)\)/);
  assert.match(client, /interceptedState\[url\] == false && !webView\.isDocumentStartScriptEnabled/);
  assert.match(client, /view\.evaluateJavascript\(script, null\)/);
});

test('Android requests call media permissions only when WebView media capture is used', () => {
  const activityPath = path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'com', 'minecord', 'app', 'MainActivity.kt');
  const chromePath = path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'com', 'minecord', 'app', 'generated', 'RustWebChromeClient.kt');
  const activity = fs.readFileSync(activityPath, 'utf8');
  const chrome = fs.readFileSync(chromePath, 'utf8');

  assert.doesNotMatch(activity, /requestMicrophonePermission|ActivityCompat\.requestPermissions/);
  assert.match(chrome, /PermissionRequest\.RESOURCE_AUDIO_CAPTURE/);
  assert.match(chrome, /PermissionRequest\.RESOURCE_VIDEO_CAPTURE/);
  assert.match(chrome, /activity\.requestPermissions\(permissions\)/);
});

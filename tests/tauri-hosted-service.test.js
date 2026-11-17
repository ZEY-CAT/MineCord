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
  assert.equal(tauri.app.windows.find(window => window.label === 'main').url, `${hostedOrigin}/app`);
  assert.equal(new URL(tauri.build.devUrl).origin, new URL(tauri.app.windows[0].url).origin);
});

test('Tauri remote APIs and native sign-in plugins are scoped to the official hosted origin', () => {
  assert.deepEqual(capability.remote.urls, [hostedOrigin]);
  assert.ok(capability.permissions.includes('core:default'));
  assert.ok(capability.permissions.includes('core:event:default'));
  assert.ok(capability.permissions.includes('deep-link:default'));
  assert.ok(capability.permissions.some(permission => permission.identifier === 'opener:allow-open-url'
    && permission.allow.some(scope => scope.url === `${hostedOrigin}/**`)));
  assert.deepEqual(tauri.plugins['deep-link'].mobile, [{ scheme: ['minecord'], appLink: false }]);
  assert.deepEqual(tauri.plugins['deep-link'].desktop.schemes, ['minecord']);
  const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.match(rust, /tauri_plugin_deep_link::init\(\)/);
  assert.match(rust, /tauri_plugin_opener::init\(\)/);
  assert.match(rust, /tauri_plugin_single_instance::init/);
  assert.equal(tauri.app.withGlobalTauri, true);
});

test('native auth keeps its deep link code short-lived, single use, and PKCE-bound', () => {
  const accountLinks = fs.readFileSync(path.join(root, 'server', 'account-links.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  const database = fs.readFileSync(path.join(root, 'server', 'database.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'public', 'native-oauth.js'), 'utf8');
  assert.match(accountLinks, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(accountLinks, /Date\.now\(\) \+ 60 \* 1000/);
  assert.match(server, /\/api\/auth\/native\/exchange/);
  assert.match(database, /consumeNativeAuthHandoff/);
  assert.match(frontend, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(frontend, /minecord:\/\/|protocol !== 'minecord:'/);
});

test('Tauri packaging does not bundle a local account database or Node backend', () => {
  assert.equal(tauri.bundle.resources, undefined);
  const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
  assert.doesNotMatch(rust, /DATABASE_URL|minecord\.sqlite|server\.js|Command::new/);
});

test('generated Android package identity and version match the Tauri project', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const androidRoot = path.join(root, 'src-tauri', 'gen', 'android');
  const androidGradle = fs.readFileSync(path.join(androidRoot, 'app', 'build.gradle.kts'), 'utf8');

  assert.match(androidGradle, new RegExp(`applicationId\\s*=\\s*"${tauri.identifier}"`));
  assert.match(androidGradle, new RegExp(`versionName\\s*=\\s*"${packageJson.version}"`));
  assert.match(androidGradle, new RegExp(`versionCode\\s*=\\s*${tauri.bundle.android.versionCode}\\b`));
  assert.equal(fs.existsSync(path.join(androidRoot, 'app', 'build.gradle')), false);
  assert.equal(fs.existsSync(path.join(androidRoot, 'build.gradle.kts')), true);
  assert.equal(fs.existsSync(path.join(androidRoot, 'build.gradle')), false);
  assert.equal(fs.existsSync(path.join(androidRoot, 'settings.gradle')), true);
});

test('Android Gradle Kotlin DSL retains the configured SDK, toolchain, dependencies, and signing', () => {
  const rootGradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'build.gradle.kts'), 'utf8');
  const appGradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts'), 'utf8');
  const tauriBuildGradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'tauri.build.gradle.kts'), 'utf8');
  const tauriSettingsGradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'tauri.settings.gradle'), 'utf8');
  const settingsGradle = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'settings.gradle'), 'utf8');
  const gradleProperties = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'gradle.properties'), 'utf8');
  const wrapper = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');

  assert.match(rootGradle, /com\.android\.application.*8\.5\.2/);
  assert.match(rootGradle, /org\.jetbrains\.kotlin\.android.*1\.9\.24/);
  assert.match(appGradle, /compileSdk\s*=\s*34/);
  assert.match(appGradle, /targetSdk\s*=\s*34/);
  assert.match(appGradle, /minSdk\s*=\s*24/);
  assert.match(appGradle, /ndkVersion\s*=\s*"27\.0\.12077973"/);
  assert.match(appGradle, /sourceCompatibility\s*=\s*JavaVersion\.VERSION_17/);
  assert.match(appGradle, /targetCompatibility\s*=\s*JavaVersion\.VERSION_17/);
  assert.match(appGradle, /jvmTarget\s*=\s*"17"/);
  assert.match(appGradle, /MINECORD_ANDROID_KEYSTORE_PATH/);
  assert.doesNotMatch(appGradle, /file\("debug\.keystore"\)/);
  assert.match(appGradle, /signingConfigs\.getByName\("release"\)/);
  for (const dependency of [
    'androidx.core:core-ktx:1.13.1',
    'androidx.appcompat:appcompat:1.7.0',
    'androidx.webkit:webkit:1.12.0'
  ]) {
    assert.ok(appGradle.includes(dependency), `Missing Android dependency ${dependency}`);
  }
  assert.doesNotMatch(appGradle, /com\.tauri:tauri-android|slf4j-android/);
  assert.match(appGradle, /apply\(from\s*=\s*"tauri\.build\.gradle\.kts"\)/);
  assert.match(settingsGradle, /apply from:\s*"tauri\.settings\.gradle"/);
  assert.match(tauriBuildGradle, /implementation\(project\(":tauri-android"\)\)/);
  assert.match(tauriSettingsGradle, /include ':tauri-android'/);
  assert.match(gradleProperties, /android\.useAndroidX=true/);
  assert.match(wrapper, /gradle-8\.7-bin\.zip/);
});

test('Android manifest grants the WebView network and call-media permissions', () => {
  const manifest = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const networkSecurity = fs.readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'), 'utf8');

  for (const permission of ['INTERNET', 'CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
    assert.match(manifest, new RegExp(`android\\.permission\\.${permission}`));
  }
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(networkSecurity, /minecord-8vg2\.onrender\.com/);
  assert.match(networkSecurity, /cleartextTrafficPermitted="false"/);
});

test('Android CI builds the checked-in native project without regenerating it', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'tauri-build.yml'), 'utf8');

  assert.match(workflow, /Verify checked-in Android project/);
  assert.doesNotMatch(workflow, /rm -rf src-tauri\/gen\/android/);
  assert.doesNotMatch(workflow, /tauri -- android init/);
});

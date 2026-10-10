const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveUpdaterConfig } = require('../scripts/tauri-updater-config');

test('release updater defaults to disabled without signing configuration', () => {
  const result = resolveUpdaterConfig({});
  assert.equal(result.enabled, false);
  assert.equal(result.config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(result.config.plugins.updater, { pubkey: '', endpoints: [] });
});

test('release updater requires all signing and endpoint settings together', () => {
  assert.throws(() => resolveUpdaterConfig({
    MINECORD_UPDATER_PUBKEY: 'configured-public-key'
  }), /configure .* together/);
});

test('release updater accepts only HTTPS endpoints when fully configured', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'minecord-updater-test-'));
  const signingKeyPath = path.join(temporaryDirectory, 'test-key');
  fs.writeFileSync(signingKeyPath, '');
  const settings = {
    MINECORD_UPDATER_PUBKEY: 'configured-public-key',
    TAURI_SIGNING_PRIVATE_KEY: signingKeyPath,
    MINECORD_UPDATER_ENDPOINT: 'https://updates.example.invalid/minecord/latest.json'
  };
  try {
    const result = resolveUpdaterConfig(settings);
    assert.equal(result.enabled, true);
    assert.deepEqual(result.config.plugins.updater.endpoints, [settings.MINECORD_UPDATER_ENDPOINT]);
    assert.equal(result.config.bundle.createUpdaterArtifacts, true);
    assert.throws(() => resolveUpdaterConfig({
      ...settings,
      MINECORD_UPDATER_ENDPOINT: 'http://updates.example.invalid/latest.json'
    }), /HTTPS URL/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

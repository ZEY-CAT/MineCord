const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveUpdaterConfig } = require('./tauri-updater-config');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');
const configPath = path.join(output, 'tauri.release.conf.json');

fs.mkdirSync(output, { recursive: true });

const updater = resolveUpdaterConfig();
fs.writeFileSync(configPath, JSON.stringify(updater.config, null, 2));
console.log(updater.enabled
  ? 'Building with signed automatic updates enabled for the configured HTTPS endpoint.'
  : 'Building with automatic updates disabled; no updater key or endpoint is configured.');

const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(process.execPath, [cli, 'build', '--bundles', 'nsis', '--config', configPath], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MINECORD_UPDATER_ENABLED: updater.enabled ? '1' : '0' }
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;

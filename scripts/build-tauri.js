const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveUpdaterConfig } = require('./tauri-updater-config');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');
const configPath = path.join(output, 'tauri.release.conf.json');
const mainConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');

// Forward CLI arguments passed after this script's own arguments.
// Example: npm run tauri:build -- --bundles dmg,app
const args = process.argv.slice(2);

fs.mkdirSync(output, { recursive: true });

const updater = resolveUpdaterConfig();
fs.writeFileSync(configPath, JSON.stringify(updater.config, null, 2));

console.log(updater.enabled
  ? 'Building with signed automatic updates enabled for the configured HTTPS endpoint.'
  : 'Building with automatic updates disabled; no updater key or endpoint is configured.');

const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

// Pass both the main config (for targets, bundle settings) and the updater config (for signing)
// Tauri CLI merges configs in order, so main config first, then updater config overrides
const result = spawnSync(
  process.execPath,
  [cli, 'build', ...args, '--config', mainConfigPath, '--config', configPath],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MINECORD_UPDATER_ENABLED: updater.enabled ? '1' : '0'
    }
  }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
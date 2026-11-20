const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Electron uses the separately installed updater and does not bundle the DLL', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const resources = packageJson.build?.extraResources || [];
  const bundlesUpdater = resources.some(resource =>
    `${resource.from || ''} ${resource.to || ''}`.toLowerCase().includes('minecordupdater.dll')
  );
  const bridge = fs.readFileSync(path.join(root, 'desktop', 'updater-bridge.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'updater-dll-build.yml'), 'utf8');

  assert.equal(bundlesUpdater, false);
  assert.match(bridge, /ProgramFiles/);
  assert.match(bridge, /process\.resourcesPath/);
  assert.match(workflow, /Verify NO DLL in output/);
});

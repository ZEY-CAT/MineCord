const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

test('protected local legacy data is ignored and absent from the Git index', () => {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'server/data.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  assert.notEqual(tracked.status, 0, 'server/data.json must never be tracked in the current tree');

  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', 'server/data.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  assert.equal(ignored.status, 0, 'server/data.json must remain ignored even after it is untracked');
});

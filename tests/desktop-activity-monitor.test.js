const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../desktop/activity-monitor.js'), 'utf8');

test('desktop presence clears a game after an in-flight active report settles', async () => {
  const module = { exports: {} };
  const reports = [];
  let acknowledge;
  const activeReport = new Promise(resolve => { acknowledge = resolve; });
  let reportStarted;
  const started = new Promise(resolve => { reportStarted = resolve; });
  vm.runInNewContext(source, {
    module,
    require: name => ({
      id: name.includes('java') ? 'java' : 'bedrock',
      detect: async () => true
    }),
    setTimeout: () => assert.fail('monitor must not schedule after shutdown'),
    clearTimeout() {},
    console
  });

  const stop = module.exports.startActivityMonitor(async ({ game, active }) => {
    reports.push([game, active]);
    if (active) {
      reportStarted();
      await activeReport;
    }
  });
  await started;
  const cleanup = stop();
  assert.equal(stop(), cleanup);
  assert.deepEqual(reports, [['java', true]]);
  acknowledge();
  await cleanup;
  assert.deepEqual(reports, [['java', true], ['java', false]]);
});

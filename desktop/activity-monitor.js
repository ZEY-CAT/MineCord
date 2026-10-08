const detectors = [
  require('./detectors/java'),
  require('./detectors/bedrock')
];

const POLL_MS = 5000;
const HEARTBEAT_MS = 15000;

function startActivityMonitor(report, onError = console.error) {
  const states = new Map();
  let stopped = false;
  let timer = null;

  async function poll() {
    if (stopped) return;
    for (const detector of detectors) {
      try {
        const active = await detector.detect();
        const previous = states.get(detector.id);
        const now = Date.now();
        if (previous === undefined || previous.active !== active || (active && now - previous.reportedAt >= HEARTBEAT_MS)) {
          await report({ game: detector.id, active });
          states.set(detector.id, { active, reportedAt: now });
        }
      } catch (error) {
        onError(`${detector.id} activity detection failed: ${error.message}`);
      }
    }
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }

  poll();
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const [game, state] of states) {
      if (!state.active) continue;
      try {
        await report({ game, active: false });
      } catch (error) {
        onError(`${game} activity cleanup failed: ${error.message}`);
      }
    }
  };
}

module.exports = { startActivityMonitor };

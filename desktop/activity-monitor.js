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
  let polling;
  let cleanup;

  async function poll() {
    if (stopped) return;
    for (const detector of detectors) {
      if (stopped) return;
      try {
        const active = await detector.detect();
        if (stopped) return;
        const previous = states.get(detector.id);
        const now = Date.now();
        if (previous === undefined || previous.active !== active || (active && now - previous.reportedAt >= HEARTBEAT_MS)) {
          const reported = await report({ game: detector.id, active });
          if (reported === false) continue;
          states.set(detector.id, { active, reportedAt: now });
        }
      } catch (error) {
        onError(`${detector.id} activity detection failed: ${error.message}`);
      }
    }
    if (!stopped) timer = setTimeout(startPoll, POLL_MS);
  }

  function startPoll() {
    polling = poll();
  }

  startPoll();
  return function stop() {
    if (cleanup) return cleanup;
    stopped = true;
    clearTimeout(timer);
    cleanup = polling.then(async () => {
      const activeGames = [...states].filter(([, state]) => state.active);
      await Promise.all(activeGames.map(async ([game]) => {
        try {
          await report({ game, active: false });
        } catch (error) {
          onError(`${game} activity cleanup failed: ${error.message}`);
        }
      }));
    });
    return cleanup;
  };
}

module.exports = { startActivityMonitor };

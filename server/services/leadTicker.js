// STUB — owner: Ali. 2-second ticker: escalations (SKIP LOCKED + version check) and notification sends/retries.
// server/index.js calls start() once after initDb(). Keep start/stop exports.
let timer = null;

function start() {
  if (timer) return;
  console.log('[leadTicker] STUB started (no-op until Ali implements it)');
  timer = setInterval(() => {}, 2000);
  timer.unref?.();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop };

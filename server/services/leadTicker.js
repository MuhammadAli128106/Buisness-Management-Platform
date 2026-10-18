'use strict';
/**
 * Lead ticker (F3.4/F3.5/Q5) — owner: Ali.
 * One setInterval for the whole server (never a setTimeout per lead). Deadlines live in the DB,
 * so a restart just resumes on the next tick; row locks + version checks make it safe even if
 * two server instances tick at the same time.
 * Started once by Musa in server/index.js after initDb(): require('./services/leadTicker').start()
 */
const leadEngine = require('./leadEngine');
const notify = require('./notify');

const INTERVAL_MS = 2000;
let timer = null;
let running = false;

async function tick() {
  if (running) return; // a slow pass never overlaps the next one
  running = true;
  try {
    try {
      await leadEngine.escalateDue(20);
    } catch (err) {
      console.error('[leadTicker] escalation pass failed:', err.message);
    }
    try {
      await notify.sendPending(20);
    } catch (err) {
      console.error('[leadTicker] notification pass failed:', err.message);
    }
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[leadTicker] started (every ${INTERVAL_MS / 1000}s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };

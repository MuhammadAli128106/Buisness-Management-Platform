// Vercel serverless entry — owner: Musa. Wraps the same Express app as server/index.js.
// Serverless functions have no background process, so the lead ticker (escalations + alert retries)
// runs at most every 2 s on incoming requests. Deadlines live in Postgres, so nothing is lost between
// requests: the app polls every 3 s while anyone has it open, and Telegram webhooks also tick it.
const { initDb } = require('../server/db/index');
const app = require('../server/app');
const leadTicker = require('../server/services/leadTicker');

let ready = null;
let lastTick = 0;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

module.exports = async (req, res) => {
  try {
    if (!ready) ready = initDb().catch((e) => { ready = null; throw e; });
    await ready;
  } catch (e) {
    console.error('[vercel] db init failed', e.message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'The database is not reachable right now. Try again in a moment.' }));
  }
  if (Date.now() - lastTick > 2000) {
    lastTick = Date.now();
    await Promise.race([leadTicker.tick().catch((e) => console.error('[tick]', e.message)), sleep(1500)]);
  }
  return app(req, res);
};

// server/index.js — owner: Musa. Long-running entry (local dev). Routes live in app.js.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initDb } = require('./db/index');
const app = require('./app');

const PORT = process.env.PORT || 8080;
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] Listening on port ${PORT}`);
      require('./services/leadTicker').start();
    });
  })
  .catch((err) => {
    console.error('[startup] database init failed:', err.message);
    process.exit(1);
  });

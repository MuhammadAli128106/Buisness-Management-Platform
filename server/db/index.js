// server/db/index.js — pg pool + query helpers (adapted from RSFM).
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

types.setTypeParser(20, (v) => parseInt(v, 10));   // int8/bigint -> number
types.setTypeParser(1700, (v) => parseFloat(v));    // numeric -> number

function resolveSsl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.railway.internal')) return false;
  } catch { return false; }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(process.env.DATABASE_URL),
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => console.error('[pg] idle client error', err.message));

/** SELECT → first row | undefined */
async function queryOne(sql, params = []) { return (await pool.query(sql, params)).rows[0]; }
/** SELECT → rows[] */
async function queryAll(sql, params = []) { return (await pool.query(sql, params)).rows; }
/** INSERT/UPDATE/DELETE → raw pg result */
async function queryRun(sql, params = []) { return pool.query(sql, params); }
/** INSERT ... RETURNING * → first row */
async function queryInsert(sql, params = []) { return (await pool.query(sql, params)).rows[0]; }

/** Run cb(client) inside BEGIN/COMMIT; ROLLBACK on throw. */
async function withTransaction(cb) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Use the transaction client when given, else the pool. */
function q(client) { return client || pool; }

/** Applies schema.sql then db/patches/*.sql (alphabetical). Idempotent. */
async function initDb() {
  console.log('[db] connecting…');
  await pool.query('SELECT 1');
  // advisory lock so several servers booting at once don't race the DDL
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(4242)');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const dir = path.join(__dirname, 'patches');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(dir, f), 'utf8');
        if (sql.replace(/--.*$/gm, '').trim()) await client.query(sql);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(4242)').catch(() => {});
    client.release();
  }
  console.log('[db] schema ready');
}

module.exports = { pool, q, queryOne, queryAll, queryRun, queryInsert, withTransaction, initDb };

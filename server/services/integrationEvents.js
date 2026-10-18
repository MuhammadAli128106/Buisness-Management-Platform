// Synchronisation history (I5.4). EVERY inbound webhook and outbound provider call records one row.
const { q } = require('../db/index');

async function recordEvent({ ws = null, provider, direction, kind, external_id = null, status, http_status = null, error = null, detail = {} }, client) {
  try {
    const r = await q(client).query(
      `INSERT INTO integration_events (workspace_id, provider, direction, kind, external_id, status, http_status, error, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [ws, provider, direction, kind, external_id, status, http_status, error ? String(error).slice(0, 1000) : null, JSON.stringify(detail || {})],
    );
    return r.rows[0];
  } catch (e) {
    console.error('[integrationEvents]', e.message);
    return null;
  }
}
module.exports = { recordEvent };

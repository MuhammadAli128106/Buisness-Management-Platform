// Per-record timeline entries (F2.7). Types: note stage_change field_edit assignment lead_created
// acknowledged escalation message_in message_out payment appointment
const { q } = require('../db/index');

async function logActivity({ ws, contact_id = null, opportunity_id = null, lead_id = null, type, actor_id = null, summary, data = {} }, client) {
  const sql = `INSERT INTO activities (workspace_id, contact_id, opportunity_id, lead_id, type, actor_id, summary, data)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
  const params = [ws, contact_id, opportunity_id, lead_id, type, actor_id, summary, JSON.stringify(data || {})];
  if (client) return (await client.query(sql, params)).rows[0];
  try { return (await q().query(sql, params)).rows[0]; } catch (e) { console.error('[activity]', e.message); return null; }
}
module.exports = { logActivity };

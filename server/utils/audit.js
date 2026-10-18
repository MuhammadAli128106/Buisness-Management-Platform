// Append-only audit log (F4). The table has a trigger that refuses UPDATE/DELETE.
const { q } = require('../db/index');

/**
 * audit(reqOrNull, { ws, event_type, target_type, target_id, before, after }, client?)
 * reqOrNull = null → actor "System". ws defaults to req.user.ws.
 * Never throws for the caller unless inside a transaction (so the transaction rolls back consistently).
 */
async function audit(req, { ws, event_type, target_type = null, target_id = null, before = null, after = null }, client) {
  const workspace = ws || req?.user?.ws;
  const params = [
    workspace, req?.user?.id || null, req?.user?.name || 'System', event_type, target_type,
    target_id != null ? String(target_id) : null,
    before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null,
    req?.ip || null,
  ];
  const sql = `INSERT INTO audit_log (workspace_id, actor_id, actor_name, event_type, target_type, target_id, before, after, ip)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
  if (client) return client.query(sql, params);
  try { await q().query(sql, params); } catch (e) { console.error('[audit]', e.message); }
}

/** Shallow diff helper: returns {before, after} with only changed keys. */
function diff(before, after, keys) {
  const b = {}; const a = {};
  for (const k of keys || Object.keys(after || {})) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) { b[k] = before?.[k] ?? null; a[k] = after?.[k] ?? null; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

module.exports = { audit, diff };

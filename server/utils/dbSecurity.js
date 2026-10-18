// Helpers used across routes for workspace-scoped lookups (F1.6 / Q2).
const { q } = require('../db/index');
const { httpError } = require('../middleware/errorHandler');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Fetch one row of `table` by id scoped to ws; throws 404 if missing / other workspace / soft-deleted. */
async function findScoped(table, id, ws, { client, softDelete = true, columns = '*' } = {}) {
  if (!isUuid(id)) throw httpError(404, 'Not found');
  const res = await q(client).query(
    `SELECT ${columns} FROM ${table} WHERE id = $1 AND workspace_id = $2 ${softDelete ? 'AND deleted_at IS NULL' : ''}`,
    [id, ws],
  );
  if (!res.rows[0]) throw httpError(404, 'Not found');
  return res.rows[0];
}

/** Asserts an optional foreign id belongs to ws (e.g. company_id on a contact). */
async function assertInWorkspace(table, id, ws, client, softDelete = true) {
  if (id == null) return;
  await findScoped(table, id, ws, { client, softDelete, columns: 'id' }).catch(() => {
    throw httpError(400, `Invalid ${table.replace(/s$/, '')} reference`);
  });
}

module.exports = { isUuid, findScoped, assertInWorkspace };

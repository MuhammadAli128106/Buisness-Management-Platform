// Shared CRM logic — owner: Musa. List filtering (F2.6), custom-field validation (F2.2/F2.3),
// stage requirements (F2.4) and optimistic locking (Q4). Used by routes AND export so lists == exports.
const { q } = require('../db/index');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');

const ENTITIES = {
  contact: {
    table: 'contacts',
    select: `c.*, co.name AS company_name, u.name AS owner_name`,
    joins: `LEFT JOIN companies co ON co.id = c.company_id AND co.deleted_at IS NULL LEFT JOIN users u ON u.id = c.owner_id`,
    search: ['c.name', 'c.email', 'c.phone', 'co.name'],
    idFilters: ['owner_id', 'company_id'],
    sorts: { created_at: 'c.created_at', updated_at: 'c.updated_at', name: 'c.name' },
  },
  company: {
    table: 'companies',
    select: `c.*, u.name AS owner_name,
      (SELECT count(*) FROM contacts x WHERE x.company_id = c.id AND x.deleted_at IS NULL)::int AS contact_count`,
    joins: `LEFT JOIN users u ON u.id = c.owner_id`,
    search: ['c.name', 'c.domain'],
    idFilters: ['owner_id'],
    sorts: { created_at: 'c.created_at', updated_at: 'c.updated_at', name: 'c.name' },
  },
  opportunity: {
    table: 'opportunities',
    select: `c.*, ct.name AS contact_name, s.name AS stage_name, s.kind AS stage_kind, s.position AS stage_position,
      p.name AS pipeline_name, u.name AS owner_name`,
    joins: `JOIN contacts ct ON ct.id = c.contact_id JOIN stages s ON s.id = c.stage_id
      JOIN pipelines p ON p.id = c.pipeline_id LEFT JOIN users u ON u.id = c.owner_id`,
    search: ['c.title', 'ct.name'],
    idFilters: ['owner_id', 'pipeline_id', 'stage_id', 'contact_id'],
    sorts: { created_at: 'c.created_at', updated_at: 'c.updated_at', title: 'c.title', value_cents: 'c.value_cents' },
  },
};

async function customDefs(ws, entity, pipelineId, client) {
  const params = [ws, entity];
  let extra = '';
  if (entity === 'opportunity' && pipelineId) { params.push(pipelineId); extra = 'AND (pipeline_id IS NULL OR pipeline_id = $3)'; }
  return (await q(client).query(
    `SELECT * FROM custom_fields WHERE workspace_id = $1 AND entity = $2 ${extra} ORDER BY position, created_at`, params,
  )).rows;
}

/**
 * Build WHERE for list endpoints. Supported query params:
 * q, tag, owner_id, company_id, pipeline_id, stage_id, contact_id, stage_kind, from, to (YYYY-MM-DD on created_at),
 * field.<key>=value (custom field; text = contains, others = equals).
 */
async function buildWhere(entity, query, ws, client) {
  const cfg = ENTITIES[entity];
  const where = ['c.workspace_id = $1', 'c.deleted_at IS NULL'];
  const params = [ws];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (query.q) {
    params.push(`%${String(query.q).slice(0, 100)}%`);
    where.push(`(${cfg.search.map((s) => `${s} ILIKE $${params.length}`).join(' OR ')})`);
  }
  for (const f of cfg.idFilters) {
    if (query[f] === 'none') where.push(`c.${f} IS NULL`);
    else if (query[f]) { if (!isUuid(query[f])) throw httpError(400, `Invalid ${f}`); add(`c.${f} = ?`, query[f]); }
  }
  if (entity === 'contact' && query.tag) add('? = ANY(c.tags)', String(query.tag).toLowerCase());
  if (entity === 'opportunity' && query.stage_kind) add('s.kind = ?', query.stage_kind);
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) add('c.created_at >= ?::date', query.from);
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) add(`c.created_at < (?::date + interval '1 day')`, query.to);

  const fieldKeys = Object.keys(query).filter((k) => k.startsWith('field.') && query[k] !== '');
  if (fieldKeys.length) {
    const defs = await customDefs(ws, entity, null, client);
    for (const k of fieldKeys) {
      const key = k.slice(6);
      const def = defs.find((d) => d.key === key); // whitelist: unknown keys are ignored, never interpolated
      if (!def) continue;
      params.push(key);
      const keyParam = `$${params.length}`;
      if (def.type === 'text') { params.push(`%${query[k]}%`); where.push(`c.custom->>${keyParam} ILIKE $${params.length}`); } else { params.push(String(query[k])); where.push(`c.custom->>${keyParam} = $${params.length}`); }
    }
  }
  return { where: where.join(' AND '), params };
}

/** → { rows, total, page, limit } */
async function list(entity, query, ws, { client, paginate = true } = {}) {
  const cfg = ENTITIES[entity];
  const { where, params } = await buildWhere(entity, query, ws, client);
  const limit = paginate ? Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100) : 5000;
  const page = paginate ? Math.max(parseInt(query.page, 10) || 1, 1) : 1;
  const sortCol = cfg.sorts[query.sort] || cfg.sorts.created_at;
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const base = `FROM ${cfg.table} c ${cfg.joins} WHERE ${where}`;
  const [rows, count] = await Promise.all([
    q(client).query(`SELECT ${cfg.select} ${base} ORDER BY ${sortCol} ${dir}, c.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
    q(client).query(`SELECT count(*)::int AS n ${base}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].n, page, limit };
}

async function getOne(entity, id, ws, client) {
  if (!isUuid(id)) throw httpError(404, 'Not found');
  const cfg = ENTITIES[entity];
  const r = await q(client).query(`SELECT ${cfg.select} FROM ${cfg.table} c ${cfg.joins} WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL`, [id, ws]);
  if (!r.rows[0]) throw httpError(404, 'Not found');
  return r.rows[0];
}

/** Validates & normalises a custom-values object against the field definitions. Unknown keys are dropped. */
async function cleanCustom(ws, entity, pipelineId, custom, existing = {}, client) {
  if (custom === undefined) return existing;
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) throw httpError(400, 'Invalid custom fields');
  const defs = await customDefs(ws, entity, pipelineId, client);
  const out = { ...existing };
  const errors = {};
  for (const [key, raw] of Object.entries(custom)) {
    const def = defs.find((d) => d.key === key);
    if (!def) continue;
    if (raw === null || raw === '' || raw === undefined) { delete out[key]; continue; }
    switch (def.type) {
      case 'number': { const n = Number(raw); if (!Number.isFinite(n)) errors[`custom.${key}`] = `${def.label} must be a number`; else out[key] = n; break; }
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || Number.isNaN(Date.parse(raw))) errors[`custom.${key}`] = `${def.label} must be a date`; else out[key] = String(raw); break;
      case 'checkbox': out[key] = raw === true || raw === 'true'; break;
      case 'dropdown': if (!def.options.includes(String(raw))) errors[`custom.${key}`] = `${def.label} must be one of: ${def.options.join(', ')}`; else out[key] = String(raw); break;
      default: out[key] = String(raw).slice(0, 2000);
    }
  }
  if (Object.keys(errors).length) throw httpError(400, 'Some custom fields are invalid', errors);
  return out;
}

const isFilled = (v) => !(v === undefined || v === null || v === '' || v === false);

/** F2.4: returns [{key,label}] of required fields still empty for moving `opp` into `stage`. */
async function missingForStage(ws, stage, opp, client) {
  const keys = stage.required_field_keys || [];
  if (!keys.length) return [];
  const defs = await customDefs(ws, 'opportunity', opp.pipeline_id, client);
  const missing = [];
  for (const key of keys) {
    if (key === 'value_cents') { if (!(Number(opp.value_cents) > 0)) missing.push({ key, label: 'Value' }); continue; }
    const def = defs.find((d) => d.key === key);
    if (def && !isFilled(opp.custom?.[key])) missing.push({ key, label: def.label });
  }
  return missing;
}

/** Optimistic-lock UPDATE. sets = {col: value}. Throws 409 with current row on version mismatch (Q4). */
async function updateVersioned(table, id, ws, version, sets, client) {
  if (!Number.isInteger(version)) throw httpError(400, 'version is required', { version: 'Reload the record and try again' });
  const cols = Object.keys(sets);
  const assign = cols.map((c, i) => `${c} = $${i + 4}`).join(', ');
  const r = await q(client).query(
    `UPDATE ${table} SET ${assign}${cols.length ? ',' : ''} version = version + 1, updated_at = now()
      WHERE id = $1 AND workspace_id = $2 AND version = $3 AND deleted_at IS NULL RETURNING *`,
    [id, ws, version, ...cols.map((c) => sets[c])],
  );
  if (r.rows[0]) return r.rows[0];
  const current = (await q(client).query(`SELECT * FROM ${table} WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [id, ws])).rows[0];
  if (!current) throw httpError(404, 'Not found');
  const e = httpError(409, 'Someone else changed this record. Reload and try again.');
  e.extra = { current };
  throw e;
}

module.exports = { ENTITIES, customDefs, buildWhere, list, getOne, cleanCustom, missingForStage, updateVersioned, isFilled };

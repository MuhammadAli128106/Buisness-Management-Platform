// Saved lists (F2.6) — owner: Musa. A list stores filter params; opening it re-runs them, so it always auto-updates.
const express = require('express');
const { z } = require('zod');
const { q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');

const router = express.Router();
const ALLOWED = /^(q|tag|owner_id|company_id|pipeline_id|stage_id|stage_kind|contact_id|from|to|sort|dir|field\.[a-z0-9_]+)$/;

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const params = [req.user.ws, req.user.id];
    let extra = '';
    if (req.query.entity) { params.push(req.query.entity); extra = 'AND entity = $3'; }
    res.json({ data: (await q().query(`SELECT * FROM saved_lists WHERE workspace_id = $1 AND user_id = $2 ${extra} ORDER BY created_at DESC`, params)).rows });
  } catch (e) { next(e); }
});

router.post('/', requirePerm('crm.view'), validate({
  body: z.object({
    entity: z.enum(['contact', 'company', 'opportunity']),
    name: z.string().trim().min(1, 'Name is required').max(80),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }),
}), async (req, res, next) => {
  try {
    const filters = Object.fromEntries(Object.entries(req.body.filters).filter(([k, v]) => ALLOWED.test(k) && v !== '' && v !== null).map(([k, v]) => [k, String(v).slice(0, 200)]));
    if (!Object.keys(filters).length) throw httpError(400, 'Add at least one filter before saving a list');
    const row = (await q().query('INSERT INTO saved_lists (workspace_id, user_id, entity, name, filters) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.ws, req.user.id, req.body.entity, req.body.name, JSON.stringify(filters)])).rows[0];
    res.status(201).json({ data: row });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePerm('crm.view'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const r = await q().query('DELETE FROM saved_lists WHERE id = $1 AND workspace_id = $2 AND user_id = $3', [req.params.id, req.user.ws, req.user.id]);
    if (!r.rowCount) throw httpError(404, 'Not found');
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

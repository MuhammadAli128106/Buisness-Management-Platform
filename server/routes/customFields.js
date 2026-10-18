// Custom fields (F2.2, F2.3) — owner: Musa.
const express = require('express');
const { z } = require('zod');
const { withTransaction, q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { findScoped } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const { fieldKey } = require('../utils/format');
const crm = require('../services/crm');

const router = express.Router();
const RESERVED = new Set(['name', 'email', 'phone', 'title', 'value', 'value_cents', 'tags', 'owner', 'stage', 'id']);

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const { entity, pipeline_id: pid } = req.query;
    if (entity && !['contact', 'company', 'opportunity'].includes(entity)) throw httpError(400, 'Invalid entity');
    if (entity) return res.json({ data: await crm.customDefs(req.user.ws, entity, pid || null) });
    res.json({ data: (await q().query('SELECT * FROM custom_fields WHERE workspace_id = $1 ORDER BY entity, position, created_at', [req.user.ws])).rows });
  } catch (e) { next(e); }
});

router.post('/', requirePerm('pipeline.manage'), validate({
  body: z.object({
    entity: z.enum(['contact', 'company', 'opportunity']),
    pipeline_id: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1, 'Label is required').max(60),
    type: z.enum(['text', 'number', 'date', 'dropdown', 'checkbox']),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  }).refine((b) => b.type !== 'dropdown' || b.options.length > 0, { message: 'Add at least one option', path: ['options'] }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws; const b = req.body;
    if (b.pipeline_id) {
      if (b.entity !== 'opportunity') throw httpError(400, 'Only opportunity fields can be tied to a pipeline');
      await findScoped('pipelines', b.pipeline_id, ws, { softDelete: false }).catch(() => { throw httpError(400, 'Invalid pipeline'); });
    }
    let key = fieldKey(b.label);
    if (RESERVED.has(key)) key = `${key}_custom`;
    const existing = (await q().query('SELECT key FROM custom_fields WHERE workspace_id = $1 AND entity = $2', [ws, b.entity])).rows.map((r) => r.key);
    let k = key; let i = 2;
    while (existing.includes(k)) { k = `${key}_${i}`; i += 1; }
    const pos = existing.length;
    const row = (await q().query(
      `INSERT INTO custom_fields (workspace_id, entity, pipeline_id, key, label, type, options, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ws, b.entity, b.pipeline_id || null, k, b.label, b.type, b.type === 'dropdown' ? [...new Set(b.options)] : [], pos],
    )).rows[0];
    await audit(req, { event_type: 'field.created', target_type: 'custom_field', target_id: row.id, after: { entity: row.entity, label: row.label, type: row.type, pipeline_id: row.pipeline_id } });
    res.status(201).json({ data: row });
  } catch (e) { next(e); }
});

router.patch('/:id', requirePerm('pipeline.manage'), validate({
  body: z.object({ label: z.string().trim().min(1).max(60).optional(), options: z.array(z.string().trim().min(1).max(60)).max(50).optional(), position: z.number().int().min(0).optional() }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await findScoped('custom_fields', req.params.id, ws, { softDelete: false });
    if (req.body.options && before.type !== 'dropdown') throw httpError(400, 'Only dropdown fields have options');
    const row = (await q().query(
      `UPDATE custom_fields SET label = COALESCE($3, label), options = COALESCE($4, options), position = COALESCE($5, position)
        WHERE id = $1 AND workspace_id = $2 RETURNING *`, [before.id, ws, req.body.label ?? null, req.body.options ?? null, req.body.position ?? null],
    )).rows[0];
    await audit(req, { event_type: 'field.updated', target_type: 'custom_field', target_id: row.id,
      before: { label: before.label, options: before.options }, after: { label: row.label, options: row.options } });
    res.json({ data: row });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePerm('pipeline.manage'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const f = await findScoped('custom_fields', req.params.id, ws, { softDelete: false });
    await withTransaction(async (c) => {
      await c.query('DELETE FROM custom_fields WHERE id = $1 AND workspace_id = $2', [f.id, ws]);
      if (f.entity === 'opportunity') await c.query('UPDATE stages SET required_field_keys = array_remove(required_field_keys, $2) WHERE workspace_id = $1', [ws, f.key]);
      await audit(req, { event_type: 'field.deleted', target_type: 'custom_field', target_id: f.id, before: { entity: f.entity, label: f.label, key: f.key, type: f.type } }, c);
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

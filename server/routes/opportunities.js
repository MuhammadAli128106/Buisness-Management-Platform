// Opportunities (F2.1, F2.3, F2.4, F2.5, F1.4) — owner: Musa. Payments for an opportunity live in routes/payments.js.
const express = require('express');
const { z } = require('zod');
const { withTransaction, q } = require('../db/index');
const { requirePerm, hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { assertInWorkspace, findScoped } = require('../utils/dbSecurity');
const { audit, diff } = require('../utils/audit');
const { logActivity } = require('../utils/activity');
const { maskOpp, maskOpps } = require('../utils/mask');
const crm = require('../services/crm');
const leadEngine = require('../services/leadEngine');

const router = express.Router();

async function stageOf(stageId, ws, client) {
  const s = await findScoped('stages', stageId, ws, { client, softDelete: false }).catch(() => { throw httpError(400, 'Invalid stage', { stage_id: 'Pick a stage of this pipeline' }); });
  return s;
}
function blocked(stage, missing) {
  const e = httpError(422, `Fill these fields before moving to ${stage.name}: ${missing.map((m) => m.label).join(', ')}`);
  e.extra = { missing };
  return e;
}

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try { const r = await crm.list('opportunity', req.query, req.user.ws); res.json({ data: maskOpps(r.rows, req), total: r.total, page: r.page, limit: r.limit }); } catch (e) { next(e); }
});
router.get('/:id', requirePerm('crm.view'), async (req, res, next) => {
  try { res.json({ data: maskOpp(await crm.getOne('opportunity', req.params.id, req.user.ws), req) }); } catch (e) { next(e); }
});

router.post('/', requirePerm('crm.create'), validate({
  body: z.object({
    title: z.string().trim().min(1, 'Title is required').max(160),
    contact_id: z.string().uuid('Pick a contact'),
    pipeline_id: z.string().uuid('Pick a pipeline'),
    stage_id: z.string().uuid().optional(),
    value_cents: z.number().int().min(0).max(1e13).optional(),
    currency: z.string().trim().length(3).optional(),
    owner_id: z.string().uuid().nullable().optional(),
    custom: z.record(z.string(), z.any()).optional(),
  }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws; const b = req.body;
    await assertInWorkspace('contacts', b.contact_id, ws);
    await assertInWorkspace('users', b.owner_id, ws, null, false);
    await findScoped('pipelines', b.pipeline_id, ws, { softDelete: false }).catch(() => { throw httpError(400, 'Invalid pipeline'); });
    const stage = b.stage_id ? await stageOf(b.stage_id, ws)
      : (await q().query('SELECT * FROM stages WHERE pipeline_id = $1 AND workspace_id = $2 ORDER BY position LIMIT 1', [b.pipeline_id, ws])).rows[0];
    if (!stage || stage.pipeline_id !== b.pipeline_id) throw httpError(400, 'That stage is not in this pipeline', { stage_id: 'Pick a stage of this pipeline' });
    if (b.value_cents && !hasPerm(req, 'opp.value.view')) throw httpError(403, 'You need the "opp.value.view" permission to set values');
    const custom = await crm.cleanCustom(ws, 'opportunity', b.pipeline_id, b.custom, {});
    const missing = await crm.missingForStage(ws, stage, { pipeline_id: b.pipeline_id, custom, value_cents: b.value_cents });
    if (missing.length) throw blocked(stage, missing);
    const row = await withTransaction(async (c) => {
      const o = (await c.query(
        `INSERT INTO opportunities (workspace_id, contact_id, pipeline_id, stage_id, title, value_cents, currency, owner_id, custom, created_by, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 = 'open' THEN NULL ELSE now() END) RETURNING *`,
        [ws, b.contact_id, b.pipeline_id, stage.id, b.title, b.value_cents || 0, (b.currency || 'USD').toUpperCase(), b.owner_id || req.user.id, JSON.stringify(custom), req.user.id, stage.kind],
      )).rows[0];
      await logActivity({ ws, contact_id: o.contact_id, opportunity_id: o.id, type: 'stage_change', actor_id: req.user.id, summary: `Opportunity "${o.title}" created in ${stage.name}` }, c);
      return o;
    });
    res.status(201).json({ data: maskOpp(await crm.getOne('opportunity', row.id, ws), req) });
  } catch (e) { next(e); }
});

router.patch('/:id', requirePerm('crm.edit'), validate({
  body: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    contact_id: z.string().uuid().optional(),
    value_cents: z.number().int().min(0).max(1e13).optional(),
    currency: z.string().trim().length(3).optional(),
    owner_id: z.string().uuid().nullable().optional(),
    custom: z.record(z.string(), z.any()).optional(),
    version: z.number().int(),
  }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws; const b = req.body;
    const before = await crm.getOne('opportunity', req.params.id, ws);
    if (b.contact_id) await assertInWorkspace('contacts', b.contact_id, ws);
    if (b.owner_id !== undefined) await assertInWorkspace('users', b.owner_id, ws, null, false);
    if (b.value_cents !== undefined && !hasPerm(req, 'opp.value.view')) throw httpError(403, 'You need the "opp.value.view" permission to change values');
    const sets = {};
    for (const k of ['title', 'contact_id', 'value_cents', 'owner_id']) if (b[k] !== undefined) sets[k] = b[k];
    if (b.currency) sets.currency = b.currency.toUpperCase();
    if (b.custom !== undefined) sets.custom = JSON.stringify(await crm.cleanCustom(ws, 'opportunity', before.pipeline_id, b.custom, before.custom));
    const row = await withTransaction(async (c) => {
      const o = await crm.updateVersioned('opportunities', before.id, ws, b.version, sets, c);
      const d = diff(before, o, Object.keys(sets));
      if (d.changed) {
        if (!hasPerm(req, 'opp.value.view')) { delete d.before.value_cents; delete d.after.value_cents; }
        await logActivity({ ws, contact_id: o.contact_id, opportunity_id: o.id, type: 'field_edit', actor_id: req.user.id, summary: `${req.user.name} changed ${Object.keys(sets).map((k) => (k === 'custom' ? 'custom fields' : k.replace(/_cents|_id/g, '').replace(/_/g, ' '))).join(', ')}`, data: d }, c);
      }
      return o;
    });
    res.json({ data: maskOpp(await crm.getOne('opportunity', row.id, ws), req) });
  } catch (e) { next(e); }
});

/** F2.4/F2.5: move between stages; blocked with 422 + missing[] when required fields are empty. */
router.post('/:id/move', requirePerm('crm.edit'), validate({ body: z.object({ stage_id: z.string().uuid(), version: z.number().int() }) }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await crm.getOne('opportunity', req.params.id, ws);
    const stage = await stageOf(req.body.stage_id, ws);
    if (stage.pipeline_id !== before.pipeline_id) throw httpError(400, 'That stage belongs to a different pipeline');
    if (stage.id === before.stage_id) return res.json({ data: maskOpp(before, req) });
    const missing = await crm.missingForStage(ws, stage, before);
    if (missing.length) throw blocked(stage, missing);
    await withTransaction(async (c) => {
      const o = await crm.updateVersioned('opportunities', before.id, ws, req.body.version,
        { stage_id: stage.id, closed_at: stage.kind === 'open' ? null : new Date() }, c);
      await logActivity({ ws, contact_id: o.contact_id, opportunity_id: o.id, type: 'stage_change', actor_id: req.user.id,
        summary: `${req.user.name} moved "${o.title}" from ${before.stage_name} to ${stage.name}`, data: { from: before.stage_id, to: stage.id } }, c);
      await leadEngine.recordAction({ ws, contactId: o.contact_id, userId: req.user.id, kind: 'stage', client: c });
    });
    res.json({ data: maskOpp(await crm.getOne('opportunity', before.id, ws), req) });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePerm('crm.delete'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await crm.getOne('opportunity', req.params.id, ws);
    await withTransaction(async (c) => {
      await c.query('UPDATE opportunities SET deleted_at = now() WHERE id = $1 AND workspace_id = $2', [before.id, ws]);
      await audit(req, { event_type: 'record.deleted', target_type: 'opportunity', target_id: before.id, before: { title: before.title, contact_id: before.contact_id } }, c);
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

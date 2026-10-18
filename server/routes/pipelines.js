// Pipelines & stages (F2.5, F2.4 config) — owner: Musa. Mounted at /api/v1 → defines /pipelines… and /stages…
const express = require('express');
const { z } = require('zod');
const { withTransaction, q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { findScoped, isUuid } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const { logActivity } = require('../utils/activity');

const router = express.Router();
const keysSchema = z.array(z.string().trim().min(1).max(60)).max(30);

async function pipelinesWithStages(ws, onlyId) {
  const pipes = (await q().query(`SELECT * FROM pipelines WHERE workspace_id = $1 ${onlyId ? 'AND id = $2' : ''} ORDER BY position, created_at`, onlyId ? [ws, onlyId] : [ws])).rows;
  const stages = (await q().query(
    `SELECT s.*, (SELECT count(*) FROM opportunities o WHERE o.stage_id = s.id AND o.deleted_at IS NULL)::int AS opportunity_count
       FROM stages s WHERE s.workspace_id = $1 ORDER BY s.position`, [ws],
  )).rows;
  return pipes.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline_id === p.id) }));
}
async function validRequiredKeys(ws, pipelineId, keys, client) {
  if (!keys?.length) return [];
  const defs = (await q(client).query(
    `SELECT key FROM custom_fields WHERE workspace_id = $1 AND entity = 'opportunity' AND (pipeline_id IS NULL OR pipeline_id = $2)`, [ws, pipelineId],
  )).rows.map((r) => r.key);
  const bad = keys.filter((k) => k !== 'value_cents' && !defs.includes(k));
  if (bad.length) throw httpError(400, `Unknown fields for this pipeline: ${bad.join(', ')}`);
  return [...new Set(keys)];
}

router.get('/pipelines', requirePerm('crm.view'), async (req, res, next) => {
  try { res.json({ data: await pipelinesWithStages(req.user.ws) }); } catch (e) { next(e); }
});
router.get('/pipelines/:id', requirePerm('crm.view'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const [p] = await pipelinesWithStages(req.user.ws, req.params.id);
    if (!p) throw httpError(404, 'Not found');
    res.json({ data: p });
  } catch (e) { next(e); }
});

router.post('/pipelines', requirePerm('pipeline.manage'), validate({ body: z.object({ name: z.string().trim().min(1, 'Name is required').max(80) }) }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const p = await withTransaction(async (c) => {
      const pos = (await c.query('SELECT COALESCE(max(position), -1) + 1 AS n FROM pipelines WHERE workspace_id = $1', [ws])).rows[0].n;
      const pipe = (await c.query('INSERT INTO pipelines (workspace_id, name, position) VALUES ($1,$2,$3) RETURNING *', [ws, req.body.name, pos])).rows[0];
      for (const [i, [n, k]] of [['New', 'open'], ['In progress', 'open'], ['Won', 'won'], ['Lost', 'lost']].entries()) {
        await c.query('INSERT INTO stages (workspace_id, pipeline_id, name, position, kind) VALUES ($1,$2,$3,$4,$5)', [ws, pipe.id, n, i, k]);
      }
      await audit(req, { event_type: 'pipeline.created', target_type: 'pipeline', target_id: pipe.id, after: { name: pipe.name } }, c);
      return pipe;
    });
    res.status(201).json({ data: (await pipelinesWithStages(ws, p.id))[0] });
  } catch (e) { next(e); }
});

router.patch('/pipelines/:id', requirePerm('pipeline.manage'), validate({ body: z.object({ name: z.string().trim().min(1).max(80).optional(), position: z.number().int().min(0).optional() }) }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await findScoped('pipelines', req.params.id, ws, { softDelete: false });
    const p = (await q().query('UPDATE pipelines SET name = COALESCE($3, name), position = COALESCE($4, position) WHERE id = $1 AND workspace_id = $2 RETURNING *',
      [before.id, ws, req.body.name ?? null, req.body.position ?? null])).rows[0];
    await audit(req, { event_type: 'pipeline.updated', target_type: 'pipeline', target_id: p.id, before: { name: before.name }, after: { name: p.name } });
    res.json({ data: p });
  } catch (e) { next(e); }
});

router.delete('/pipelines/:id', requirePerm('pipeline.manage'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const p = await findScoped('pipelines', req.params.id, ws, { softDelete: false });
    const n = (await q().query('SELECT count(*)::int AS n FROM opportunities WHERE pipeline_id = $1 AND deleted_at IS NULL', [p.id])).rows[0].n;
    if (n) throw httpError(409, `This pipeline still has ${n} opportunit${n === 1 ? 'y' : 'ies'}. Move or delete them first.`);
    const total = (await q().query('SELECT count(*)::int AS n FROM pipelines WHERE workspace_id = $1', [ws])).rows[0].n;
    if (total <= 1) throw httpError(409, 'You need at least one pipeline.');
    await withTransaction(async (c) => {
      await c.query('DELETE FROM opportunities WHERE pipeline_id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments WHERE opportunity_id = opportunities.id) AND NOT EXISTS (SELECT 1 FROM leads WHERE opportunity_id = opportunities.id)', [p.id, ws]);
      const leftovers = (await c.query('SELECT count(*)::int AS n FROM opportunities WHERE pipeline_id = $1', [p.id])).rows[0].n;
      if (leftovers) throw httpError(409, 'This pipeline has archived opportunities with payments or leads attached, so it cannot be deleted. Rename it instead.');
      await c.query('DELETE FROM custom_fields WHERE pipeline_id = $1 AND workspace_id = $2', [p.id, ws]);
      await c.query('DELETE FROM stages WHERE pipeline_id = $1 AND workspace_id = $2', [p.id, ws]);
      await c.query('DELETE FROM pipelines WHERE id = $1 AND workspace_id = $2', [p.id, ws]);
      await audit(req, { event_type: 'pipeline.deleted', target_type: 'pipeline', target_id: p.id, before: { name: p.name } }, c);
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.post('/pipelines/:id/stages', requirePerm('pipeline.manage'), validate({
  body: z.object({ name: z.string().trim().min(1, 'Name is required').max(60), kind: z.enum(['open', 'won', 'lost']).default('open'), required_field_keys: keysSchema.default([]) }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const p = await findScoped('pipelines', req.params.id, ws, { softDelete: false });
    const keys = await validRequiredKeys(ws, p.id, req.body.required_field_keys);
    const pos = (await q().query('SELECT COALESCE(max(position), -1) + 1 AS n FROM stages WHERE pipeline_id = $1', [p.id])).rows[0].n;
    const s = (await q().query('INSERT INTO stages (workspace_id, pipeline_id, name, position, kind, required_field_keys) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [ws, p.id, req.body.name, pos, req.body.kind, keys])).rows[0];
    await audit(req, { event_type: 'stage.created', target_type: 'stage', target_id: s.id, after: { pipeline: p.name, name: s.name, kind: s.kind, required_field_keys: keys } });
    res.status(201).json({ data: s });
  } catch (e) { next(e); }
});

router.patch('/stages/:id', requirePerm('pipeline.manage'), validate({
  body: z.object({ name: z.string().trim().min(1).max(60).optional(), kind: z.enum(['open', 'won', 'lost']).optional(), required_field_keys: keysSchema.optional() }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await findScoped('stages', req.params.id, ws, { softDelete: false });
    const keys = req.body.required_field_keys ? await validRequiredKeys(ws, before.pipeline_id, req.body.required_field_keys) : null;
    const s = (await q().query(
      `UPDATE stages SET name = COALESCE($3, name), kind = COALESCE($4, kind), required_field_keys = COALESCE($5, required_field_keys)
        WHERE id = $1 AND workspace_id = $2 RETURNING *`, [before.id, ws, req.body.name ?? null, req.body.kind ?? null, keys],
    )).rows[0];
    await audit(req, { event_type: 'stage.updated', target_type: 'stage', target_id: s.id,
      before: { name: before.name, kind: before.kind, required_field_keys: before.required_field_keys }, after: { name: s.name, kind: s.kind, required_field_keys: s.required_field_keys } });
    res.json({ data: s });
  } catch (e) { next(e); }
});

router.put('/pipelines/:id/stages/order', requirePerm('pipeline.manage'), validate({ body: z.object({ ids: z.array(z.string().uuid()).min(1) }) }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const p = await findScoped('pipelines', req.params.id, ws, { softDelete: false });
    const current = (await q().query('SELECT id, name FROM stages WHERE pipeline_id = $1 ORDER BY position', [p.id])).rows;
    const ids = req.body.ids;
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.some((s) => s.id === id))) {
      throw httpError(400, 'The new order must list every stage of this pipeline exactly once');
    }
    await withTransaction(async (c) => {
      for (let i = 0; i < ids.length; i += 1) await c.query('UPDATE stages SET position = $2 WHERE id = $1', [ids[i], i]);
      await audit(req, { event_type: 'stage.reordered', target_type: 'pipeline', target_id: p.id,
        before: current.map((s) => s.name), after: ids.map((id) => current.find((s) => s.id === id).name) }, c);
    });
    res.json({ data: (await pipelinesWithStages(ws, p.id))[0] });
  } catch (e) { next(e); }
});

/** Safe delete (F2.5): opportunities in the stage must be moved to ?move_to=<stageId> of the same pipeline. */
router.delete('/stages/:id', requirePerm('pipeline.manage'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const s = await findScoped('stages', req.params.id, ws, { softDelete: false });
    const siblings = (await q().query('SELECT id, name FROM stages WHERE pipeline_id = $1', [s.pipeline_id])).rows;
    if (siblings.length <= 1) throw httpError(409, 'A pipeline needs at least one stage.');
    const opps = (await q().query('SELECT id, contact_id, title FROM opportunities WHERE stage_id = $1 AND deleted_at IS NULL', [s.id])).rows;
    const archived = (await q().query('SELECT count(*)::int AS n FROM opportunities WHERE stage_id = $1 AND deleted_at IS NOT NULL', [s.id])).rows[0].n;
    const moveTo = req.query.move_to;
    if ((opps.length || archived) && !moveTo) {
      const e = httpError(409, `This stage has ${opps.length} opportunit${opps.length === 1 ? 'y' : 'ies'}. Choose a stage to move them to.`);
      e.extra = { opportunity_count: opps.length };
      throw e;
    }
    let target = null;
    if (moveTo) {
      target = siblings.find((x) => x.id === moveTo && x.id !== s.id);
      if (!target) throw httpError(400, 'Move-to stage must be another stage of the same pipeline');
    }
    await withTransaction(async (c) => {
      if (target) {
        await c.query('UPDATE opportunities SET stage_id = $2, version = version + 1, updated_at = now() WHERE stage_id = $1', [s.id, target.id]);
        for (const o of opps) {
          await logActivity({ ws, contact_id: o.contact_id, opportunity_id: o.id, type: 'stage_change', actor_id: req.user.id,
            summary: `Moved from ${s.name} to ${target.name} because stage "${s.name}" was deleted` }, c);
        }
      }
      await c.query('DELETE FROM stages WHERE id = $1 AND workspace_id = $2', [s.id, ws]);
      const rest = (await c.query('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position', [s.pipeline_id])).rows;
      for (let i = 0; i < rest.length; i += 1) await c.query('UPDATE stages SET position = $2 WHERE id = $1', [rest[i].id, i]);
      await audit(req, { event_type: 'stage.deleted', target_type: 'stage', target_id: s.id, before: { name: s.name, opportunities: opps.length }, after: target ? { moved_to: target.name } : null }, c);
    });
    res.json({ data: { ok: true, moved: opps.length } });
  } catch (e) { next(e); }
});

module.exports = router;

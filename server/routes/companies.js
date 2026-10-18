// Companies (F2.1) — owner: Musa.
const express = require('express');
const { z } = require('zod');
const { withTransaction } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { assertInWorkspace } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const crm = require('../services/crm');

const router = express.Router();
const base = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  domain: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  custom: z.record(z.string(), z.any()).optional(),
};

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try { const r = await crm.list('company', req.query, req.user.ws); res.json({ data: r.rows, total: r.total, page: r.page, limit: r.limit }); } catch (e) { next(e); }
});
router.get('/:id', requirePerm('crm.view'), async (req, res, next) => {
  try { res.json({ data: await crm.getOne('company', req.params.id, req.user.ws) }); } catch (e) { next(e); }
});

router.post('/', requirePerm('crm.create'), validate({ body: z.object(base) }), async (req, res, next) => {
  try {
    const ws = req.user.ws; const b = req.body;
    await assertInWorkspace('users', b.owner_id, ws, null, false);
    const custom = await crm.cleanCustom(ws, 'company', null, b.custom, {});
    const row = (await require('../db/index').q().query(
      `INSERT INTO companies (workspace_id, name, domain, phone, owner_id, custom, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ws, b.name, b.domain || null, b.phone || null, b.owner_id || null, JSON.stringify(custom), req.user.id],
    )).rows[0];
    res.status(201).json({ data: row });
  } catch (e) { next(e); }
});

router.patch('/:id', requirePerm('crm.edit'), validate({
  body: z.object({ ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()])), version: z.number().int() }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws; const b = req.body;
    const before = await crm.getOne('company', req.params.id, ws);
    if (b.owner_id !== undefined) await assertInWorkspace('users', b.owner_id, ws, null, false);
    const sets = {};
    for (const k of ['name', 'domain', 'phone', 'owner_id']) if (b[k] !== undefined) sets[k] = b[k];
    if (b.custom !== undefined) sets.custom = JSON.stringify(await crm.cleanCustom(ws, 'company', null, b.custom, before.custom));
    res.json({ data: await crm.updateVersioned('companies', before.id, ws, b.version, sets) });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePerm('crm.delete'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await crm.getOne('company', req.params.id, ws);
    await withTransaction(async (c) => {
      await c.query('UPDATE companies SET deleted_at = now() WHERE id = $1 AND workspace_id = $2', [before.id, ws]);
      await c.query('UPDATE contacts SET company_id = NULL, version = version + 1, updated_at = now() WHERE company_id = $1 AND workspace_id = $2', [before.id, ws]);
      await audit(req, { event_type: 'record.deleted', target_type: 'company', target_id: before.id, before: { name: before.name } }, c);
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

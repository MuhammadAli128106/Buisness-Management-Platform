// Contacts (F2.1, F2.2, F2.6, F2.7, F2.8, I1.9) — owner: Musa.
const express = require('express');
const { z } = require('zod');
const { withTransaction, q } = require('../db/index');
const { requirePerm, hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { assertInWorkspace, isUuid } = require('../utils/dbSecurity');
const { audit, diff } = require('../utils/audit');
const { logActivity } = require('../utils/activity');
const { maskOpps } = require('../utils/mask');
const { normalizePhone } = require('../utils/format');
const crm = require('../services/crm');
const leadEngine = require('../services/leadEngine');

const router = express.Router();

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20).transform((a) => [...new Set(a.map((t) => t.toLowerCase()))]);
const phoneSchema = z.string().trim().max(30).nullable().optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhone(v);
    if (!p) { ctx.addIssue({ code: 'custom', message: 'Enter the phone in international format, e.g. +923001234567' }); return z.NEVER; }
    return p;
  });
const base = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.union([z.string().trim().email('Enter a valid email').max(160), z.literal(''), z.null()]).optional().transform((v) => v || null),
  phone: phoneSchema,
  company_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  tags: tagsSchema.optional(),
  custom: z.record(z.string(), z.any()).optional(),
};

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const r = await crm.list('contact', req.query, req.user.ws);
    res.json({ data: r.rows, total: r.total, page: r.page, limit: r.limit });
  } catch (e) { next(e); }
});

router.get('/:id', requirePerm('crm.view'), async (req, res, next) => {
  try { res.json({ data: await crm.getOne('contact', req.params.id, req.user.ws) }); } catch (e) { next(e); }
});

/** Complete customer view (F2.8). */
router.get('/:id/full', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const contact = await crm.getOne('contact', req.params.id, ws);
    const p = [contact.id, ws];
    const [company, opps, convs, payments, appts, leads, assigned, acts] = await Promise.all([
      contact.company_id ? q().query('SELECT id, name, domain, phone FROM companies WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [contact.company_id, ws]) : { rows: [] },
      q().query(`SELECT ${crm.ENTITIES.opportunity.select} FROM opportunities c ${crm.ENTITIES.opportunity.joins}
                 WHERE c.contact_id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL ORDER BY c.created_at DESC`, p),
      q().query(`SELECT cv.*, u.name AS assigned_user_name,
                   (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
                 FROM conversations cv LEFT JOIN users u ON u.id = cv.assigned_user_id
                 WHERE cv.contact_id = $1 AND cv.workspace_id = $2 ORDER BY cv.last_message_at DESC NULLS LAST`, p),
      q().query(`SELECT pm.*, o.title AS opportunity_title, u.name AS requested_by_name FROM payments pm
                 JOIN opportunities o ON o.id = pm.opportunity_id LEFT JOIN users u ON u.id = pm.requested_by
                 WHERE pm.contact_id = $1 AND pm.workspace_id = $2 ORDER BY pm.created_at DESC`, p),
      q().query(`SELECT a.*, u.name AS user_name FROM appointments a LEFT JOIN users u ON u.id = a.user_id
                 WHERE a.contact_id = $1 AND a.workspace_id = $2 ORDER BY a.starts_at DESC`, p),
      q().query(`SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id
                 WHERE l.contact_id = $1 AND l.workspace_id = $2 ORDER BY l.created_at DESC`, p),
      q().query(`SELECT u.id, u.name, u.email, u.status FROM users u WHERE u.workspace_id = $2 AND u.id = COALESCE(
                   (SELECT owner_id FROM leads WHERE contact_id = $1 AND workspace_id = $2 AND status IN ('assigned','acknowledged') ORDER BY created_at DESC LIMIT 1),
                   (SELECT owner_id FROM contacts WHERE id = $1))`, p),
      q().query(`SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.actor_id
                 WHERE a.workspace_id = $2 AND (a.contact_id = $1 OR a.opportunity_id IN (SELECT id FROM opportunities WHERE contact_id = $1))
                 ORDER BY a.created_at DESC LIMIT 200`, p),
    ]);
    // payments carry amounts tied to opportunity value; hide them too when values are hidden
    const canSeeValues = hasPerm(req, 'opp.value.view');
    res.json({
      data: {
        contact, company: company.rows[0] || null, opportunities: maskOpps(opps.rows, req),
        conversations: convs.rows,
        payments: canSeeValues ? payments.rows : payments.rows.map((x) => ({ ...x, amount_cents: null, refunded_cents: null, value_masked: true })),
        appointments: appts.rows, leads: leads.rows, assigned_user: assigned.rows[0] || null, activities: acts.rows,
      },
    });
  } catch (e) { next(e); }
});

router.post('/', requirePerm('crm.create'), validate({ body: z.object(base) }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const b = req.body;
    await assertInWorkspace('companies', b.company_id, ws);
    await assertInWorkspace('users', b.owner_id, ws, null, false);
    const custom = await crm.cleanCustom(ws, 'contact', null, b.custom, {});
    const row = await withTransaction(async (c) => {
      const ct = (await c.query(
        `INSERT INTO contacts (workspace_id, name, email, phone, company_id, owner_id, tags, custom, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9) RETURNING *`,
        [ws, b.name, b.email, b.phone, b.company_id || null, b.owner_id || req.user.id, b.tags || [], JSON.stringify(custom), req.user.id],
      )).rows[0];
      await logActivity({ ws, contact_id: ct.id, type: 'field_edit', actor_id: req.user.id, summary: `Contact created by ${req.user.name}` }, c);
      return ct;
    });
    res.status(201).json({ data: row });
  } catch (e) {
    if (e.code === '23505') return next(httpError(409, 'A contact with this phone number already exists', { phone: 'Already used by another contact' }));
    next(e);
  }
});

router.patch('/:id', requirePerm('crm.edit'), validate({
  body: z.object({
    ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()])),
    opted_out: z.boolean().optional(),
    opted_out_reason: z.string().trim().max(300).nullable().optional(),
    version: z.number().int(),
  }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const before = await crm.getOne('contact', req.params.id, ws);
    const b = req.body;
    if (b.company_id !== undefined) await assertInWorkspace('companies', b.company_id, ws);
    if (b.owner_id !== undefined) await assertInWorkspace('users', b.owner_id, ws, null, false);
    const sets = {};
    for (const k of ['name', 'email', 'phone', 'company_id', 'owner_id', 'tags']) if (b[k] !== undefined) sets[k] = b[k];
    if (b.custom !== undefined) sets.custom = JSON.stringify(await crm.cleanCustom(ws, 'contact', null, b.custom, before.custom));
    if (b.opted_out !== undefined) {
      if (b.opted_out && !b.opted_out_reason && !before.opted_out_reason) throw httpError(400, 'Give a reason for opting out', { opted_out_reason: 'Required when opting out' });
      sets.opted_out = b.opted_out;
      sets.opted_out_reason = b.opted_out ? (b.opted_out_reason ?? before.opted_out_reason) : null;
      sets.opted_out_at = b.opted_out ? new Date() : null;
    }
    const updated = await withTransaction(async (c) => {
      const row = await crm.updateVersioned('contacts', before.id, ws, b.version, sets, c);
      const d = diff(before, row, Object.keys(sets).filter((k) => k !== 'opted_out_at'));
      if (d.changed) {
        await logActivity({
          ws, contact_id: row.id, type: 'field_edit', actor_id: req.user.id,
          summary: `${req.user.name} changed ${Object.keys(d.after).map((k) => (k === 'custom' ? 'custom fields' : k.replace(/_/g, ' '))).join(', ')}`,
          data: d,
        }, c);
      }
      return row;
    });
    res.json({ data: updated });
  } catch (e) {
    if (e.code === '23505') return next(httpError(409, 'A contact with this phone number already exists', { phone: 'Already used by another contact' }));
    next(e);
  }
});

router.delete('/:id', requirePerm('crm.delete'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const before = await crm.getOne('contact', req.params.id, ws);
    await withTransaction(async (c) => {
      await c.query('UPDATE contacts SET deleted_at = now() WHERE id = $1 AND workspace_id = $2', [before.id, ws]);
      await c.query('UPDATE opportunities SET deleted_at = now() WHERE contact_id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [before.id, ws]);
      await leadEngine.closeLeadsForContact({ ws, contactId: before.id, client: c });
      await audit(req, { event_type: 'record.deleted', target_type: 'contact', target_id: before.id, before: { name: before.name, phone: before.phone, email: before.email } }, c);
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

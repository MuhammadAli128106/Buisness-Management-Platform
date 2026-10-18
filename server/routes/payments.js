// Payments (I2.1, I2.5, I2.6, I2.7) — owner: Musa. Mounted at /api/v1. Provider: Google Pay (TEST).
const express = require('express');
const { z } = require('zod');
const { q, withTransaction } = require('../db/index');
const { requirePerm, hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');
const { money } = require('../utils/format');
const { audit } = require('../utils/audit');
const { logActivity } = require('../utils/activity');
const crm = require('../services/crm');
const { createPaymentRequest, expireStale } = require('../services/googlePay');
const { sendToContact } = require('../services/messenger');

const router = express.Router();
const SELECT = `SELECT pm.*, o.title AS opportunity_title, ct.name AS contact_name, u.name AS requested_by_name
  FROM payments pm JOIN opportunities o ON o.id = pm.opportunity_id JOIN contacts ct ON ct.id = pm.contact_id
  LEFT JOIN users u ON u.id = pm.requested_by`;
const maskPay = (req, rows) => (hasPerm(req, 'opp.value.view') ? rows : rows.map((r) => ({ ...r, amount_cents: null, refunded_cents: null, value_masked: true })));

router.post('/opportunities/:id/payments', requirePerm('crm.edit'), validate({
  body: z.object({
    amount_cents: z.number().int().min(100, 'Amount is too small').max(99999999 * 100),
    currency: z.string().trim().length(3, 'Use a 3-letter currency code').optional(),
    description: z.string().trim().max(200).optional(),
  }),
}), async (req, res, next) => {
  try {
    const opp = await crm.getOne('opportunity', req.params.id, req.user.ws);
    const p = await createPaymentRequest({ ws: req.user.ws, opp, amountCents: req.body.amount_cents, currency: req.body.currency, description: req.body.description, userId: req.user.id });
    res.status(201).json({ data: p });
  } catch (e) { next(e); }
});

router.get('/payments', requirePerm('crm.view'), async (req, res, next) => {
  try {
    await expireStale(req.user.ws);
    const where = ['pm.workspace_id = $1']; const params = [req.user.ws];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.status) add('pm.status = ?', req.query.status);
    if (isUuid(req.query.opportunity_id)) add('pm.opportunity_id = ?', req.query.opportunity_id);
    if (isUuid(req.query.contact_id)) add('pm.contact_id = ?', req.query.contact_id);
    if (req.query.period === 'this_month') where.push(`pm.paid_at >= date_trunc('month', now())`);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const w = where.join(' AND ');
    const [rows, total] = await Promise.all([
      q().query(`${SELECT} WHERE ${w} ORDER BY pm.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
      q().query(`SELECT count(*)::int AS n FROM payments pm WHERE ${w}`, params),
    ]);
    res.json({ data: maskPay(req, rows.rows), total: total.rows[0].n, page, limit });
  } catch (e) { next(e); }
});

router.get('/payments/:id', requirePerm('crm.view'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    await expireStale(req.user.ws);
    const row = (await q().query(`${SELECT} WHERE pm.id = $1 AND pm.workspace_id = $2`, [req.params.id, req.user.ws])).rows[0];
    if (!row) throw httpError(404, 'Not found');
    res.json({ data: maskPay(req, [row])[0] });
  } catch (e) { next(e); }
});

/** Send the link to the customer over Telegram. */
router.post('/payments/:id/send', requirePerm('crm.edit'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const p = (await q().query(`${SELECT} WHERE pm.id = $1 AND pm.workspace_id = $2`, [req.params.id, req.user.ws])).rows[0];
    if (!p) throw httpError(404, 'Not found');
    if (p.status !== 'pending') throw httpError(409, 'Only pending payment links can be sent');
    const m = await sendToContact({ ws: req.user.ws, contactId: p.contact_id, userId: req.user.id,
      body: `Hi ${p.contact_name.split(' ')[0]}, here is your secure payment link for "${p.description || p.opportunity_title}" (${money(p.amount_cents, p.currency)}): ${p.checkout_url}` });
    res.status(m.status === 'failed' ? 202 : 201).json({ data: m });
  } catch (e) { next(e); }
});

/** Google Pay (TEST) has no refund API or merchant dashboard; an authorised user records the refund (I2.5). */
router.post('/payments/:id/refund', requirePerm('crm.edit', 'opp.value.view'), validate({
  body: z.object({ amount_cents: z.number().int().min(1), reason: z.string().trim().min(1, 'Give a reason').max(300) }),
}), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const out = await withTransaction(async (c) => {
      const p = (await c.query('SELECT * FROM payments WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [req.params.id, req.user.ws])).rows[0];
      if (!p) throw httpError(404, 'Not found');
      if (!['paid', 'partially_refunded'].includes(p.status)) throw httpError(409, 'Only paid payments can be refunded');
      const total = Number(p.refunded_cents) + req.body.amount_cents;
      if (total > Number(p.amount_cents)) throw httpError(400, `You can refund at most ${money(p.amount_cents - p.refunded_cents, p.currency)}`);
      const row = (await c.query(`UPDATE payments SET refunded_cents = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
        [p.id, total, total >= Number(p.amount_cents) ? 'refunded' : 'partially_refunded'])).rows[0];
      await logActivity({ ws: req.user.ws, contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'payment', actor_id: req.user.id,
        summary: `Refund of ${money(req.body.amount_cents, p.currency)} recorded by ${req.user.name}: ${req.body.reason}`, data: { payment_id: p.id } }, c);
      await audit(req, { event_type: 'payment.refunded', target_type: 'payment', target_id: p.id, before: { status: p.status, refunded_cents: p.refunded_cents }, after: { status: row.status, refunded_cents: total, reason: req.body.reason } }, c);
      return row;
    });
    res.json({ data: out });
  } catch (e) { next(e); }
});

module.exports = router;

// Stripe webhook (I2.2–I2.5) — owner: Musa. PUBLIC, raw body (mounted with express.raw in index.js).
// Signature verified BEFORE any record changes; each event id processed exactly once.
const express = require('express');
const Stripe = require('stripe');
const { withTransaction, q } = require('../db/index');
const { getConfig, markOk } = require('../services/integrationsStore');
const { recordEvent } = require('../services/integrationEvents');
const { logActivity } = require('../utils/activity');
const { audit } = require('../utils/audit');
const { isUuid } = require('../utils/dbSecurity');
const { money } = require('../utils/format');

const router = express.Router();

async function findPayment(c, ws, { paymentId, sessionId, intentId }) {
  if (paymentId && isUuid(paymentId)) {
    const r = (await c.query('SELECT * FROM payments WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [paymentId, ws])).rows[0];
    if (r) return r;
  }
  if (sessionId) {
    const r = (await c.query('SELECT * FROM payments WHERE stripe_session_id = $1 AND workspace_id = $2 FOR UPDATE', [sessionId, ws])).rows[0];
    if (r) return r;
  }
  if (intentId) return (await c.query('SELECT * FROM payments WHERE stripe_payment_intent = $1 AND workspace_id = $2 FOR UPDATE', [intentId, ws])).rows[0];
  return null;
}

/** Applies one verified event. Returns {payment, from, to} or null when not ours / no-op. */
async function apply(c, ws, event) {
  const o = event.data.object;
  let p; let to; const sets = {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      p = await findPayment(c, ws, { paymentId: o.metadata?.payment_id || o.client_reference_id, sessionId: o.id });
      if (!p || o.payment_status !== 'paid') return null;
      if (['paid', 'refunded', 'partially_refunded'].includes(p.status)) return null;
      to = 'paid'; sets.paid_at = new Date((event.created || Date.now() / 1000) * 1000); sets.stripe_payment_intent = o.payment_intent || p.stripe_payment_intent;
      break;
    case 'checkout.session.expired':
      p = await findPayment(c, ws, { paymentId: o.metadata?.payment_id, sessionId: o.id });
      if (!p || p.status !== 'pending') return null;
      to = 'expired'; sets.failure_reason = 'The payment link expired before the customer paid.';
      break;
    case 'checkout.session.async_payment_failed':
      p = await findPayment(c, ws, { paymentId: o.metadata?.payment_id, sessionId: o.id });
      if (!p || !['pending', 'failed'].includes(p.status)) return null;
      to = 'failed'; sets.failure_reason = 'The customer\'s payment method failed.';
      break;
    case 'payment_intent.payment_failed':
      p = await findPayment(c, ws, { paymentId: o.metadata?.payment_id, intentId: o.id });
      if (!p || !['pending', 'failed'].includes(p.status)) return null;
      to = 'failed'; sets.stripe_payment_intent = o.id;
      sets.failure_reason = o.last_payment_error?.message || 'The card was declined.';
      break;
    case 'charge.refunded':
      p = await findPayment(c, ws, { paymentId: o.metadata?.payment_id, intentId: o.payment_intent });
      if (!p) return null;
      sets.refunded_cents = o.amount_refunded;
      to = o.amount_refunded >= p.amount_cents ? 'refunded' : 'partially_refunded';
      if (!p.paid_at) sets.paid_at = new Date((o.created || event.created) * 1000);
      break;
    default:
      return null;
  }
  const cols = Object.keys(sets);
  const updated = (await c.query(
    `UPDATE payments SET status = $2, ${cols.map((k, i) => `${k} = $${i + 3}`).join(', ')}${cols.length ? ',' : ''} updated_at = now() WHERE id = $1 RETURNING *`,
    [p.id, to, ...cols.map((k) => sets[k])],
  )).rows[0];
  const label = { paid: 'received', expired: 'link expired', failed: 'failed', refunded: 'refunded', partially_refunded: 'partially refunded' }[to];
  const amount = to.includes('refund') ? sets.refunded_cents : p.amount_cents;
  await logActivity({ ws, contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'payment',
    summary: `Payment ${label}: ${money(amount, p.currency)}${sets.failure_reason && to === 'failed' ? ` — ${sets.failure_reason}` : ''}`,
    data: { payment_id: p.id, stripe_event: event.id, from: p.status, to } }, c);
  return { payment: updated, from: p.status, to };
}

router.post('/:wsId', async (req, res, next) => {
  const ws = req.params.wsId;
  try {
    const exists = isUuid(ws) && (await q().query('SELECT 1 FROM workspaces WHERE id = $1', [ws])).rowCount;
    if (!exists) return res.status(404).json({ error: 'Unknown workspace' });
    const cfg = await getConfig(ws, 'stripe');
    if (!cfg?.webhook_secret) {
      await recordEvent({ ws, provider: 'stripe', direction: 'in', kind: 'webhook', status: 'error', http_status: 409, error: 'Stripe is not connected for this workspace' });
      return res.status(409).json({ error: 'Stripe not connected' });
    }
    let event;
    try {
      event = Stripe.webhooks.constructEvent(req.body, req.get('stripe-signature') || '', cfg.webhook_secret);
    } catch (err) {
      await recordEvent({ ws, provider: 'stripe', direction: 'in', kind: 'webhook', status: 'rejected', http_status: 400, error: `Signature check failed: ${err.message}`, detail: { ip: req.ip } });
      await audit(null, { ws, event_type: 'webhook.rejected', target_type: 'stripe', after: { reason: 'invalid signature', ip: req.ip } });
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const result = await withTransaction(async (c) => {
      const fresh = await c.query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('stripe', $1) ON CONFLICT DO NOTHING`, [event.id]);
      if (!fresh.rowCount) return { duplicate: true };
      return { applied: await apply(c, ws, event) };
    });
    await recordEvent({
      ws, provider: 'stripe', direction: 'in', kind: event.type, external_id: event.id,
      status: result.duplicate ? 'duplicate' : 'ok', http_status: 200,
      detail: result.applied ? { payment_id: result.applied.payment.id, from: result.applied.from, to: result.applied.to } : { ignored: !result.duplicate },
    });
    if (!result.duplicate) await markOk(ws, 'stripe');
    res.json({ received: true, duplicate: Boolean(result.duplicate) });
  } catch (e) { next(e); }
});

module.exports = router;

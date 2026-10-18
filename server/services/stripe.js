// Stripe Checkout (I2) — owner: Musa. Card data only ever touches Stripe's hosted page (I2.8).
const Stripe = require('stripe');
const { q } = require('../db/index');
const { getConfig, markOk, markError } = require('./integrationsStore');
const { recordEvent } = require('./integrationEvents');
const { withRetry } = require('../utils/retry');
const { logActivity } = require('../utils/activity');
const { httpError } = require('../middleware/errorHandler');
const { money } = require('../utils/format');
const { publicBase } = require('./twilio');

async function stripeFor(ws) {
  const cfg = await getConfig(ws, 'stripe');
  if (!cfg?.secret_key) throw httpError(422, 'Payments are not connected for this workspace. An admin can connect Stripe on the Integrations page.');
  return { cfg, stripe: new Stripe(cfg.secret_key, { maxNetworkRetries: 0, timeout: 15000 }) };
}

/** Creates a pending payment row, then a Checkout Session. Never loses the request: on failure the row is marked failed with the reason. */
async function createPaymentRequest({ ws, opp, amountCents, currency, description, userId }) {
  const { stripe } = await stripeFor(ws);
  const cur = String(currency || opp.currency || 'usd').toLowerCase();
  const payment = (await q().query(
    `INSERT INTO payments (workspace_id, opportunity_id, contact_id, requested_by, amount_cents, currency, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ws, opp.id, opp.contact_id, userId, amountCents, cur.toUpperCase(), description || opp.title],
  )).rows[0];
  const base = publicBase();
  try {
    const session = await withRetry(() => stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: cur, unit_amount: amountCents, product_data: { name: (description || opp.title).slice(0, 200) } } }],
      client_reference_id: payment.id,
      metadata: { payment_id: payment.id, workspace_id: ws, opportunity_id: opp.id },
      payment_intent_data: { metadata: { payment_id: payment.id, workspace_id: ws } },
      success_url: `${base}/opportunities/${opp.id}?payment=success`,
      cancel_url: `${base}/opportunities/${opp.id}?payment=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    }, { idempotencyKey: `payment-${payment.id}` }), { attempts: 3, baseMs: 500 });
    const row = (await q().query(
      `UPDATE payments SET stripe_session_id = $2, checkout_url = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [payment.id, session.id, session.url],
    )).rows[0];
    await recordEvent({ ws, provider: 'stripe', direction: 'out', kind: 'checkout.session.create', external_id: session.id, status: 'ok', http_status: 200, detail: { payment_id: payment.id, amount: amountCents, currency: cur } });
    await logActivity({ ws, contact_id: opp.contact_id, opportunity_id: opp.id, type: 'payment', actor_id: userId,
      summary: `Payment link created for ${money(amountCents, cur)}`, data: { payment_id: payment.id } });
    await markOk(ws, 'stripe');
    return row;
  } catch (err) {
    const reason = err.temporary ? 'Stripe is not reachable right now. Try again in a minute.' : `Stripe refused the request: ${err.message}`;
    await q().query(`UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [payment.id, reason]);
    await recordEvent({ ws, provider: 'stripe', direction: 'out', kind: 'checkout.session.create', status: 'error', http_status: err.statusCode || null, error: err.message, detail: { payment_id: payment.id } });
    if (err.temporary || err.type === 'StripeAuthenticationError') await markError(ws, 'stripe', reason);
    throw httpError(err.temporary ? 503 : 400, reason);
  }
}

module.exports = { stripeFor, createPaymentRequest };

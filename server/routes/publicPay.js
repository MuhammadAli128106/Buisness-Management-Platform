// Public payment page API (I2) — owner: Musa. PUBLIC, mounted at /api/v1/public/pay. The unguessable link token is the credential.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { q } = require('../db/index');
const { getConfig } = require('../services/integrationsStore');
const { recordEvent } = require('../services/integrationEvents');
const { completePayment, expireStale, GATEWAY, GATEWAY_MERCHANT_ID } = require('../services/googlePay');

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, message: { error: 'Too many requests. Wait a minute and try again.' } }));
const valid = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(t);

router.get('/:token', async (req, res, next) => {
  try {
    if (!valid(req.params.token)) return res.status(404).json({ error: 'This payment link does not exist.' });
    const p0 = (await q().query('SELECT workspace_id FROM payments WHERE link_token = $1', [req.params.token])).rows[0];
    if (!p0) return res.status(404).json({ error: 'This payment link does not exist.' });
    await expireStale(p0.workspace_id);
    const p = (await q().query(
      `SELECT pm.amount_cents, pm.currency, pm.description, pm.status, pm.expires_at, pm.paid_at, pm.provider_ref, pm.workspace_id,
              w.name AS company, ct.name AS customer
         FROM payments pm JOIN workspaces w ON w.id = pm.workspace_id JOIN contacts ct ON ct.id = pm.contact_id
        WHERE pm.link_token = $1`, [req.params.token],
    )).rows[0];
    const cfg = await getConfig(p.workspace_id, 'googlepay');
    res.json({
      data: {
        company: p.company, customer_first_name: (p.customer || '').split(' ')[0], description: p.description,
        amount_cents: p.amount_cents, currency: p.currency, status: p.status, expires_at: p.expires_at, paid_at: p.paid_at, reference: p.provider_ref,
        google_pay: { environment: 'TEST', merchant_name: cfg?.merchant_name || p.company, gateway: GATEWAY, gateway_merchant_id: GATEWAY_MERCHANT_ID, country_code: 'PK' },
      },
    });
  } catch (e) { next(e); }
});

router.post('/:token/complete', async (req, res, next) => {
  try {
    if (!valid(req.params.token)) return res.status(404).json({ error: 'This payment link does not exist.' });
    const { payment, duplicate } = await completePayment({ token: req.params.token, paymentData: req.body?.paymentData, ip: req.ip });
    res.json({ data: { status: payment.status, reference: payment.provider_ref, duplicate } });
  } catch (e) { next(e); }
});

/** The customer closed the sheet or Google reported an error — recorded, link stays usable (I2.5 "abandoned"). */
router.post('/:token/abandon', async (req, res, next) => {
  try {
    if (!valid(req.params.token)) return res.status(404).json({ error: 'Not found' });
    const p = (await q().query('SELECT id, workspace_id FROM payments WHERE link_token = $1', [req.params.token])).rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    const code = String(req.body?.statusCode || 'CANCELED').slice(0, 40);
    await recordEvent({ ws: p.workspace_id, provider: 'googlepay', direction: 'in', kind: code === 'CANCELED' ? 'payment.abandoned' : 'payment.error', status: code === 'CANCELED' ? 'ok' : 'error', error: code === 'CANCELED' ? null : code, detail: { payment_id: p.id } });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

module.exports = router;

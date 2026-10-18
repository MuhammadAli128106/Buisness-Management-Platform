// Google Pay (TEST environment) payments (I2) — owner: Musa. Replaces Stripe (organiser announcement).
// Flow: employee creates a payment request → customer opens our hosted link /pay/<token> → real Google Pay sheet
// (TEST env) → Google returns a signed ECv2 payment token → server verifies Google's signature chain against
// Google's published TEST root keys before marking the payment paid. Card numbers never reach us (I2.8):
// the token's card data is encrypted for the gateway; we only keep network + last 4 digits from paymentMethodData.info.
const crypto = require('crypto');
const { q } = require('../db/index');
const { getConfig, markOk, markError } = require('./integrationsStore');
const { recordEvent } = require('./integrationEvents');
const { logActivity } = require('../utils/activity');
const { httpError } = require('../middleware/errorHandler');
const { money } = require('../utils/format');
const { publicBase } = require('../utils/publicUrl');

const TEST_KEYS_URL = 'https://payments.developers.google.com/paymentmethodtoken/test/keys.json';
const GATEWAY = 'example';
const GATEWAY_MERCHANT_ID = 'exampleGatewayMerchantId';
const LINK_TTL_MIN = 30;
let keyCache = { at: 0, keys: [] };

async function settings(ws) {
  const cfg = await getConfig(ws, 'googlepay');
  if (!cfg?.merchant_name) throw httpError(422, 'Payments are not set up for this workspace. An admin can enable Google Pay on the Integrations page.');
  return cfg;
}

/** Marks overdue pending links expired (I2.5). Cheap; called before reads. */
async function expireStale(ws) {
  const r = await q().query(
    `UPDATE payments SET status = 'expired', failure_reason = 'The payment link expired before the customer paid.', updated_at = now()
      WHERE workspace_id = $1 AND status = 'pending' AND expires_at < now() RETURNING id, contact_id, opportunity_id, amount_cents, currency`, [ws],
  );
  for (const p of r.rows) {
    await logActivity({ ws, contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'payment', summary: `Payment link expired: ${money(p.amount_cents, p.currency)}`, data: { payment_id: p.id } });
  }
  return r.rowCount;
}

async function createPaymentRequest({ ws, opp, amountCents, currency, description, userId }) {
  await settings(ws);
  const token = crypto.randomBytes(24).toString('base64url');
  const p = (await q().query(
    `INSERT INTO payments (workspace_id, opportunity_id, contact_id, requested_by, amount_cents, currency, description, provider, link_token, checkout_url, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'googlepay',$8,$9, now() + make_interval(mins => $10)) RETURNING *`,
    [ws, opp.id, opp.contact_id, userId, amountCents, String(currency || opp.currency || 'PKR').toUpperCase(), description || opp.title, token, `${publicBase()}/pay/${token}`, LINK_TTL_MIN],
  )).rows[0];
  await logActivity({ ws, contact_id: opp.contact_id, opportunity_id: opp.id, type: 'payment', actor_id: userId,
    summary: `Payment link created for ${money(amountCents, p.currency)} (expires in ${LINK_TTL_MIN} min)`, data: { payment_id: p.id } });
  await recordEvent({ ws, provider: 'googlepay', direction: 'out', kind: 'payment_request.create', external_id: p.id, status: 'ok', detail: { amount: amountCents, currency: p.currency } });
  return p;
}

// ── ECv2 signature verification (https://developers.google.com/pay/api/web/guides/resources/payment-data-cryptography)
const lp = (s) => { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
const pubKey = (b64) => crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
const verifySig = (key, data, sigB64) => { try { return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, Buffer.from(sigB64, 'base64')); } catch { return false; } };

async function rootKeys() {
  if (Date.now() - keyCache.at < 3600_000 && keyCache.keys.length) return keyCache.keys;
  const r = await fetch(TEST_KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error(`Could not load Google's signing keys (HTTP ${r.status})`), { temporary: true });
  const j = await r.json();
  const keys = (j.keys || []).filter((k) => k.protocolVersion === 'ECv2' && (!k.keyExpiration || Number(k.keyExpiration) > Date.now()));
  keyCache = { at: Date.now(), keys };
  return keys;
}

/** Throws with a plain reason if the token was not signed by Google for our gateway. */
async function verifyGoogleToken(tokenString) {
  let t;
  try { t = JSON.parse(tokenString); } catch { throw new Error('Payment token is not valid JSON'); }
  if (t.protocolVersion !== 'ECv2') throw new Error(`Unsupported protocol ${t.protocolVersion}`);
  const { signedKey, signatures } = t.intermediateSigningKey || {};
  if (!signedKey || !Array.isArray(signatures)) throw new Error('Token has no intermediate signing key');
  const roots = await rootKeys();
  const keyData = Buffer.concat([lp('Google'), lp('ECv2'), lp(signedKey)]);
  const rootOk = roots.some((rk) => signatures.some((s) => verifySig(pubKey(rk.keyValue), keyData, s)));
  if (!rootOk) throw new Error('Intermediate key is not signed by Google');
  const inter = JSON.parse(signedKey);
  if (Number(inter.keyExpiration) < Date.now()) throw new Error('Intermediate signing key has expired');
  const msgData = Buffer.concat([lp('Google'), lp(`gateway:${GATEWAY}`), lp('ECv2'), lp(t.signedMessage)]);
  if (!verifySig(pubKey(inter.keyValue), msgData, t.signature)) throw new Error('Payment message signature does not match');
  return true;
}

/** Called by the public pay page with Google's paymentData. Idempotent on the token (I2.4). */
async function completePayment({ token, paymentData, ip }) {
  const p = (await q().query('SELECT * FROM payments WHERE link_token = $1', [token])).rows[0];
  if (!p) throw httpError(404, 'This payment link does not exist.');
  const ws = p.workspace_id;
  await expireStale(ws);
  const cur = (await q().query('SELECT * FROM payments WHERE id = $1', [p.id])).rows[0];
  const pmd = paymentData?.paymentMethodData;
  const tokenString = pmd?.tokenizationData?.token;
  if (!tokenString || pmd?.tokenizationData?.type !== 'PAYMENT_GATEWAY') throw httpError(400, 'Google Pay did not return a payment token.');
  const tokenHash = crypto.createHash('sha256').update(tokenString).digest('hex');

  // Duplicate submission of the same Google token → report current state, change nothing.
  const fresh = await q().query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('googlepay', $1) ON CONFLICT DO NOTHING`, [tokenHash]);
  if (!fresh.rowCount) {
    await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token', external_id: tokenHash.slice(0, 16), status: 'duplicate', http_status: 200, detail: { payment_id: p.id } });
    return { payment: cur, duplicate: true };
  }
  if (cur.status !== 'pending') {
    await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token', external_id: tokenHash.slice(0, 16), status: 'rejected', http_status: 409, error: `Link is ${cur.status}`, detail: { payment_id: p.id } });
    throw httpError(409, cur.status === 'expired' ? 'This payment link has expired. Ask for a new one.' : `This payment is already ${cur.status}.`);
  }

  const cfg = await getConfig(ws, 'googlepay');
  try {
    await verifyGoogleToken(tokenString);
  } catch (err) {
    if (err.temporary) {
      await q().query(`DELETE FROM webhook_dedupe WHERE provider = 'googlepay' AND external_id = $1`, [tokenHash]); // allow retry
      await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token', status: 'error', error: err.message, detail: { payment_id: p.id } });
      await markError(ws, 'googlepay', err.message);
      throw httpError(503, 'We could not verify the payment with Google right now. Please try again in a minute.');
    }
    if (cfg?.verification !== 'log_only') {
      await q().query(`UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [p.id, `Rejected: ${err.message}`]);
      await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token', external_id: tokenHash.slice(0, 16), status: 'rejected', http_status: 400, error: err.message, detail: { payment_id: p.id, ip } });
      await logActivity({ ws, contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'payment', summary: `Payment rejected — token failed Google signature check (${err.message})`, data: { payment_id: p.id } });
      throw httpError(400, 'The payment could not be verified, so it was not accepted.');
    }
    await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token.unverified', external_id: tokenHash.slice(0, 16), status: 'error', error: `Accepted in log-only mode: ${err.message}`, detail: { payment_id: p.id } });
  }

  const info = pmd.info || {};
  const ref = `GPAY-${tokenHash.slice(0, 12).toUpperCase()}`;
  const updated = (await q().query(
    `UPDATE payments SET status = 'paid', paid_at = now(), provider_ref = $2, failure_reason = NULL, updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`, [p.id, ref],
  )).rows[0];
  if (!updated) return { payment: (await q().query('SELECT * FROM payments WHERE id = $1', [p.id])).rows[0], duplicate: true };
  await logActivity({ ws, contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'payment',
    summary: `Payment received: ${money(p.amount_cents, p.currency)} via Google Pay (${info.cardNetwork || 'card'} ••${info.cardDetails || '••'})`, data: { payment_id: p.id, ref } });
  await recordEvent({ ws, provider: 'googlepay', direction: 'in', kind: 'payment.token', external_id: ref, status: 'ok', http_status: 200, detail: { payment_id: p.id, network: info.cardNetwork || null } });
  await markOk(ws, 'googlepay');
  return { payment: updated, duplicate: false };
}

module.exports = { createPaymentRequest, completePayment, expireStale, settings, verifyGoogleToken, GATEWAY, GATEWAY_MERCHANT_ID, LINK_TTL_MIN };

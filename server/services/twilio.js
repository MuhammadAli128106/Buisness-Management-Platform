// Twilio WhatsApp (I1) — owner: Musa. The ONLY module that talks to Twilio.
const twilio = require('twilio');
const { q, withTransaction } = require('../db/index');
const { getConfig, markOk, markError } = require('./integrationsStore');
const { recordEvent } = require('./integrationEvents');
const { withRetry } = require('../utils/retry');
const { logActivity } = require('../utils/activity');
const { httpError } = require('../middleware/errorHandler');

// Plain-language explanations for the errors people actually hit with the sandbox (I1.7, I5.5).
const FRIENDLY = {
  63015: 'This phone has not joined the WhatsApp sandbox yet. Ask the customer to send the join phrase to the sandbox number first.',
  63016: 'WhatsApp only allows free-form replies within 24 hours of the customer\'s last message. Ask them to message you again.',
  63003: 'The recipient number is not a valid WhatsApp number.',
  21211: 'The phone number is invalid.',
  21608: 'This number is not verified for the sandbox / trial account.',
  20003: 'Twilio rejected our credentials. An admin needs to update them on the Integrations page.',
  21614: 'This number cannot receive messages.',
};
const friendly = (code, msg) => FRIENDLY[code] || msg || 'The message could not be delivered.';

function publicBase(req) {
  return (process.env.PUBLIC_URL || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:8080')).replace(/\/$/, '');
}
function statusCallbackUrl(ws) { return `${publicBase()}/api/v1/webhooks/twilio/${ws}/status`; }

async function clientFor(ws) {
  const cfg = await getConfig(ws, 'twilio');
  if (!cfg?.account_sid || !cfg?.auth_token || !cfg?.from) {
    throw httpError(422, 'WhatsApp is not connected for this workspace. An admin can connect Twilio on the Integrations page.');
  }
  return { cfg, client: twilio(cfg.account_sid, cfg.auth_token) };
}

/** Get or create the conversation for a contact (one per contact per channel). */
async function ensureConversation(ws, contactId, assignedUserId, client) {
  const r = await q(client).query(
    `INSERT INTO conversations (workspace_id, contact_id, channel, assigned_user_id) VALUES ($1,$2,'whatsapp',$3)
     ON CONFLICT (workspace_id, contact_id, channel) DO UPDATE SET assigned_user_id = COALESCE(conversations.assigned_user_id, EXCLUDED.assigned_user_id)
     RETURNING *`, [ws, contactId, assignedUserId || null],
  );
  return r.rows[0];
}

/** Calls Twilio for an existing (queued) message row and stores the outcome. Never throws for provider errors. */
async function deliver(ws, message, contact) {
  let tw;
  try { tw = await clientFor(ws); } catch (e) {
    await q().query(`UPDATE messages SET status = 'failed', error_code = 'not_connected', error_message = $2, updated_at = now() WHERE id = $1`, [message.id, e.message]);
    return { ...message, status: 'failed', error_message: e.message };
  }
  try {
    const sent = await withRetry(() => tw.client.messages.create({
      from: tw.cfg.from.startsWith('whatsapp:') ? tw.cfg.from : `whatsapp:${tw.cfg.from}`,
      to: `whatsapp:${contact.phone}`, body: message.body, statusCallback: statusCallbackUrl(ws),
    }), { attempts: 3, baseMs: 600 });
    const row = (await q().query(
      `UPDATE messages SET twilio_sid = $2, status = $3, error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [message.id, sent.sid, ['queued', 'sent', 'delivered'].includes(sent.status) ? sent.status : 'queued'],
    )).rows[0];
    await recordEvent({ ws, provider: 'twilio', direction: 'out', kind: 'message.send', external_id: sent.sid, status: 'ok', http_status: 201, detail: { message_id: message.id, to: contact.phone } });
    await markOk(ws, 'twilio');
    return row;
  } catch (err) {
    const code = err.code || err.status;
    const reason = friendly(err.code, err.message);
    const row = (await q().query(
      `UPDATE messages SET status = 'failed', error_code = $2, error_message = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [message.id, code ? String(code) : null, reason],
    )).rows[0];
    await recordEvent({ ws, provider: 'twilio', direction: 'out', kind: 'message.send', status: 'error', http_status: err.status || null, error: `${code || ''} ${err.message}`.trim(), detail: { message_id: message.id, to: contact.phone, temporary: Boolean(err.temporary) } });
    if (err.code === 20003 || err.temporary) await markError(ws, 'twilio', reason);
    return row;
  }
}

/** sendWhatsApp({ ws, contactId, body, userId }) → message row (status sent/queued, or failed with reason — never silently dropped, I1.7). */
async function sendWhatsApp({ ws, contactId, body, userId }) {
  const contact = (await q().query('SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [contactId, ws])).rows[0];
  if (!contact) throw httpError(404, 'Not found');
  if (contact.opted_out) {
    throw httpError(422, `${contact.name} has opted out of messages${contact.opted_out_reason ? ` (${contact.opted_out_reason})` : ''}. You can't message them unless they opt back in.`);
  }
  if (!contact.phone) throw httpError(422, `${contact.name} has no phone number. Add one to message them on WhatsApp.`);
  await clientFor(ws); // fail fast with a clear 422 if not connected
  const message = await withTransaction(async (c) => {
    const conv = await ensureConversation(ws, contact.id, userId, c);
    const m = (await c.query(
      `INSERT INTO messages (workspace_id, conversation_id, direction, body, status, created_by) VALUES ($1,$2,'out',$3,'queued',$4) RETURNING *`,
      [ws, conv.id, body, userId],
    )).rows[0];
    await c.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conv.id]);
    await logActivity({ ws, contact_id: contact.id, opportunity_id: conv.opportunity_id, type: 'message_out', actor_id: userId, summary: `WhatsApp sent: ${body.slice(0, 140)}` }, c);
    await require('./leadEngine').recordAction({ ws, contactId: contact.id, userId, kind: 'message', client: c });
    return m;
  });
  return deliver(ws, message, contact);
}

/** Retry a failed message in place (I1.7). */
async function retryMessage({ ws, messageId }) {
  const m = (await q().query(
    `SELECT m.*, cv.contact_id FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
      WHERE m.id = $1 AND m.workspace_id = $2`, [messageId, ws],
  )).rows[0];
  if (!m) throw httpError(404, 'Not found');
  if (m.direction !== 'out' || !['failed', 'undelivered'].includes(m.status)) throw httpError(409, 'Only failed outgoing messages can be retried');
  const contact = (await q().query('SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2', [m.contact_id, ws])).rows[0];
  if (contact.opted_out) throw httpError(422, `${contact.name} has opted out of messages.`);
  await q().query(`UPDATE messages SET status = 'queued', twilio_sid = NULL, updated_at = now() WHERE id = $1`, [m.id]);
  return deliver(ws, { ...m, status: 'queued' }, contact);
}

/** Verifies credentials with a harmless API call; used when an admin saves the integration. */
async function testCredentials({ account_sid: sid, auth_token: token }) {
  const acct = await twilio(sid, token).api.v2010.accounts(sid).fetch();
  return { friendly_name: acct.friendlyName, status: acct.status };
}

module.exports = { sendWhatsApp, retryMessage, ensureConversation, testCredentials, statusCallbackUrl, publicBase, friendly };

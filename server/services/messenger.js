// Customer messaging over the workspace's Telegram bot (I1) — owner: Musa.
// Replaces Twilio WhatsApp (organiser allowed alternatives for services unavailable in Pakistan).
// Outbound calls go through Ali's services/telegram.js (which records integration events).
const crypto = require('crypto');
const { q, withTransaction } = require('../db/index');
const { getConfig } = require('./integrationsStore');
const { recordEvent } = require('./integrationEvents');
const telegram = require('./telegram');
const { logActivity } = require('../utils/activity');
const { httpError } = require('../middleware/errorHandler');
const { publicBase } = require('../utils/publicUrl');

/** Per-workspace secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token (I1.2). */
function webhookSecret(ws) {
  const key = process.env.APP_ENC_KEY || process.env.JWT_SECRET || 'dev-only';
  return crypto.createHmac('sha256', key).update(`telegram-webhook:${ws}`).digest('hex').slice(0, 48);
}
const webhookUrl = (ws) => `${publicBase()}/api/v1/webhooks/telegram/${ws}`;

/** Registers our webhook with Telegram (called when an admin saves the bot token). */
async function registerWebhook(ws, botToken) {
  const url = webhookUrl(ws);
  if (!url.startsWith('https://')) {
    return { ok: false, warning: `PUBLIC_URL must be https for Telegram to deliver customer messages (currently ${url}). Alerts still work.` };
  }
  const r = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: webhookSecret(ws), allowed_updates: ['message'], drop_pending_updates: false }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  await recordEvent({ ws, provider: 'telegram', direction: 'out', kind: 'set_webhook', status: j.ok ? 'ok' : 'error', http_status: r.status, error: j.ok ? null : j.description, detail: { url } });
  if (!j.ok) throw Object.assign(new Error(`Telegram refused the webhook: ${j.description || r.status}`), { status: 400 });
  return { ok: true, url };
}

async function ensureConversation(ws, contactId, assignedUserId, client) {
  return (await q(client).query(
    `INSERT INTO conversations (workspace_id, contact_id, channel, assigned_user_id) VALUES ($1,$2,'telegram',$3)
     ON CONFLICT (workspace_id, contact_id, channel) DO UPDATE SET assigned_user_id = COALESCE(conversations.assigned_user_id, EXCLUDED.assigned_user_id)
     RETURNING *`, [ws, contactId, assignedUserId || null],
  )).rows[0];
}

/** Calls Telegram for a queued message row and stores the outcome. Never throws provider errors (I1.7). */
async function deliver(ws, message, contact) {
  try {
    const result = await telegram.sendMessage({ ws, chatId: contact.telegram_chat_id, text: message.body, kind: 'customer_message' });
    return (await q().query(
      `UPDATE messages SET status = 'sent', external_id = $2, error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [message.id, `${contact.telegram_chat_id}:${result.message_id}`],
    )).rows[0];
  } catch (err) {
    const reason = /chat not found|blocked|never started/i.test(err.message)
      ? `${contact.name} has blocked the bot or deleted the chat, so Telegram cannot deliver to them.`
      : err.message;
    return (await q().query(
      `UPDATE messages SET status = 'failed', error_code = $2, error_message = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [message.id, err.http_status ? String(err.http_status) : (err.temporary ? 'temporary' : 'rejected'), reason],
    )).rows[0];
  }
}

/** sendMessage({ ws, contactId, body, userId }) → message row (sent, or failed with a reason — never silently dropped). */
async function sendToContact({ ws, contactId, body, userId }) {
  const contact = (await q().query('SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [contactId, ws])).rows[0];
  if (!contact) throw httpError(404, 'Not found');
  if (contact.opted_out) {
    throw httpError(422, `${contact.name} has opted out of messages${contact.opted_out_reason ? ` (${contact.opted_out_reason})` : ''}. You can't message them unless they opt back in.`);
  }
  if (!contact.telegram_chat_id) {
    throw httpError(422, `${contact.name} hasn't messaged our Telegram bot yet. Telegram bots can only reply to people who started a chat with them first.`);
  }
  if (!(await getConfig(ws, 'telegram'))?.bot_token) throw httpError(422, 'Telegram is not connected for this workspace. An admin can connect it on the Integrations page.');
  const message = await withTransaction(async (c) => {
    const conv = await ensureConversation(ws, contact.id, userId, c);
    const m = (await c.query(
      `INSERT INTO messages (workspace_id, conversation_id, direction, body, status, created_by) VALUES ($1,$2,'out',$3,'queued',$4) RETURNING *`,
      [ws, conv.id, body, userId],
    )).rows[0];
    await c.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conv.id]);
    await logActivity({ ws, contact_id: contact.id, opportunity_id: conv.opportunity_id, type: 'message_out', actor_id: userId, summary: `Telegram message sent: ${body.slice(0, 140)}` }, c);
    await require('./leadEngine').recordAction({ ws, contactId: contact.id, userId, kind: 'message', client: c });
    return m;
  });
  return deliver(ws, message, contact);
}

async function retryMessage({ ws, messageId }) {
  const m = (await q().query(
    `SELECT m.*, cv.contact_id FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE m.id = $1 AND m.workspace_id = $2`, [messageId, ws],
  )).rows[0];
  if (!m) throw httpError(404, 'Not found');
  if (m.direction !== 'out' || !['failed', 'undelivered'].includes(m.status)) throw httpError(409, 'Only failed outgoing messages can be retried');
  const contact = (await q().query('SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2', [m.contact_id, ws])).rows[0];
  if (contact.opted_out) throw httpError(422, `${contact.name} has opted out of messages.`);
  await q().query(`UPDATE messages SET status = 'queued', updated_at = now() WHERE id = $1`, [m.id]);
  return deliver(ws, { ...m, status: 'queued' }, contact);
}

module.exports = { sendToContact, retryMessage, ensureConversation, registerWebhook, webhookSecret, webhookUrl };

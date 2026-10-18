// Telegram bot webhook (I1.1, I1.2, I1.5, I1.8, I1.9) — owner: Musa. PUBLIC, mounted at /api/v1/webhooks/telegram.
// Authenticity: Telegram echoes the per-workspace secret we registered in X-Telegram-Bot-Api-Secret-Token.
// Duplicates: update_id is recorded in webhook_dedupe inside the processing transaction.
const crypto = require('crypto');
const express = require('express');
const { withTransaction, q } = require('../db/index');
const { getConfig, markOk } = require('../services/integrationsStore');
const { recordEvent } = require('../services/integrationEvents');
const { ensureConversation, webhookSecret } = require('../services/messenger');
const telegram = require('../services/telegram');
const { logActivity } = require('../utils/activity');
const { audit } = require('../utils/audit');
const { isUuid } = require('../utils/dbSecurity');
const leadEngine = require('../services/leadEngine');

const router = express.Router();
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function reply(ws, chatId, text) {
  try { await telegram.sendMessage({ ws, chatId, text, kind: 'auto_reply' }); } catch (e) { console.error('[tg auto-reply]', e.message); }
}

router.post('/:wsId', async (req, res, next) => {
  const ws = req.params.wsId;
  try {
    const exists = isUuid(ws) && (await q().query('SELECT 1 FROM workspaces WHERE id = $1', [ws])).rowCount;
    if (!exists) return res.status(404).json({ error: 'Unknown workspace' });
    const update = req.body || {};
    if (!safeEqual(req.get('X-Telegram-Bot-Api-Secret-Token') || '', webhookSecret(ws))) {
      await recordEvent({ ws, provider: 'telegram', direction: 'in', kind: 'update', external_id: update.update_id ? String(update.update_id) : null, status: 'rejected', http_status: 403, error: 'Missing or wrong secret token', detail: { ip: req.ip } });
      await audit(null, { ws, event_type: 'webhook.rejected', target_type: 'telegram', target_id: update.update_id ? String(update.update_id) : null, after: { reason: 'invalid secret token', ip: req.ip } });
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!(await getConfig(ws, 'telegram'))?.bot_token) return res.status(409).json({ error: 'Telegram not connected' });

    const msg = update.message;
    const updateKey = `${ws}:${update.update_id}`;
    if (!msg || msg.chat?.type !== 'private' || update.update_id === undefined) {
      await recordEvent({ ws, provider: 'telegram', direction: 'in', kind: 'update.ignored', external_id: String(update.update_id ?? ''), status: 'ok', http_status: 200, detail: { reason: 'not a private message' } });
      return res.json({ ok: true });
    }
    const chatId = String(msg.chat.id);
    const text = String(msg.text ?? msg.caption ?? (msg.photo ? '[photo]' : msg.document ? '[file]' : msg.voice ? '[voice note]' : '[message]')).slice(0, 4000);
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || msg.from?.username || `Telegram ${chatId}`;

    // Employees use the same bot for escalation alerts: never turn them into customers.
    const employee = (await q().query('SELECT id, name FROM users WHERE workspace_id = $1 AND telegram_chat_id = $2 AND is_active', [ws, chatId])).rows[0];
    if (/^\/myid\b/i.test(text) || employee) {
      const fresh = await q().query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('telegram', $1) ON CONFLICT DO NOTHING`, [updateKey]);
      if (fresh.rowCount) {
        await reply(ws, chatId, employee
          ? `You're linked as ${employee.name}. Lead escalation alerts will arrive here.`
          : `Your Telegram chat ID is ${chatId}. Employees: paste it into Profile → Telegram to get escalation alerts.`);
        await recordEvent({ ws, provider: 'telegram', direction: 'in', kind: 'update.employee', external_id: String(update.update_id), status: 'ok', http_status: 200 });
      }
      return res.json({ ok: true });
    }

    const result = await withTransaction(async (c) => {
      const fresh = await c.query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('telegram', $1) ON CONFLICT DO NOTHING`, [updateKey]);
      if (!fresh.rowCount) return { duplicate: true };
      let contact = (await c.query('SELECT * FROM contacts WHERE workspace_id = $1 AND telegram_chat_id = $2 AND deleted_at IS NULL', [ws, chatId])).rows[0];
      let lead = null; let created = false;
      if (!contact) {
        contact = (await c.query(
          `INSERT INTO contacts (workspace_id, name, telegram_chat_id, telegram_username, source) VALUES ($1,$2,$3,$4,'telegram') RETURNING *`,
          [ws, name.slice(0, 120), chatId, msg.from?.username || null],
        )).rows[0];
        created = true;
        lead = await leadEngine.createLead({ ws, contactId: contact.id, source: 'telegram', sourceDetail: msg.from?.username ? `@${msg.from.username}` : chatId, client: c });
      }
      let optedOut = false;
      if (/^\/stop\b/i.test(text) && !contact.opted_out) {
        await c.query(`UPDATE contacts SET opted_out = true, opted_out_reason = 'Customer sent /stop to the Telegram bot', opted_out_at = now(), version = version + 1 WHERE id = $1`, [contact.id]);
        optedOut = true;
      } else if (/^\/start\b/i.test(text) && contact.opted_out && /stop/i.test(contact.opted_out_reason || '')) {
        await c.query(`UPDATE contacts SET opted_out = false, opted_out_reason = NULL, opted_out_at = NULL, version = version + 1 WHERE id = $1`, [contact.id]);
      }
      const openLead = lead || (await c.query(
        `SELECT owner_id FROM leads WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('assigned','acknowledged') ORDER BY created_at DESC LIMIT 1`, [ws, contact.id],
      )).rows[0];
      const conv = await ensureConversation(ws, contact.id, openLead?.owner_id || contact.owner_id, c);
      await c.query(
        `INSERT INTO messages (workspace_id, conversation_id, direction, body, external_id, status) VALUES ($1,$2,'in',$3,$4,'received') ON CONFLICT DO NOTHING`,
        [ws, conv.id, text, `${chatId}:${msg.message_id}`],
      );
      await c.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conv.id]);
      await logActivity({ ws, contact_id: contact.id, type: 'message_in', summary: `Telegram received: ${text.slice(0, 140)}` }, c);
      return { contact, created, lead, optedOut };
    });

    if (result.duplicate) {
      await recordEvent({ ws, provider: 'telegram', direction: 'in', kind: 'message.inbound', external_id: String(update.update_id), status: 'duplicate', http_status: 200 });
      return res.json({ ok: true });
    }
    await recordEvent({ ws, provider: 'telegram', direction: 'in', kind: 'message.inbound', external_id: String(update.update_id), status: 'ok', http_status: 200,
      detail: { chat: `…${chatId.slice(-4)}`, contact_id: result.contact.id, new_contact: result.created, lead_id: result.lead?.id || null } });
    await markOk(ws, 'telegram');
    if (result.optedOut) await reply(ws, chatId, 'You have been unsubscribed and will not receive further messages. Send /start to opt back in.');
    else if (result.created) await reply(ws, chatId, 'Thanks for reaching out! A member of our team has been assigned and will reply here shortly.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

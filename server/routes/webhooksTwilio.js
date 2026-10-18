// Twilio WhatsApp webhooks (I1.1, I1.2, I1.4, I1.5, I1.8) — owner: Musa. PUBLIC, mounted at /api/v1/webhooks/twilio
// with urlencoded body parsing. Every request is signature-verified before anything is written.
const express = require('express');
const twilio = require('twilio');
const { withTransaction, q } = require('../db/index');
const { getConfig, markOk } = require('../services/integrationsStore');
const { recordEvent } = require('../services/integrationEvents');
const { ensureConversation, publicBase } = require('../services/twilio');
const { logActivity } = require('../utils/activity');
const { audit } = require('../utils/audit');
const { isUuid } = require('../utils/dbSecurity');
const { normalizePhone } = require('../utils/format');
const leadEngine = require('../services/leadEngine');

const router = express.Router();
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4, undelivered: 4 };
const STOP_WORDS = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i;

/** Loads config + verifies X-Twilio-Signature. Returns cfg, or sends 403/404 itself and returns null. */
async function verify(req, res, kind) {
  const ws = req.params.wsId;
  const exists = isUuid(ws) && (await q().query('SELECT 1 FROM workspaces WHERE id = $1', [ws])).rowCount;
  if (!exists) { res.status(404).type('text/plain').send('Unknown workspace'); return null; }
  const cfg = await getConfig(ws, 'twilio');
  if (!cfg?.auth_token) {
    await recordEvent({ ws, provider: 'twilio', direction: 'in', kind, status: 'error', http_status: 409, error: 'Twilio is not connected for this workspace', detail: { sid: req.body?.MessageSid } });
    res.status(409).type('text/plain').send('Twilio not connected'); return null;
  }
  const url = `${publicBase(req)}${req.originalUrl}`;
  const ok = twilio.validateRequest(cfg.auth_token, req.get('X-Twilio-Signature') || '', url, req.body || {});
  if (!ok) {
    await recordEvent({ ws, provider: 'twilio', direction: 'in', kind, external_id: null, status: 'rejected', http_status: 403, error: 'Invalid X-Twilio-Signature', detail: { from: req.body?.From, sid: req.body?.MessageSid, ip: req.ip } });
    await audit(null, { ws, event_type: 'webhook.rejected', target_type: 'twilio', target_id: req.body?.MessageSid || null, after: { reason: 'invalid signature', ip: req.ip, url } });
    res.status(403).type('text/plain').send('Invalid signature'); return null;
  }
  return cfg;
}

// Inbound message (I1.1, I1.5, I1.8)
router.post('/:wsId', async (req, res, next) => {
  try {
    const cfg = await verify(req, res, 'message.inbound');
    if (!cfg) return;
    const ws = req.params.wsId;
    const sid = req.body.MessageSid || req.body.SmsSid;
    const phone = normalizePhone(req.body.From);
    const body = String(req.body.Body ?? '').slice(0, 4000) || (Number(req.body.NumMedia) ? '[media message]' : '');
    if (!sid || !phone) {
      await recordEvent({ ws, provider: 'twilio', direction: 'in', kind: 'message.inbound', status: 'error', http_status: 400, error: 'Missing MessageSid or From', detail: req.body });
      return res.status(400).type('text/plain').send('Bad request');
    }

    const result = await withTransaction(async (c) => {
      const fresh = await c.query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('twilio', $1) ON CONFLICT DO NOTHING`, [sid]);
      if (!fresh.rowCount) return { duplicate: true };

      let contact = (await c.query('SELECT * FROM contacts WHERE workspace_id = $1 AND phone = $2 AND deleted_at IS NULL', [ws, phone])).rows[0];
      let lead = null;
      let created = false;
      if (!contact) {
        contact = (await c.query(
          `INSERT INTO contacts (workspace_id, name, phone, source) VALUES ($1,$2,$3,'whatsapp') RETURNING *`,
          [ws, (req.body.ProfileName || '').trim().slice(0, 120) || phone, phone],
        )).rows[0];
        created = true;
        lead = await leadEngine.createLead({ ws, contactId: contact.id, source: 'whatsapp', sourceDetail: phone, client: c });
      }
      if (STOP_WORDS.test(body) && !contact.opted_out) {
        await c.query(`UPDATE contacts SET opted_out = true, opted_out_reason = 'Customer replied STOP on WhatsApp', opted_out_at = now(), version = version + 1 WHERE id = $1`, [contact.id]);
      }
      const openLead = lead || (await c.query(
        `SELECT owner_id FROM leads WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('assigned','acknowledged') ORDER BY created_at DESC LIMIT 1`, [ws, contact.id],
      )).rows[0];
      const conv = await ensureConversation(ws, contact.id, openLead?.owner_id || contact.owner_id, c);
      const msg = (await c.query(
        `INSERT INTO messages (workspace_id, conversation_id, direction, body, twilio_sid, status) VALUES ($1,$2,'in',$3,$4,'received') RETURNING id`,
        [ws, conv.id, body, sid],
      )).rows[0];
      await c.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conv.id]);
      await logActivity({ ws, contact_id: contact.id, type: 'message_in', summary: `WhatsApp received: ${body.slice(0, 140)}`, data: { message_id: msg.id } }, c);
      return { contact, created, lead, message_id: msg.id };
    });

    if (result.duplicate) {
      await recordEvent({ ws, provider: 'twilio', direction: 'in', kind: 'message.inbound', external_id: sid, status: 'duplicate', http_status: 200, detail: { from: phone } });
    } else {
      await recordEvent({ ws, provider: 'twilio', direction: 'in', kind: 'message.inbound', external_id: sid, status: 'ok', http_status: 200,
        detail: { from: phone, contact_id: result.contact.id, new_contact: result.created, lead_id: result.lead?.id || null } });
      await markOk(ws, 'twilio');
    }
    res.type('text/xml').send(EMPTY_TWIML);
  } catch (e) { next(e); }
});

// Delivery status callback (I1.4)
router.post('/:wsId/status', async (req, res, next) => {
  try {
    const cfg = await verify(req, res, 'message.status');
    if (!cfg) return;
    const ws = req.params.wsId;
    const sid = req.body.MessageSid || req.body.SmsSid;
    const status = String(req.body.MessageStatus || req.body.SmsStatus || '').toLowerCase();
    if (!sid || !(status in STATUS_RANK)) return res.type('text/xml').send(EMPTY_TWIML);
    const fresh = await q().query(`INSERT INTO webhook_dedupe (provider, external_id) VALUES ('twilio', $1) ON CONFLICT DO NOTHING`, [`${sid}:${status}`]);
    if (!fresh.rowCount) {
      await recordEvent({ ws, provider: 'twilio', direction: 'in', kind: 'message.status', external_id: `${sid}:${status}`, status: 'duplicate', http_status: 200 });
      return res.type('text/xml').send(EMPTY_TWIML);
    }
    const code = req.body.ErrorCode || null;
    const { friendly } = require('../services/twilio');
    // never move a message "backwards" (a late 'sent' must not overwrite 'delivered')
    const r = await q().query(
      `UPDATE messages SET status = $3, error_code = COALESCE($4, error_code), error_message = COALESCE($5, error_message), updated_at = now()
        WHERE twilio_sid = $1 AND workspace_id = $2
          AND (CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 4 END) <= $6
        RETURNING id`,
      [sid, ws, status, code, code ? friendly(Number(code), req.body.ErrorMessage) : null, STATUS_RANK[status]],
    );
    await recordEvent({ ws, provider: 'twilio', direction: 'in', kind: 'message.status', external_id: `${sid}:${status}`, status: 'ok', http_status: 200, detail: { sid, status, error_code: code, matched: r.rowCount } });
    res.type('text/xml').send(EMPTY_TWIML);
  } catch (e) { next(e); }
});

module.exports = router;

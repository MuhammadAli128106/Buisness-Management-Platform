'use strict';
/**
 * Escalation alerts (F3.9 / I4) — owner: Ali.
 * escalation() only QUEUES a row in `notifications` (inside the caller's transaction, so it
 * rolls back with it). sendPending() — run by the ticker every 2 s — delivers via Telegram
 * with limited retries (I4.4). A failure here never throws into the ticker.
 */
const { pool } = require('../db/index');
const telegram = require('./telegram');

const MAX_ATTEMPTS = 3;
const SOURCE_LABEL = { web_form: 'Web form', whatsapp: 'WhatsApp', telegram: 'Telegram', manual: 'Manual entry' };

function publicUrl() {
  return (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function buildText({ contactName, source, reason, leadId }) {
  return `⚠️ Lead escalated to you: ${contactName || 'Unknown contact'} (source: ${SOURCE_LABEL[source] || source}). `
    + `Reason: ${reason}. Open: ${publicUrl()}/leads/${leadId}`;
}

/** escalation({ ws, userId, lead, reason, client? }) → notification row */
async function escalation({ ws, userId, lead, reason, client }) {
  const c = client || pool;
  const { rows: [user] } = await c.query(
    'SELECT telegram_chat_id FROM users WHERE id = $1 AND workspace_id = $2',
    [userId, ws]
  );
  const { rows: [contact] } = await c.query(
    'SELECT name FROM contacts WHERE id = $1 AND workspace_id = $2',
    [lead.contact_id, ws]
  );
  const body = buildText({ contactName: contact && contact.name, source: lead.source, reason, leadId: lead.id });
  const hasChat = Boolean(user && user.telegram_chat_id);
  const { rows: [row] } = await c.query(
    `INSERT INTO notifications (workspace_id, user_id, lead_id, channel, body, status, last_error)
     VALUES ($1, $2, $3, 'telegram', $4, $5, $6) RETURNING *`,
    [ws, userId, lead.id, body, hasChat ? 'pending' : 'skipped',
      hasChat ? null : 'Not sent: this employee has no Telegram chat ID on their Profile']
  );
  return row;
}

/** Claim due notifications with a short lease so two tickers never send the same one. */
async function claimDue(limit) {
  const { rows } = await pool.query(
    `UPDATE notifications n
        SET next_attempt_at = now() + interval '60 seconds'
      WHERE n.id IN (
        SELECT id FROM notifications
         WHERE status IN ('pending','failed') AND attempts < $1 AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING n.*`,
    [MAX_ATTEMPTS, limit]
  );
  return rows;
}

async function deliver(n) {
  const { rows: [user] } = await pool.query(
    'SELECT telegram_chat_id FROM users WHERE id = $1 AND workspace_id = $2',
    [n.user_id, n.workspace_id]
  );
  const chatId = user && user.telegram_chat_id;
  try {
    await telegram.sendMessage({ ws: n.workspace_id, chatId, text: n.body, kind: 'escalation_alert' });
    await pool.query(
      `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE id = $1`,
      [n.id]
    );
    return true;
  } catch (err) {
    const attempts = n.attempts + 1;
    const giveUp = err.permanent || attempts >= MAX_ATTEMPTS;
    const delay = err.retryAfter ? Number(err.retryAfter) : 10 * attempts;
    await pool.query(
      `UPDATE notifications
          SET attempts = $2, last_error = $3,
              status = $4,
              next_attempt_at = now() + ($5::int * interval '1 second')
        WHERE id = $1`,
      [n.id, giveUp ? Math.max(attempts, MAX_ATTEMPTS) : attempts, err.message, giveUp ? 'failed' : 'pending', delay]
    );
    return false;
  }
}

/** Called by the ticker. Never throws. */
async function sendPending(limit) {
  let due;
  try {
    due = await claimDue(limit || 20);
  } catch (err) {
    console.error('[notify] could not load pending notifications:', err.message);
    return 0;
  }
  let sent = 0;
  for (const n of due) {
    try {
      if (await deliver(n)) sent += 1;
    } catch (err) {
      console.error(`[notify] notification ${n.id} failed:`, err.message);
    }
  }
  return sent;
}

module.exports = { escalation, sendPending, buildText, MAX_ATTEMPTS };

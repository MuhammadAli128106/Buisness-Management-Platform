'use strict';
/**
 * Telegram per-user routing + failed-alert visibility (I4.3 / I4.4) — owner: Ali. Mounted at /api/v1.
 *   GET  /me/telegram          → { chat_id, bot_connected }
 *   PUT  /me/telegram          { chat_id }   ('' or null clears it)
 *   POST /me/telegram/test     sends a hello message
 *   GET  /notifications?status=&page=&limit=   (integrations.manage)
 */
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { getConfig } = require('../services/integrationsStore');
const telegram = require('../services/telegram');

const router = express.Router();

router.get('/me/telegram', async (req, res, next) => {
  try {
    const { rows: [u] } = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1 AND workspace_id = $2', [req.user.id, req.user.ws]);
    const cfg = await getConfig(req.user.ws, 'telegram').catch(() => null);
    res.json({ data: { chat_id: (u && u.telegram_chat_id) || null, bot_connected: Boolean(cfg && cfg.bot_token) } });
  } catch (err) { next(err); }
});

const chatBody = z.object({
  chat_id: z.union([z.string().trim().regex(/^-?\d{3,20}$/, 'A chat ID is a number like 123456789 (get it from @userinfobot)'), z.literal(''), z.null()]),
});

router.put('/me/telegram', validate({ body: chatBody }), async (req, res, next) => {
  try {
    const chatId = req.body.chat_id ? req.body.chat_id : null;
    await pool.query('UPDATE users SET telegram_chat_id = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2', [req.user.id, req.user.ws, chatId]);
    res.json({ data: { chat_id: chatId } });
  } catch (err) { next(err); }
});

router.post('/me/telegram/test', async (req, res, next) => {
  try {
    const { rows: [u] } = await pool.query(
      `SELECT u.telegram_chat_id, w.name AS ws_name FROM users u JOIN workspaces w ON w.id = u.workspace_id
        WHERE u.id = $1 AND u.workspace_id = $2`,
      [req.user.id, req.user.ws]
    );
    if (!u || !u.telegram_chat_id) return res.status(422).json({ error: 'Save your Telegram chat ID first.' });
    try {
      await telegram.sendMessage({
        ws: req.user.ws, chatId: u.telegram_chat_id, kind: 'test_message',
        text: `✅ Hi ${req.user.name}! Lead escalation alerts from ${u.ws_name} will arrive in this chat.`,
      });
    } catch (err) {
      return res.status(err.temporary ? 502 : 422).json({ error: err.message });
    }
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

router.get('/notifications', requirePerm('integrations.manage'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const params = [req.user.ws];
    let where = 'n.workspace_id = $1';
    if (['pending', 'sent', 'failed', 'skipped'].includes(req.query.status)) {
      params.push(req.query.status);
      where += ` AND n.status = $${params.length}`;
    }
    const countParams = params.slice();
    params.push(limit, (page - 1) * limit);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(
        `SELECT n.id, n.user_id, u.name AS user_name, n.lead_id, n.channel, n.body, n.status, n.attempts,
                n.last_error, n.sent_at, n.next_attempt_at, n.created_at
           FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE ${where} ORDER BY n.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT count(*)::int AS n FROM notifications n WHERE ${where}`, countParams),
    ]);
    res.json({ data: rows, total: n, page, limit });
  } catch (err) { next(err); }
});

module.exports = router;

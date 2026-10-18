// Integrations admin (I5.1–I5.7) — owner: Musa. Mounted at /api/v1 → /integrations, /integrations/:provider, /integration-events.
// (Ali's routes/calendar.js handles /integrations/google/* and is mounted first.)
const express = require('express');
const { z } = require('zod');
const { q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { maskSecret } = require('../utils/crypto');
const { saveConfig, removeConfig, getConfig } = require('../services/integrationsStore');
const { recordEvent } = require('../services/integrationEvents');
const { registerWebhook, webhookUrl } = require('../services/messenger');

const router = express.Router();

const PROVIDERS = {
  telegram: {
    name: 'Messaging & alerts (Telegram bot)',
    purpose: 'Customers message the bot (creates contacts + leads, two-way chat in the Inbox); employees get escalation alerts from the same bot.',
    limits: [
      'A bot can only message people who have started a chat with it first — customers must message the bot before we can reply.',
      'Telegram confirms a message was accepted ("sent") but does not report delivered/read receipts to bots.',
      'Customers can send /stop to opt out and /start to opt back in. Employees send /myid to get their chat ID for Profile.',
      'Incoming messages need PUBLIC_URL to be https (the deployed Vercel URL).',
    ],
    schema: z.object({ bot_token: z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'Bot token looks like 123456:ABC…') }),
    hint: (c) => ({ bot_token: maskSecret(c.bot_token), bot: c.username ? `@${c.username}` : undefined }),
    test: async (c) => {
      const r = await fetch(`https://api.telegram.org/bot${c.bot_token}/getMe`, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (!j.ok) { const e = new Error(j.description || 'Telegram rejected the token'); e.status = r.status; throw e; }
      c.username = j.result.username;
      return { username: j.result.username };
    },
    after: async (ws, c) => registerWebhook(ws, c.bot_token),
  },
  googlepay: {
    name: 'Payments (Google Pay — TEST environment)',
    purpose: 'Send customers a payment link; they pay with the real Google Pay sheet and the opportunity updates automatically.',
    limits: [
      'TEST environment: no real money moves. Any card saved in the payer\'s Google account returns a test token.',
      'Every payment token is verified against Google\'s published signing keys before a payment is marked paid.',
      'Google Pay has no refund API or merchant dashboard in TEST mode, so refunds are recorded in this app by an authorised user.',
      'Payment links expire after 30 minutes; card details never reach our servers.',
    ],
    schema: z.object({
      merchant_name: z.string().trim().min(2, 'Shown to the customer in the Google Pay sheet').max(60),
      verification: z.enum(['strict', 'log_only']).default('strict'),
    }),
    hint: (c) => ({ merchant_name: c.merchant_name, environment: 'TEST', verification: c.verification }),
    test: async () => ({ environment: 'TEST' }),
  },
  google: {
    name: 'Calendar (Google)', purpose: 'Book appointments on employees\' real calendars.',
    limits: [
      'Each employee connects their own Google account from their Profile page.',
      'The Google app is in testing mode: only listed test users can connect, and connections may need renewing after 7 days.',
      'An employee without a connected calendar cannot be booked.',
    ],
  },
};

router.get('/integrations', requirePerm('integrations.manage'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const rows = (await q().query('SELECT * FROM integrations WHERE workspace_id = $1', [ws])).rows;
    const errors = (await q().query(
      `SELECT DISTINCT ON (provider, id) provider, kind, error, created_at, status FROM integration_events
        WHERE workspace_id = $1 AND status IN ('error','rejected') AND created_at > now() - interval '7 days'
        ORDER BY provider, id, created_at DESC`, [ws],
    )).rows.sort((a, b) => b.created_at - a.created_at);
    const lastEvent = (await q().query(
      `SELECT provider, max(created_at) FILTER (WHERE status IN ('ok','duplicate')) AS last_ok FROM integration_events WHERE workspace_id = $1 GROUP BY provider`, [ws],
    )).rows;
    const google = (await q().query(
      `SELECT count(*) FILTER (WHERE g.status = 'ok')::int AS connected, count(*) FILTER (WHERE g.status = 'needs_reconnect')::int AS needs_reconnect,
              (SELECT count(*)::int FROM users WHERE workspace_id = $1 AND is_active) AS users
         FROM google_tokens g WHERE g.workspace_id = $1`, [ws],
    )).rows[0];
        const data = Object.entries(PROVIDERS).map(([provider, meta]) => {
      const row = rows.find((r) => r.provider === provider) || {};
      const lastOk = [row.last_ok_at, lastEvent.find((e) => e.provider === provider)?.last_ok].filter(Boolean).sort().pop() || null;
      let status = row.status || 'not_connected';
      if (provider === 'google') status = google.connected ? (google.needs_reconnect ? 'error' : 'connected') : (google.needs_reconnect ? 'error' : 'not_connected');
      return {
        provider, name: meta.name, purpose: meta.purpose, limits: meta.limits, status,
        config_hint: row.config_hint || {}, last_ok_at: lastOk, last_error: row.last_error || null, last_error_at: row.last_error_at || null,
        recent_errors: errors.filter((e) => e.provider === provider).slice(0, 5),
        ...(provider === 'telegram' ? { webhook_urls: { inbound: webhookUrl(ws) }, webhook_note: 'Registered with Telegram automatically when you save the bot token.' } : {}),
        ...(provider === 'google' ? { users_connected: google.connected, users_needing_reconnect: google.needs_reconnect, users_total: google.users } : {}),
        configurable: Boolean(meta.schema),
      };
    });
    res.json({ data, workspace_id: ws });
  } catch (e) { next(e); }
});

router.put('/integrations/:provider', requirePerm('integrations.manage'), async (req, res, next) => {
  try {
    const meta = PROVIDERS[req.params.provider];
    if (!meta?.schema) throw httpError(404, 'Not found');
    const parsed = meta.schema.safeParse(req.body || {});
    if (!parsed.success) {
      const details = {}; for (const i of parsed.error.issues) details[i.path.join('.')] ??= i.message;
      return res.status(400).json({ error: 'Invalid input', details });
    }
    const cfg = parsed.data;
    const ws = req.user.ws;
    try {
      const info = await meta.test(cfg);
      await recordEvent({ ws, provider: req.params.provider, direction: 'out', kind: 'credentials.test', status: 'ok', detail: info });
    } catch (err) {
      await recordEvent({ ws, provider: req.params.provider, direction: 'out', kind: 'credentials.test', status: 'error', http_status: err.status || null, error: err.message });
      throw httpError(400, `The provider rejected these credentials: ${err.message}`);
    }
    const existed = Boolean(await getConfig(ws, req.params.provider));
    await saveConfig(ws, req.params.provider, cfg, meta.hint(cfg), req.user.id);
    let warning = null;
    if (meta.after) {
      try { const r = await meta.after(ws, cfg); warning = r?.warning || null; } catch (err) { warning = err.message; }
    }
    await audit(req, { event_type: existed ? 'integration.updated' : 'integration.connected', target_type: 'integration', target_id: req.params.provider, after: meta.hint(cfg) });
    res.json({ data: { provider: req.params.provider, status: 'connected', config_hint: meta.hint(cfg), warning } });
  } catch (e) { next(e); }
});

router.delete('/integrations/:provider', requirePerm('integrations.manage'), async (req, res, next) => {
  try {
    const meta = PROVIDERS[req.params.provider];
    if (!meta?.schema) throw httpError(404, 'Not found');
    await removeConfig(req.user.ws, req.params.provider);
    await audit(req, { event_type: 'integration.disconnected', target_type: 'integration', target_id: req.params.provider });
    res.json({ data: { provider: req.params.provider, status: 'not_connected' } });
  } catch (e) { next(e); }
});

router.get('/integration-events', requirePerm('integrations.manage'), async (req, res, next) => {
  try {
    const where = ['workspace_id = $1']; const params = [req.user.ws];
    if (PROVIDERS[req.query.provider] || req.query.provider === 'googlepay') { params.push(req.query.provider); where.push(`provider = $${params.length}`); }
    if (['ok', 'error', 'rejected', 'duplicate', 'retrying'].includes(req.query.status)) { params.push(req.query.status); where.push(`status = $${params.length}`); }
    if (['in', 'out'].includes(req.query.direction)) { params.push(req.query.direction); where.push(`direction = $${params.length}`); }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const w = where.join(' AND ');
    const [rows, total] = await Promise.all([
      q().query(`SELECT * FROM integration_events WHERE ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
      q().query(`SELECT count(*)::int AS n FROM integration_events WHERE ${w}`, params),
    ]);
    res.json({ data: rows.rows, total: total.rows[0].n, page, limit });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.PROVIDERS = PROVIDERS;

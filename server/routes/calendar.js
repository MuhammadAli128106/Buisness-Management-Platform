'use strict';
/**
 * Google Calendar connection + busy times (I3.1, I3.2, I3.4, I3.7) — owner: Ali. Mounted at /api/v1.
 *   GET    /integrations/google/connect    → redirect to Google consent (state = signed JWT {uid, ws}, 10 min)
 *   GET    /integrations/google/callback   → PUBLIC (auth-exempt in index/app), verified by the signed state
 *   GET    /integrations/google/status     → own connection status
 *   DELETE /integrations/google            → revoke + forget own tokens
 *   GET    /calendar/busy?user_id&from&to  → crm.view
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { getJwtSecret } = require('../utils/jwtSecret');
const { isUuid } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const google = require('../services/google');

const router = express.Router();

function back(res, params) {
  return res.redirect(`/profile?${new URLSearchParams(params).toString()}`);
}

router.get('/integrations/google/connect', (req, res) => {
  if (!google.isConfigured()) return back(res, { google: 'error', reason: 'Google Calendar is not set up on this server yet (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).' });
  const state = jwt.sign({ uid: req.user.id, ws: req.user.ws, purpose: 'google_oauth' }, getJwtSecret(), { expiresIn: '10m' });
  return res.redirect(google.authUrl(state));
});

router.get('/integrations/google/callback', async (req, res) => {
  let state;
  try {
    state = jwt.verify(String(req.query.state || ''), getJwtSecret());
    if (state.purpose !== 'google_oauth') throw new Error('bad purpose');
  } catch (e) {
    return back(res, { google: 'error', reason: 'The connection link expired or was tampered with. Please try again.' });
  }
  if (req.query.error) {
    return back(res, { google: 'error', reason: req.query.error === 'access_denied' ? 'You declined access in Google.' : `Google said: ${req.query.error}` });
  }
  try {
    const { rows: [user] } = await pool.query('SELECT id, name, email FROM users WHERE id = $1 AND workspace_id = $2 AND is_active', [state.uid, state.ws]);
    if (!user) return back(res, { google: 'error', reason: 'Your account is no longer active.' });
    const { email } = await google.connect({ ws: state.ws, userId: state.uid, code: String(req.query.code || '') });
    await audit({ user: { id: user.id, name: user.name }, ip: req.ip }, {
      ws: state.ws, event_type: 'integration.google_connected', target_type: 'user', target_id: user.id, after: { google_email: email },
    });
    return back(res, { google: 'connected' });
  } catch (err) {
    return back(res, { google: 'error', reason: err.message });
  }
});

router.get('/integrations/google/status', async (req, res, next) => {
  try {
    res.json({ data: { ...(await google.status({ ws: req.user.ws, userId: req.user.id })), configured: google.isConfigured() } });
  } catch (e) { next(e); }
});

router.delete('/integrations/google', async (req, res, next) => {
  try {
    const removed = await google.disconnect({ ws: req.user.ws, userId: req.user.id });
    if (removed) {
      await audit(req, { ws: req.user.ws, event_type: 'integration.google_disconnected', target_type: 'user', target_id: req.user.id });
    }
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.get('/calendar/busy', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const userId = isUuid(req.query.user_id) ? req.query.user_id : req.user.id;
    const { rows: [u] } = await pool.query('SELECT id FROM users WHERE id = $1 AND workspace_id = $2 AND is_active', [userId, req.user.ws]);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const from = new Date(req.query.from || Date.now());
    const to = new Date(req.query.to || Date.now() + 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 31 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: 'Invalid input', details: { from: 'Give a valid range of at most 31 days' } });
    }
    const result = await google.getBusy({ ws: req.user.ws, userId, from, to });
    res.json({ data: result });
  } catch (err) {
    if (err.status && err.status < 600) return res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

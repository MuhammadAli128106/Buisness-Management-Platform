// Auth: signup / login / logout / refresh / me (F1.1, Q1). Adapted from RSFM (PIN + 2FA removed).
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { withTransaction, queryOne, queryRun } = require('../db/index');
const { validate } = require('../middleware/validate');
const { requireAuth, loadUser } = require('../middleware/auth');
const { validatePassword } = require('../utils/passwordPolicy');
const { clearSessionCookie } = require('../utils/sessionCookie');
const { setCsrfCookie, clearCsrfCookie } = require('../utils/csrf');
const {
  issueSessionTokens, getRefreshTokenFromRequest, validateRefreshToken, revokeRefreshToken, clearRefreshCookie,
} = require('../utils/refreshToken');
const { audit } = require('../utils/audit');
const { createWorkspace } = require('../services/workspaceSetup');

const router = express.Router();

// Q1: repeated guessing is throttled per IP + email.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${rateLimit.ipKeyGenerator ? rateLimit.ipKeyGenerator(req.ip) : req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Too many login attempts. Wait 5 minutes and try again.' },
});
const signupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, message: { error: 'Too many signups from this network. Try again later.' } });

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, level: u.level, status: u.status, timezone: u.timezone,
    prefs: u.prefs, role_id: u.role_id, role_name: u.role_name, permissions: u.permissions, workspace: u.workspace,
  };
}

router.post('/signup', signupLimiter, validate({
  body: z.object({
    companyName: z.string().trim().min(2, 'Company name is required').max(80),
    name: z.string().trim().min(1, 'Your name is required').max(80),
    email: z.string().trim().email('Enter a valid email').max(160),
    password: z.string().max(200),
  }),
}), async (req, res, next) => {
  try {
    const pwErr = validatePassword(req.body.password);
    if (pwErr) return res.status(400).json({ error: pwErr, details: { password: pwErr } });
    const email = req.body.email.toLowerCase();
    if (await queryOne('SELECT 1 FROM users WHERE email = $1', [email])) {
      return res.status(409).json({ error: 'An account with this email already exists.', details: { email: 'Already registered' } });
    }
    const { owner, workspace } = await withTransaction((c) => createWorkspace(c, { ...req.body, email }));
    await issueSessionTokens(res, owner);
    setCsrfCookie(res);
    const user = await loadUser(owner.id, workspace.id);
    await audit({ user, ip: req.ip }, { event_type: 'workspace.created', target_type: 'workspace', target_id: workspace.id, after: { name: workspace.name } });
    res.status(201).json({ data: publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/login', loginLimiter, validate({
  body: z.object({ email: z.string().trim().min(1, 'Email is required'), password: z.string().min(1, 'Password is required') }),
}), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const row = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
    const ok = row && row.is_active && await bcrypt.compare(req.body.password, row.password_hash);
    if (!ok) {
      if (row) await audit({ user: { ws: row.workspace_id, id: null, name: 'Unknown' }, ip: req.ip }, { event_type: 'auth.login_failed', target_type: 'user', target_id: row.id, after: { email } });
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    await queryRun('UPDATE users SET last_login = now() WHERE id = $1', [row.id]);
    await issueSessionTokens(res, row);
    setCsrfCookie(res);
    res.json({ data: publicUser(await loadUser(row.id, row.workspace_id)) });
  } catch (e) { next(e); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const raw = getRefreshTokenFromRequest(req);
    const row = await validateRefreshToken(raw);
    if (!row) { clearRefreshCookie(res); return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
    await revokeRefreshToken(raw); // rotation
    await issueSessionTokens(res, row);
    setCsrfCookie(res);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res, next) => {
  try {
    await revokeRefreshToken(getRefreshTokenFromRequest(req));
    clearSessionCookie(res); clearRefreshCookie(res); clearCsrfCookie(res);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => {
  // keep a CSRF cookie present for long-lived sessions
  if (!req.cookies?.bmp_csrf) setCsrfCookie(res);
  res.json({ data: publicUser(req.user) });
});

module.exports = router;
module.exports.publicUser = publicUser;

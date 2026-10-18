// server/app.js — owner: Musa. The Express app (no listen). Used by server/index.js (long-running) and api/index.js (Vercel).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { requireAuth } = require('./middleware/auth');
const { requireCsrf } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1); // Vercel / tunnels sit behind one proxy
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cookieParser());

const API = '/api/v1';
const r = (name) => require(`./routes/${name}`);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get(`${API}/ping`, (_req, res) => res.json({ data: { ok: true } }));

// ── Public JSON routes ────────────────────────────────────────────────────────
app.use(`${API}/public/forms`, r('publicForms'));
app.use(`${API}/public/pay`, r('publicPay'));               // Google Pay link page (token = credential)
app.use(`${API}/webhooks/telegram`, r('webhooksTelegram')); // secret-token verified inside

// ── CSRF for everything cookie-authenticated below ────────────────────────────
app.use(API, requireCsrf);
app.use(`${API}/auth`, r('auth'));

// ── Authenticated API ─────────────────────────────────────────────────────────
const AUTH_EXEMPT = new Set(['/integrations/google/callback']);
app.use(API, (req, res, next) => (AUTH_EXEMPT.has(req.path) ? next() : requireAuth(req, res, next)));

// Ali (root-mounted routers define full sub-paths; mounted before Musa's /integrations)
app.use(API, r('calendar'));
app.use(API, r('availability'));
app.use(API, r('assignmentRules'));
app.use(API, r('telegram'));
app.use(`${API}/leads`, r('leads'));
app.use(`${API}/appointments`, r('appointments'));

// Musa
app.use(`${API}/users`, r('users'));
app.use(`${API}/roles`, r('roles'));
app.use(API, r('me'));
app.use(`${API}/companies`, r('companies'));
app.use(`${API}/contacts`, r('contacts'));
app.use(`${API}/opportunities`, r('opportunities'));
app.use(API, r('pipelines'));
app.use(`${API}/custom-fields`, r('customFields'));
app.use(`${API}/saved-lists`, r('savedLists'));
app.use(`${API}/notes`, r('notes'));
app.use(`${API}/activities`, r('activities'));
app.use(`${API}/export`, r('export'));
app.use(`${API}/audit`, r('audit'));
app.use(`${API}/dashboard`, r('dashboard'));
app.use(API, r('integrations'));
app.use(API, r('messaging'));
app.use(API, r('payments'));

app.use(API, (_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Client SPA (production build) ─────────────────────────────────────────────
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

module.exports = app;

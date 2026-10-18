'use strict';
/**
 * Google Calendar (I3) — owner: Ali.
 * Per-employee OAuth (each person consents to their own calendar). Tokens are encrypted at rest in
 * google_tokens and never leave the server (I3.2, I5.3). Access tokens refresh automatically;
 * invalid_grant (revoked / expired consent) flips the row to needs_reconnect (I3.2, I3.7).
 * Every Google call is recorded in integration_events (I5.4).
 */
const { google } = require('googleapis');
const { pool } = require('../db/index');
const { encrypt, decrypt } = require('../utils/crypto');
const { withRetry } = require('../utils/retry');
const { recordEvent } = require('./integrationEvents');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
];

function publicUrl() {
  return (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, '');
}
function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${publicUrl()}/api/v1/integrations/google/callback`
  );
}

function googleError(err) {
  const status = err?.response?.status || err?.code;
  const reason = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.response?.data?.error || err?.message;
  return { status: typeof status === 'number' ? status : null, reason: String(reason || 'Unknown Google error') };
}
function isInvalidGrant(err) {
  const data = err?.response?.data;
  return data?.error === 'invalid_grant' || /invalid_grant/i.test(err?.message || '');
}

function typedError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra || {});
  return e;
}

async function safeRecord(evt) {
  try { await recordEvent({ provider: 'google', direction: 'out', ...evt }); } catch (e) { /* never break the request */ }
}

// ───────── OAuth ─────────

function authUrl(state) {
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: SCOPES, state });
}

/** Exchange the code, store encrypted tokens. → { email } */
async function connect({ ws, userId, code }) {
  const client = oauthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (err) {
    const g = googleError(err);
    await safeRecord({ ws, kind: 'oauth.exchange', status: 'error', http_status: g.status, error: g.reason });
    throw typedError(400, `Google refused the connection: ${g.reason}`);
  }
  let email = null;
  if (tokens.id_token) {
    try { email = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')).email || null; } catch (e) { email = null; }
  }
  if (!tokens.refresh_token) {
    await safeRecord({ ws, kind: 'oauth.exchange', status: 'error', error: 'No refresh token returned' });
    throw typedError(400, 'Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
  }
  await pool.query(
    `INSERT INTO google_tokens (user_id, workspace_id, google_email, refresh_enc, access_enc, expires_at, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'ok', now())
     ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, google_email = EXCLUDED.google_email,
       refresh_enc = EXCLUDED.refresh_enc, access_enc = EXCLUDED.access_enc, expires_at = EXCLUDED.expires_at,
       status = 'ok', updated_at = now()`,
    [userId, ws, email, encrypt(tokens.refresh_token), tokens.access_token ? encrypt(tokens.access_token) : null,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null]
  );
  await safeRecord({ ws, kind: 'oauth.connected', status: 'ok', detail: { email } });
  return { email };
}

async function status({ ws, userId }) {
  const { rows: [row] } = await pool.query(
    'SELECT status, google_email, updated_at FROM google_tokens WHERE user_id = $1 AND workspace_id = $2', [userId, ws]
  );
  if (!row) return { status: 'not_connected', google_email: null };
  return { status: row.status, google_email: row.google_email, updated_at: row.updated_at };
}

async function disconnect({ ws, userId }) {
  const { rows: [row] } = await pool.query('SELECT refresh_enc FROM google_tokens WHERE user_id = $1 AND workspace_id = $2', [userId, ws]);
  if (!row) return false;
  try {
    await oauthClient().revokeToken(decrypt(row.refresh_enc));
    await safeRecord({ ws, kind: 'oauth.revoke', status: 'ok' });
  } catch (err) {
    // Already revoked on Google's side is fine; we still forget the tokens.
    await safeRecord({ ws, kind: 'oauth.revoke', status: 'error', error: googleError(err).reason });
  }
  await pool.query('DELETE FROM google_tokens WHERE user_id = $1 AND workspace_id = $2', [userId, ws]);
  return true;
}

// ───────── Authorised client for one employee ─────────

async function markNeedsReconnect(ws, userId, reason) {
  await pool.query(`UPDATE google_tokens SET status = 'needs_reconnect', updated_at = now() WHERE user_id = $1`, [userId]);
  await safeRecord({ ws, kind: 'oauth.refresh', status: 'error', error: reason || 'invalid_grant' });
}

/** → OAuth2 client with a fresh access token. Throws 409 not_connected / needs_reconnect. */
async function clientFor(ws, userId) {
  if (!isConfigured()) throw typedError(503, 'Google Calendar is not set up on this server yet (missing Google client ID).', { code: 'not_configured' });
  const { rows: [row] } = await pool.query('SELECT * FROM google_tokens WHERE user_id = $1 AND workspace_id = $2', [userId, ws]);
  if (!row) throw typedError(409, 'This person has not connected Google Calendar, so they can’t be booked.', { code: 'not_connected' });
  if (row.status === 'needs_reconnect') throw typedError(409, 'This person’s Google Calendar connection expired. They need to reconnect it on their Profile.', { code: 'needs_reconnect' });

  const client = oauthClient();
  client.setCredentials({
    refresh_token: decrypt(row.refresh_enc),
    access_token: row.access_enc ? decrypt(row.access_enc) : undefined,
    expiry_date: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
  });
  const expiresSoon = !row.expires_at || new Date(row.expires_at).getTime() < Date.now() + 60 * 1000;
  if (expiresSoon) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials({ ...credentials, refresh_token: credentials.refresh_token || decrypt(row.refresh_enc) });
      await pool.query(
        `UPDATE google_tokens SET access_enc = $2, expires_at = $3, refresh_enc = COALESCE($4, refresh_enc), updated_at = now() WHERE user_id = $1`,
        [userId, encrypt(credentials.access_token), credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          credentials.refresh_token ? encrypt(credentials.refresh_token) : null]
      );
    } catch (err) {
      if (isInvalidGrant(err)) {
        await markNeedsReconnect(ws, userId, googleError(err).reason);
        throw typedError(409, 'This person’s Google Calendar connection was revoked or expired. They need to reconnect it on their Profile.', { code: 'needs_reconnect' });
      }
      const g = googleError(err);
      await safeRecord({ ws, kind: 'oauth.refresh', status: 'error', http_status: g.status, error: g.reason });
      throw typedError(502, `Couldn’t reach Google Calendar: ${g.reason}`, { temporary: true });
    }
  }
  return client;
}

/** Run a Calendar API call with retries; an invalid_grant mid-call also flips needs_reconnect. */
async function call(ws, userId, kind, fn) {
  const auth = await clientFor(ws, userId);
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const result = await withRetry(() => fn(calendar), { attempts: 3, baseMs: 400 });
    await safeRecord({ ws, kind, status: 'ok', http_status: result?.status || 200, external_id: result?.data?.id || null });
    return result;
  } catch (err) {
    const g = googleError(err);
    await safeRecord({ ws, kind, status: 'error', http_status: g.status, error: g.reason });
    if (isInvalidGrant(err) || g.status === 401) {
      await markNeedsReconnect(ws, userId, g.reason);
      throw typedError(409, 'Google Calendar access was revoked. The employee needs to reconnect it on their Profile.', { code: 'needs_reconnect' });
    }
    throw typedError(g.status === 404 || g.status === 410 ? g.status : 502, `Google Calendar error: ${g.reason}`, { temporary: Boolean(err.temporary) });
  }
}

// ───────── Calendar operations ─────────

/** getBusy({ ws, userId, from, to }) → { status: 'ok'|'not_connected'|'needs_reconnect'|'not_configured', busy: [{start,end}] } */
async function getBusy({ ws, userId, from, to }) {
  try {
    const res = await call(ws, userId, 'freebusy.query', (cal) => cal.freebusy.query({
      requestBody: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: 'primary' }] },
    }));
    const busy = res.data?.calendars?.primary?.busy || [];
    return { status: 'ok', busy: busy.map((b) => ({ start: b.start, end: b.end })) };
  } catch (err) {
    if (err.code === 'not_connected' || err.code === 'needs_reconnect' || err.code === 'not_configured') return { status: err.code, busy: [], message: err.message };
    throw err;
  }
}

function eventBody({ title, description, startsAt, endsAt, timezone }) {
  return {
    summary: title,
    description: description || 'Booked from LeadGuard',
    start: { dateTime: new Date(startsAt).toISOString(), timeZone: timezone },
    end: { dateTime: new Date(endsAt).toISOString(), timeZone: timezone },
  };
}

/** → Google event id */
async function createEvent({ ws, userId, title, description, startsAt, endsAt, timezone }) {
  const res = await call(ws, userId, 'events.insert', (cal) => cal.events.insert({ calendarId: 'primary', requestBody: eventBody({ title, description, startsAt, endsAt, timezone }) }));
  return res.data.id;
}

async function updateEvent({ ws, userId, eventId, title, description, startsAt, endsAt, timezone }) {
  await call(ws, userId, 'events.patch', (cal) => cal.events.patch({ calendarId: 'primary', eventId, requestBody: eventBody({ title, description, startsAt, endsAt, timezone }) }));
}

async function deleteEvent({ ws, userId, eventId }) {
  try {
    await call(ws, userId, 'events.delete', (cal) => cal.events.delete({ calendarId: 'primary', eventId }));
  } catch (err) {
    if (err.status === 404 || err.status === 410) return; // already gone in Google — fine
    throw err;
  }
}

module.exports = { isConfigured, authUrl, connect, status, disconnect, getBusy, createEvent, updateEvent, deleteEvent, SCOPES };

// Rotating refresh tokens, stored hashed (adapted from RSFM).
const crypto = require('crypto');
const { queryOne, queryRun } = require('../db/index');
const { signAccessToken, setSessionCookie, baseCookie } = require('./sessionCookie');

const REFRESH_COOKIE = 'bmp_refresh';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const generateRefreshToken = () => crypto.randomBytes(32).toString('hex');

function setRefreshCookie(res, raw) { res.cookie(REFRESH_COOKIE, raw, { ...baseCookie(), path: '/api/v1/auth', maxAge: REFRESH_MAX_AGE_MS }); }
function clearRefreshCookie(res) { res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/v1/auth' }); }
const getRefreshTokenFromRequest = (req) => req.cookies?.[REFRESH_COOKIE] || null;

async function storeRefreshToken(userId, raw) {
  await queryRun(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
    [userId, hashToken(raw)],
  );
}
async function revokeRefreshToken(raw) {
  if (!raw) return;
  await queryRun(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(raw)]);
}
async function revokeAllUserRefreshTokens(userId) {
  await queryRun(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}
async function validateRefreshToken(raw) {
  if (!raw) return null;
  return queryOne(
    `SELECT u.id, u.workspace_id FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND u.is_active`,
    [hashToken(raw)],
  );
}

/** Issue access cookie + fresh refresh cookie for a user row {id, workspace_id}. */
async function issueSessionTokens(res, user) {
  setSessionCookie(res, signAccessToken(user));
  const raw = generateRefreshToken();
  await storeRefreshToken(user.id, raw);
  setRefreshCookie(res, raw);
}

module.exports = {
  REFRESH_COOKIE, setRefreshCookie, clearRefreshCookie, getRefreshTokenFromRequest,
  revokeRefreshToken, revokeAllUserRefreshTokens, validateRefreshToken, issueSessionTokens,
};

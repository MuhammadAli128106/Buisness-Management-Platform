// Access-token cookie (adapted from RSFM). JWT carries only {id, ws}; everything else is loaded from DB per request.
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./jwtSecret');

const SESSION_COOKIE = 'bmp_session';
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === 'production';
const baseCookie = () => ({ httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/' });

function signAccessToken(user) {
  return jwt.sign({ id: user.id, ws: user.workspace_id || user.ws }, getJwtSecret(), { expiresIn: '15m' });
}
function setSessionCookie(res, token) { res.cookie(SESSION_COOKIE, token, { ...baseCookie(), maxAge: ACCESS_MAX_AGE_MS }); }
function clearSessionCookie(res) { res.clearCookie(SESSION_COOKIE, baseCookie()); }
function getTokenFromRequest(req) {
  if (req.cookies?.[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = { SESSION_COOKIE, signAccessToken, setSessionCookie, clearSessionCookie, getTokenFromRequest, baseCookie };

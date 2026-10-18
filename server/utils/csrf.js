// Double-submit CSRF token (adapted from RSFM). Cookie is readable by JS; client echoes it in x-csrf-token.
const crypto = require('crypto');
const { SESSION_COOKIE } = require('./sessionCookie');

const CSRF_COOKIE = 'bmp_csrf';
const isProduction = () => process.env.NODE_ENV === 'production';

function setCsrfCookie(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: isProduction(), sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 * 1000 });
  return token;
}
function clearCsrfCookie(res) { res.clearCookie(CSRF_COOKIE, { path: '/' }); }

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = Buffer.from(a); const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function validateCsrf(req) { return timingSafeEqual(req.cookies?.[CSRF_COOKIE], req.headers['x-csrf-token']); }
const hasSessionCookie = (req) => Boolean(req.cookies?.[SESSION_COOKIE]);

module.exports = { CSRF_COOKIE, setCsrfCookie, clearCsrfCookie, validateCsrf, hasSessionCookie };

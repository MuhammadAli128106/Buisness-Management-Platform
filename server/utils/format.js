// Small server-side formatting helpers.
const money = (cents, currency = 'USD') => `${(Number(cents || 0) / 100).toFixed(2)} ${String(currency).toUpperCase()}`;

/** Normalise a phone to E.164-ish: strips "whatsapp:", spaces, dashes. Pakistani 03xx → +923xx. */
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/^whatsapp:/i, '').replace(/[\s\-()]/g, '');
  if (/^03\d{9}$/.test(p)) p = `+92${p.slice(1)}`;
  if (/^00\d+$/.test(p)) p = `+${p.slice(2)}`;
  if (/^\d{10,15}$/.test(p)) p = `+${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
const fieldKey = (label) => String(label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

module.exports = { money, normalizePhone, slugify, fieldKey };

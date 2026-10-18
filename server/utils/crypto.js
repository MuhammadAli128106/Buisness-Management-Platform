// AES-256-GCM for integration secrets & OAuth tokens (I5.3). Key = APP_ENC_KEY (64 hex chars).
const crypto = require('crypto');

function key() {
  const hex = process.env.APP_ENC_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (process.env.NODE_ENV === 'production') throw new Error('APP_ENC_KEY must be 64 hex chars');
  return crypto.createHash('sha256').update('dev-only-enc-key').digest();
}

/** encrypt(obj|string) → "v1:iv:tag:data" (base64 parts) */
function encrypt(value) {
  const plain = typeof value === 'string' ? `s:${value}` : `j:${JSON.stringify(value)}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** decrypt(string) → original obj|string (null on falsy input) */
function decrypt(payload) {
  if (!payload) return null;
  const [, iv, tag, data] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  return plain.startsWith('j:') ? JSON.parse(plain.slice(2)) : plain.slice(2);
}

/** "AC1234567890abcd" → "AC…abcd" — the only form a secret is ever shown in. */
function maskSecret(s) {
  if (!s) return null;
  const str = String(s);
  return str.length <= 8 ? '••••' : `${str.slice(0, 4)}…${str.slice(-4)}`;
}

module.exports = { encrypt, decrypt, maskSecret };

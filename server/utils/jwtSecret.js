function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set');
    return 'dev-only-insecure-secret-change-me';
  }
  return s;
}
module.exports = { getJwtSecret };

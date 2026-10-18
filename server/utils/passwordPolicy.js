const WEAK = new Set(['password', 'password123', '12345678', 'qwerty123', 'admin123', 'letmein1']);
function validatePassword(pw) {
  if (!pw || typeof pw !== 'string') return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (WEAK.has(pw.toLowerCase())) return 'That password is too common';
  return null;
}
module.exports = { validatePassword };

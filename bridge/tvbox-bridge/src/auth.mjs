import crypto from 'node:crypto';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorized(req, token, { allowInsecureDevelopment = false } = {}) {
  if (!token) return allowInsecureDevelopment;
  const header = req.headers.authorization || '';
  return safeEqual(header, `Bearer ${token}`);
}

import crypto from 'node:crypto';

export const AUTH_COOKIE_NAME = 'openstream_session';
export const PROXY_TOKEN_BUCKET_MS = 5 * 60 * 1000;
export const RESOURCE_TOKEN_BUCKET_MS = 6 * 60 * 60 * 1000;
// Existing deployments accepted any non-empty PASSWORD. Keep that contract so
// an auth upgrade never locks users out; deployment docs still recommend 16+.
export const MIN_PASSWORD_LENGTH = 1;
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function getPassword(env = process.env) {
  return String(env.PASSWORD || '');
}

function getSigningPassword(env = process.env) {
  const password = getPassword(env);
  return password.length >= MIN_PASSWORD_LENGTH ? password : '';
}

function getSessionTtlSeconds(env = process.env) {
  const configured = Number.parseInt(env.AUTH_SESSION_TTL_SECONDS || '', 10);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 90 * 24 * 60 * 60)
    : DEFAULT_SESSION_TTL_SECONDS;
}

function deriveKey(password, purpose) {
  return crypto
    .createHmac('sha256', password)
    .update(`openstream:${purpose}:v1`)
    .digest();
}

function sign(value, password, purpose) {
  return crypto
    .createHmac('sha256', deriveKey(password, purpose))
    .update(value)
    .digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const index = entry.indexOf('=');
      if (index <= 0) return cookies;
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (_) {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

export function isPasswordConfigured(env = process.env) {
  return Boolean(getSigningPassword(env));
}

export function verifyPassword(password, env = process.env) {
  const configured = getSigningPassword(env);
  if (!configured || typeof password !== 'string') return false;
  const expected = crypto.createHash('sha256').update(configured).digest('hex');
  const received = crypto.createHash('sha256').update(password).digest('hex');
  return safeEqual(received, expected);
}

export function createSessionToken(env = process.env, now = Date.now()) {
  const password = getSigningPassword(env);
  if (!password) return '';
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: now,
    exp: now + getSessionTtlSeconds(env) * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload, password, 'session')}`;
}

export function verifySessionToken(token, env = process.env, now = Date.now()) {
  const password = getSigningPassword(env);
  if (!password || typeof token !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, sign(payload, password, 'session'))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed?.v === 1 &&
      Number.isFinite(parsed.iat) &&
      Number.isFinite(parsed.exp) &&
      parsed.iat <= now + 60_000 &&
      parsed.exp > now;
  } catch (_) {
    return false;
  }
}

export function isRequestAuthenticated(req, env = process.env, now = Date.now()) {
  const cookieHeader = req?.headers?.cookie || req?.headers?.Cookie || '';
  const token = parseCookies(cookieHeader)[AUTH_COOKIE_NAME];
  return verifySessionToken(token, env, now);
}

function requestUsesHttps(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwarded) return forwarded === 'https';
  return Boolean(req?.socket?.encrypted);
}

export function createSessionCookie(req, token, env = process.env) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${getSessionTtlSeconds(env)}`
  ];
  if (requestUsesHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export function createClearedSessionCookie(req) {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (requestUsesHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export function createProxyToken(env = process.env, now = Date.now()) {
  const password = getSigningPassword(env);
  if (!password) return null;
  const bucket = Math.floor(now / PROXY_TOKEN_BUCKET_MS) * PROXY_TOKEN_BUCKET_MS;
  return {
    token: sign(String(bucket), password, 'proxy'),
    bucket,
    expiresAt: bucket + (2 * PROXY_TOKEN_BUCKET_MS)
  };
}

export function verifyProxyToken(token, bucketValue, env = process.env, now = Date.now()) {
  const password = getSigningPassword(env);
  const bucket = Number(bucketValue);
  if (
    !password ||
    !token ||
    !Number.isFinite(bucket) ||
    bucket % PROXY_TOKEN_BUCKET_MS !== 0 ||
    bucket > now + 60_000 ||
    now - bucket >= 2 * PROXY_TOKEN_BUCKET_MS
  ) {
    return false;
  }
  return safeEqual(token, sign(String(bucket), password, 'proxy'));
}

export function createResourceProxyToken(targetUrl, env = process.env, now = Date.now()) {
  const password = getSigningPassword(env);
  const target = String(targetUrl || '');
  if (!password || !target) return null;
  const bucket = Math.floor(now / RESOURCE_TOKEN_BUCKET_MS) * RESOURCE_TOKEN_BUCKET_MS;
  return {
    token: sign(`${bucket}\n${target}`, password, 'proxy-resource'),
    bucket,
    expiresAt: bucket + (2 * RESOURCE_TOKEN_BUCKET_MS)
  };
}

export function verifyResourceProxyToken(
  targetUrl,
  token,
  bucketValue,
  env = process.env,
  now = Date.now()
) {
  const password = getSigningPassword(env);
  const target = String(targetUrl || '');
  const bucket = Number(bucketValue);
  if (
    !password ||
    !target ||
    !token ||
    !Number.isFinite(bucket) ||
    bucket % RESOURCE_TOKEN_BUCKET_MS !== 0 ||
    bucket > now + 60_000 ||
    now - bucket >= 2 * RESOURCE_TOKEN_BUCKET_MS
  ) {
    return false;
  }
  return safeEqual(token, sign(`${bucket}\n${target}`, password, 'proxy-resource'));
}

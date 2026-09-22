import crypto from 'node:crypto';

const COOKIE = 'openstream_human';
const TTL = 6 * 60 * 60;
const attempts = new Map();
export function humanConfig(env = process.env) {
  const enabled = env.TURNSTILE_ENABLED === 'true' || !!(env.TURNSTILE_SITE_KEY || env.TURNSTILE_SECRET_KEY);
  const hosts = String(env.TURNSTILE_HOSTNAMES || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const key = env.TURNSTILE_SESSION_SECRET || env.TURNSTILE_SECRET_KEY || '';
  const ready = !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && hosts.length && key.length >= 32);
  return { enabled, ready, siteKey: ready ? env.TURNSTILE_SITE_KEY : '', hosts, key };
}
function signature(payload, key) {
  return crypto.createHmac('sha256', key).update('openstream:human:v1:' + payload).digest('base64url');
}
function agent(req) {
  return crypto.createHash('sha256').update(String(req.headers?.['user-agent'] || '')).digest('base64url');
}
export function humanStatus(req, env = process.env, now = Date.now()) {
  const config = humanConfig(env);
  if (!config.enabled) return 200;
  if (!config.ready) return 503;
  const value = String(req.headers?.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
  if (value.length > 2048) return 428;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra) return 428;
  const expected = Buffer.from(signature(payload, config.key)), actual = Buffer.from(mac);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return 428;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.v === 1 && data.exp > now && data.exp <= now + TTL * 1000 && data.ua === agent(req) ? 200 : 428;
  } catch { return 428; }
}
export function humanCookie(req, env = process.env, now = Date.now(), clear = false) {
  const payload = Buffer.from(JSON.stringify({v:1, exp:now + TTL * 1000, ua:agent(req)})).toString('base64url');
  const secure = env.VERCEL === '1' || req.socket?.encrypted;
  const value = clear ? '' : payload + '.' + signature(payload, humanConfig(env).key);
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : TTL}${secure ? '; Secure' : ''}`;
}
export function verificationAllowed(req, env = process.env, now = Date.now()) {
  const address = env.VERCEL === '1' ? String(req.headers?.['x-vercel-forwarded-for'] || '').split(',')[0] : req.socket?.remoteAddress;
  const key = address || 'unknown';
  let entry = attempts.get(key);
  if (!entry || entry.until <= now) { entry = {until:now + 60000, count:0}; attempts.set(key, entry); }
  while (attempts.size > 2000) attempts.delete(attempts.keys().next().value);
  return ++entry.count <= 10;
}
export async function verifyHuman(token, {env = process.env, fetchImpl = globalThis.fetch} = {}) {
  const config = humanConfig(env);
  if (!config.ready || typeof token !== 'string' || !token.length || token.length > 2048) return false;
  const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', headers:{'Content-Type':'application/json'}, redirect:'error', signal:AbortSignal.timeout(7000),
    body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY, response:token})
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.action === 'browse' && config.hosts.includes(String(result.hostname || '').toLowerCase());
}
export function enforceHuman(req, res, env = process.env) {
  const status = humanStatus(req, env);
  if (status === 200) return true;
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).json({code:status === 428 ? 'human_verification_required' : 'human_verification_unavailable', message:status === 428 ? '请完成安全验证' : '安全验证暂不可用，请稍后重试'});
  return false;
}

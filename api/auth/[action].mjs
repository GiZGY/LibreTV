import {
  createClearedSessionCookie,
  createProxyToken,
  createSessionCookie,
  createSessionToken,
  isPasswordConfigured,
  isRequestAuthenticated,
  verifyPassword
} from '../../server/auth-session.mjs';

const attempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_BODY_BYTES = 4096;

function normalizeAction(value) {
  return String(Array.isArray(value) ? value[0] : value || '').replace(/^\/+|\/+$/g, '');
}

function firstAddress(value) {
  return String(value || '').split(',')[0].trim();
}

function clientKey(req, env = process.env) {
  const socketAddress = firstAddress(req.socket?.remoteAddress) || 'unknown';
  if (env.VERCEL === '1') {
    return firstAddress(
      req.headers?.['x-vercel-forwarded-for'] ||
      req.headers?.['x-forwarded-for']
    ) || socketAddress;
  }
  if (env.TRUST_PROXY_HEADERS === 'true') {
    return firstAddress(
      req.headers?.['x-forwarded-for'] ||
      req.headers?.['x-real-ip']
    ) || socketAddress;
  }
  return socketAddress;
}

function readAttempt(key) {
  const value = attempts.get(key);
  if (!value || value.resetAt <= Date.now()) {
    attempts.delete(key);
    return { count: 0, resetAt: Date.now() + ATTEMPT_WINDOW_MS };
  }
  return value;
}

function recordFailure(key) {
  const value = readAttempt(key);
  value.count += 1;
  attempts.set(key, value);
  while (attempts.size > 500) attempts.delete(attempts.keys().next().value);
  return value;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) throw new Error('Request body too large');
    return JSON.parse(req.body || '{}');
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function writeJson(res, status, body) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  const action = normalizeAction(req.query?.action ?? req.params?.action);
  const configured = isPasswordConfigured(process.env);

  if (action === 'status' && req.method === 'GET') {
    const authenticated = configured && isRequestAuthenticated(req, process.env);
    return writeJson(res, 200, {
      configured,
      authenticated,
      proxy: authenticated ? createProxyToken(process.env) : null
    });
  }

  if (action === 'login' && req.method === 'POST') {
    if (!configured) {
      return writeJson(res, 503, {
        configured: false,
        authenticated: false,
        error: 'PASSWORD is not configured'
      });
    }

    const key = clientKey(req);
    const currentAttempt = readAttempt(key);
    if (currentAttempt.count >= MAX_ATTEMPTS) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((currentAttempt.resetAt - Date.now()) / 1000))));
      return writeJson(res, 429, { configured: true, authenticated: false, error: 'Too many attempts' });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (_) {
      return writeJson(res, 400, { configured: true, authenticated: false, error: 'Invalid request body' });
    }

    if (!verifyPassword(body?.password, process.env)) {
      recordFailure(key);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return writeJson(res, 401, { configured: true, authenticated: false, error: 'Invalid password' });
    }

    attempts.delete(key);
    const token = createSessionToken(process.env);
    res.setHeader('Set-Cookie', createSessionCookie(req, token, process.env));
    return writeJson(res, 200, {
      configured: true,
      authenticated: true,
      proxy: createProxyToken(process.env)
    });
  }

  if (action === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', createClearedSessionCookie(req));
    return writeJson(res, 200, { configured, authenticated: false });
  }

  res.setHeader('Allow', action === 'status' ? 'GET' : 'POST');
  return writeJson(res, 405, { configured, authenticated: false, error: 'Method not allowed' });
}

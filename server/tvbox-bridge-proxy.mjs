import crypto from 'node:crypto';
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

const STATUS = Object.freeze({
  READY: 'ready',
  TIMEOUT: 'timeout',
  UNSUPPORTED: 'unsupported',
  LOGIN_REQUIRED: 'login_required',
  NO_RESULT: 'no_result',
  ERROR: 'error'
});

const ALLOWED_ACTIONS = new Set(['health', 'search', 'detail', 'episodes', 'play', 'sources']);
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_INFLIGHT = 48;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESPONSE_CACHE_LIMIT = 160;
const responseCache = new Map();
const inFlightRequests = new Map();
let activeUpstreamRequests = 0;
const READY_CACHE_POLICIES = Object.freeze({
  health: { browserMaxAge: 10, memoryTtlMs: 30_000 },
  sources: { browserMaxAge: 60, memoryTtlMs: 300_000 },
  search: { browserMaxAge: 30, memoryTtlMs: 60_000 },
  detail: { browserMaxAge: 60, memoryTtlMs: 300_000 },
  episodes: { browserMaxAge: 60, memoryTtlMs: 300_000 }
});
const CACHEABLE_ACTIONS = new Set(Object.keys(READY_CACHE_POLICIES));
const ACTION_QUERY_SCHEMAS = Object.freeze({
  health: [],
  sources: [],
  search: [
    { name: 'sourceKey', required: true, maxLength: 64 },
    { name: 'wd', aliases: ['keyword'], required: true, maxLength: 120 }
  ],
  detail: [
    { name: 'sourceKey', required: true, maxLength: 64 },
    { name: 'id', required: true, maxLength: 512 }
  ],
  episodes: [
    { name: 'sourceKey', required: true, maxLength: 64 },
    { name: 'id', required: true, maxLength: 512 }
  ],
  play: [
    { name: 'sourceKey', required: true, maxLength: 64 },
    { name: 'id', required: true, maxLength: 512 },
    { name: 'flag', maxLength: 128 },
    { name: 'episode', defaultValue: '0', pattern: /^\d{1,8}$/ }
  ]
});

function normalizeAction(action) {
  const value = Array.isArray(action) ? action[0] : action;
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function isForbiddenAddress(address) {
  try {
    let parsed = ipaddr.parse(String(address || '').replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }
    return parsed.range() !== 'unicast';
  } catch (_) {
    return true;
  }
}

function isForbiddenHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return true;
  }
  return ipaddr.isValid(host) ? isForbiddenAddress(host) : false;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, {
    family: options?.family || 0,
    hints: options?.hints || 0,
    all: true,
    verbatim: true
  }, (error, addresses) => {
    if (error) return callback(error);
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.some(({ address }) => isForbiddenAddress(address))
    ) {
      const blocked = new Error('TVBox bridge address is not public');
      blocked.code = 'ERR_BLOCKED_ADDRESS';
      return callback(blocked);
    }
    if (options?.all) return callback(null, addresses);
    const selected = addresses[0];
    return callback(null, selected.address, selected.family);
  });
}

const secureBridgeDispatcher = new Agent({
  connect: { lookup: safeLookup }
});

async function secureBridgeFetch(url, options) {
  return undiciFetch(url, {
    ...options,
    redirect: 'manual',
    dispatcher: secureBridgeDispatcher
  });
}

function normalizePublicBridgeUrl(rawUrl, { base = false } = {}) {
  try {
    const url = new URL(String(rawUrl || '').trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isForbiddenHostname(url.hostname)
    ) {
      return null;
    }
    if (base) {
      url.pathname = url.pathname.replace(/\/+$/, '');
      url.search = '';
    }
    url.hash = '';
    return url;
  } catch (_) {
    return null;
  }
}

export function validateBridgeBaseUrl(rawUrl) {
  return normalizePublicBridgeUrl(rawUrl, { base: true });
}

function getTimeoutMs(env = {}) {
  const value = Number.parseInt(env.TVBOX_BRIDGE_TIMEOUT_MS || '', 10);
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 30_000)
    : DEFAULT_TIMEOUT_MS;
}

function getMaxInflight(env = {}) {
  const value = Number.parseInt(env.TVBOX_BRIDGE_MAX_INFLIGHT || '', 10);
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 256)
    : DEFAULT_MAX_INFLIGHT;
}

function getMaxResponseBytes(env = {}) {
  const value = Number.parseInt(env.TVBOX_BRIDGE_MAX_RESPONSE_BYTES || '', 10);
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 8 * 1024 * 1024)
    : DEFAULT_MAX_RESPONSE_BYTES;
}

function readScalarQueryValue(query, names) {
  for (const name of names) {
    const value = query?.[name];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length !== 1) return { error: `Repeated query parameter: ${name}` };
      return { value: String(value[0]).trim() };
    }
    if (typeof value === 'object') return { error: `Invalid query parameter: ${name}` };
    return { value: String(value).trim() };
  }
  return { value: '' };
}

function normalizeActionQuery(action, query = {}) {
  const schema = ACTION_QUERY_SCHEMAS[action];
  if (!schema) return { error: 'Unsupported TVBox bridge action' };

  const params = {};
  for (const field of schema) {
    const result = readScalarQueryValue(query, [field.name, ...(field.aliases || [])]);
    if (result.error) return result;
    const value = result.value || field.defaultValue || '';
    if (field.required && !value) return { error: `Missing query parameter: ${field.name}` };
    if (value.length > (field.maxLength || 1024)) {
      return { error: `Query parameter too long: ${field.name}` };
    }
    if (value && field.pattern && !field.pattern.test(value)) {
      return { error: `Invalid query parameter: ${field.name}` };
    }
    if (value) params[field.name] = value;
  }
  return { params };
}

function appendNormalizedQueryParams(targetUrl, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    targetUrl.searchParams.set(key, value);
  });
}

function buildBridgeActionUrl(bridgeBaseUrl, action) {
  const base = bridgeBaseUrl.toString().replace(/\/+$/, '');
  return new URL(`${base}/api/tvbox/${action}`);
}

function createStatusResponse(status, message, extra = {}, httpStatus) {
  return {
    httpStatus: httpStatus || (status === STATUS.UNSUPPORTED ? 501 : 200),
    body: {
      status,
      message,
      ...extra
    }
  };
}

function readCachedResponse(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, cached);
  return cached.value;
}

function writeCachedResponse(key, value, ttlMs) {
  responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (responseCache.size > RESPONSE_CACHE_LIMIT) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

function getCachePolicy(action, status) {
  if (!CACHEABLE_ACTIONS.has(action)) return null;
  if (status === STATUS.READY) return READY_CACHE_POLICIES[action];
  if (status === STATUS.NO_RESULT) {
    return { browserMaxAge: 5, memoryTtlMs: 20_000 };
  }
  if (status === STATUS.LOGIN_REQUIRED) {
    return { browserMaxAge: 0, memoryTtlMs: 30_000, noStore: true };
  }
  return null;
}

function cacheScopeForEnvironment(env = {}) {
  return crypto
    .createHash('sha256')
    .update(`${env.TVBOX_BRIDGE_URL || ''}\0${env.TVBOX_BRIDGE_TOKEN || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function responseTooLarge(maxBytes) {
  const error = new Error(`TVBox bridge response exceeds ${maxBytes} bytes`);
  error.code = 'RESPONSE_TOO_LARGE';
  return error;
}

async function readResponseTextLimited(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw responseTooLarge(maxBytes);
  }
  if (!response.body?.getReader) {
    const text = String(await response.text());
    if (Buffer.byteLength(text) > maxBytes) throw responseTooLarge(maxBytes);
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) throw responseTooLarge(maxBytes);
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch (_) {}
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchWithValidatedRedirects(fetchImpl, initialUrl, options) {
  let currentUrl = initialUrl.toString();
  const effectiveFetch = fetchImpl === globalThis.fetch ? secureBridgeFetch : fetchImpl;
  const authenticatedOrigin = options?.headers?.Authorization ? initialUrl.origin : '';

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const validated = normalizePublicBridgeUrl(currentUrl);
    if (!validated) {
      const error = new Error('TVBox bridge redirect target is not public');
      error.code = 'ERR_BLOCKED_ADDRESS';
      throw error;
    }
    if (authenticatedOrigin && validated.origin !== authenticatedOrigin) {
      const error = new Error('TVBox bridge authenticated redirect changed origin');
      error.code = 'ERR_BLOCKED_ADDRESS';
      throw error;
    }

    const response = await effectiveFetch(validated.toString(), {
      ...options,
      redirect: 'manual'
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    await response.body?.cancel?.().catch(() => {});
    if (!location || redirects >= MAX_REDIRECTS) {
      const error = new Error(location ? 'Too many TVBox bridge redirects' : 'Invalid TVBox bridge redirect');
      error.code = 'ERR_BLOCKED_ADDRESS';
      throw error;
    }
    currentUrl = new URL(location, validated).toString();
  }

  throw new Error('Too many TVBox bridge redirects');
}

async function requestBridge(targetUrl, env, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { Accept: 'application/json' };
    if (env.TVBOX_BRIDGE_TOKEN) {
      headers.Authorization = `Bearer ${env.TVBOX_BRIDGE_TOKEN}`;
    }

    const response = await fetchWithValidatedRedirects(fetchImpl, targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel?.().catch(() => {});
      return createStatusResponse(STATUS.UNSUPPORTED, 'TVBox bridge authorization failed');
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await readResponseTextLimited(response, getMaxResponseBytes(env));
    let body;
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(text || '{}');
      } catch (_) {
        body = {};
      }
    } else {
      body = { status: STATUS.ERROR, message: text };
    }

    return {
      httpStatus: response.status,
      body: {
        status: body.status || (response.ok ? STATUS.READY : STATUS.ERROR),
        ...body
      }
    };
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    if (error?.code === 'ERR_BLOCKED_ADDRESS' || error?.cause?.code === 'ERR_BLOCKED_ADDRESS') {
      return createStatusResponse(STATUS.UNSUPPORTED, 'TVBox bridge target was blocked');
    }
    if (error?.code === 'RESPONSE_TOO_LARGE') {
      return createStatusResponse(STATUS.ERROR, 'TVBox bridge response was too large');
    }
    return createStatusResponse(
      isTimeout ? STATUS.TIMEOUT : STATUS.ERROR,
      isTimeout ? 'TVBox bridge request timed out' : 'TVBox bridge request failed'
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function proxyTvboxBridgeRequest({ action, query = {}, env = process.env, fetchImpl = globalThis.fetch }) {
  const normalizedAction = normalizeAction(action);
  if (!ALLOWED_ACTIONS.has(normalizedAction)) {
    return createStatusResponse(STATUS.UNSUPPORTED, 'Unsupported TVBox bridge action', { action: normalizedAction });
  }

  const bridgeBaseUrl = validateBridgeBaseUrl(env.TVBOX_BRIDGE_URL);
  if (!bridgeBaseUrl) {
    return createStatusResponse(STATUS.UNSUPPORTED, 'TVBox bridge is not configured');
  }
  if (env.TVBOX_BRIDGE_TOKEN && bridgeBaseUrl.protocol !== 'https:') {
    return createStatusResponse(STATUS.UNSUPPORTED, 'Authenticated TVBox bridge requires HTTPS');
  }

  if (typeof fetchImpl !== 'function') {
    return createStatusResponse(STATUS.ERROR, 'Fetch runtime is unavailable');
  }

  const normalizedQuery = normalizeActionQuery(normalizedAction, query);
  if (normalizedQuery.error) {
    return createStatusResponse(
      STATUS.UNSUPPORTED,
      normalizedQuery.error,
      { action: normalizedAction },
      400
    );
  }

  const targetUrl = buildBridgeActionUrl(bridgeBaseUrl, normalizedAction);
  appendNormalizedQueryParams(targetUrl, normalizedQuery.params);
  const isCacheable = CACHEABLE_ACTIONS.has(normalizedAction);
  const cacheKey = [
    cacheScopeForEnvironment(env),
    normalizedAction,
    JSON.stringify(normalizedQuery.params),
    `timeout=${getTimeoutMs(env)}`
  ].join('|');
  if (isCacheable) {
    const cached = readCachedResponse(cacheKey);
    if (cached) return { ...cached, cacheStatus: 'HIT' };
    if (inFlightRequests.has(cacheKey)) {
      const coalesced = await inFlightRequests.get(cacheKey);
      return { ...coalesced, cacheStatus: 'COALESCED' };
    }
  }

  if (activeUpstreamRequests >= getMaxInflight(env)) {
    return createStatusResponse(
      STATUS.TIMEOUT,
      'TVBox bridge proxy is busy',
      {},
      503
    );
  }

  activeUpstreamRequests += 1;
  const request = requestBridge(targetUrl, env, fetchImpl, getTimeoutMs(env))
    .then((result) => {
      const effectivePolicy = getCachePolicy(normalizedAction, result.body?.status);
      const withMetadata = {
        ...result,
        cacheStatus: 'MISS',
        cachePolicy: effectivePolicy
      };
      if (effectivePolicy) {
        writeCachedResponse(cacheKey, withMetadata, effectivePolicy.memoryTtlMs);
      }
      return withMetadata;
    })
    .finally(() => {
      activeUpstreamRequests = Math.max(0, activeUpstreamRequests - 1);
      inFlightRequests.delete(cacheKey);
    });

  if (isCacheable) inFlightRequests.set(cacheKey, request);
  return request;
}

export function writeBridgeJsonResponse(res, result) {
  res.status(result.httpStatus || 200);
  if (result.cachePolicy && !result.cachePolicy.noStore) {
    const policy = result.cachePolicy;
    res.setHeader('Cache-Control', `private, max-age=${policy.browserMaxAge}`);
  } else {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (result.cacheStatus) res.setHeader('X-OpenStream-Cache', result.cacheStatus);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(result.body);
}

export { STATUS };

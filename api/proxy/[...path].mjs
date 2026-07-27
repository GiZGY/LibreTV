import dns from 'node:dns';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  createResourceProxyToken,
  isRequestAuthenticated,
  verifyProxyToken,
  verifyResourceProxyToken
} from '../../server/auth-session.mjs';

const DEBUG_ENABLED = process.env.DEBUG === 'true';
const BINARY_CACHE_TTL = readPositiveInt(process.env.CACHE_TTL, 86_400);
const CDN_CACHE_TTL = readPositiveInt(process.env.CDN_CACHE_TTL, 300);
const CDN_STALE_TTL = readPositiveInt(process.env.CDN_STALE_TTL, 600);
const PLAYLIST_CACHE_TTL = readPositiveInt(process.env.PLAYLIST_CACHE_TTL, 60);
const UPSTREAM_TIMEOUT_MS = readPositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 12_000);
const MAX_TEXT_BYTES = readPositiveInt(process.env.PROXY_MAX_TEXT_BYTES, 8 * 1024 * 1024);
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SAFE_RESPONSE_HEADERS = new Set(['accept-ranges', 'content-range', 'etag', 'last-modified']);
const M3U8_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl'
]);
const USER_AGENTS = readUserAgents();

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readUserAgents() {
  const fallback = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15'
  ];
  try {
    const parsed = JSON.parse(process.env.USER_AGENTS_JSON || 'null');
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.map(String).filter(Boolean).slice(0, 12)
      : fallback;
  } catch (_) {
    return fallback;
  }
}

function logDebug(message) {
  if (DEBUG_ENABLED) console.log(`[proxy] ${String(message)}`);
}

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isForbiddenAddress(address) {
  try {
    let parsed = ipaddr.parse(String(address).replace(/^\[|\]$/g, ''));
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
    if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => isForbiddenAddress(address))) {
      const blocked = new Error('Upstream address is not public');
      blocked.code = 'ERR_BLOCKED_ADDRESS';
      return callback(blocked);
    }
    if (options?.all) return callback(null, addresses);
    const selected = addresses[0];
    return callback(null, selected.address, selected.family);
  });
}

const secureDispatcher = new Agent({
  connect: {
    lookup: safeLookup
  }
});

async function secureFetch(url, options) {
  return undiciFetch(url, {
    ...options,
    redirect: 'manual',
    dispatcher: secureDispatcher
  });
}

function normalizeSafeTargetUrl(value) {
  try {
    if (!value || String(value).length > 8192) return null;
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (isForbiddenHostname(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function decodeTargetPath(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return '';
  }
}

function extractTargetUrl(req) {
  const pathValue = req.query?.['...path'] ?? req.params?.encodedUrl;
  const joined = Array.isArray(pathValue) ? pathValue.join('/') : pathValue;
  let candidate = decodeTargetPath(joined);
  if (!candidate && typeof req.url === 'string') {
    const pathOnly = req.url.split('?')[0];
    const marker = '/proxy/';
    const index = pathOnly.indexOf(marker);
    if (index >= 0) candidate = decodeTargetPath(pathOnly.slice(index + marker.length));
  }
  return normalizeSafeTargetUrl(candidate);
}

function authorizationMode(req, targetUrl, env, now) {
  if (verifyProxyToken(queryValue(req.query?.auth), queryValue(req.query?.t), env, now)) {
    return 'token';
  }
  if (
    verifyResourceProxyToken(
      targetUrl,
      queryValue(req.query?.resource),
      queryValue(req.query?.rb),
      env,
      now
    )
  ) {
    return 'resource';
  }
  if (isRequestAuthenticated(req, env, now)) return 'session';
  return '';
}

function createRequestHeaders(targetUrl, requestHeaders = {}) {
  const target = new URL(targetUrl);
  const accept = String(requestHeaders.accept || '*/*');
  const headers = {
    'user-agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    accept,
    'accept-language': String(requestHeaders['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8'),
    referer: target.hostname.endsWith('doubanio.com')
      ? 'https://movie.douban.com/'
      : target.origin
  };
  if (requestHeaders.range) headers.range = String(requestHeaders.range);
  return headers;
}

async function fetchWithValidatedRedirects(fetchImpl, initialUrl, options) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetchImpl(currentUrl, { ...options, redirect: 'manual' });
    } catch (error) {
      if (error?.code === 'ERR_BLOCKED_ADDRESS' || error?.cause?.code === 'ERR_BLOCKED_ADDRESS') {
        throw createHttpError(400, 'Blocked upstream address');
      }
      throw error;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    await response.body?.cancel?.().catch(() => {});
    if (!location) throw createHttpError(502, 'Invalid upstream redirect');
    if (redirectCount >= MAX_REDIRECTS) throw createHttpError(508, 'Too many upstream redirects');

    const nextUrl = normalizeSafeTargetUrl(new URL(location, currentUrl).toString());
    if (!nextUrl) throw createHttpError(400, 'Blocked upstream redirect');
    currentUrl = nextUrl;
  }
  throw createHttpError(508, 'Too many upstream redirects');
}

function createAbortContext(req, res, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Upstream timeout'));
  }, timeoutMs);
  const abortForClient = () => {
    if (!res.writableEnded) controller.abort(new Error('Client disconnected'));
  };

  req.once?.('aborted', abortForClient);
  res.once?.('close', abortForClient);

  return {
    controller,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timeout);
      req.removeListener?.('aborted', abortForClient);
      res.removeListener?.('close', abortForClient);
    }
  };
}

function baseContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function isM3u8Type(contentType) {
  return M3U8_CONTENT_TYPES.has(baseContentType(contentType));
}

function isBinaryType(contentType) {
  const type = baseContentType(contentType);
  return (
    (type.startsWith('image/') && type !== 'image/svg+xml') ||
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    type === 'application/octet-stream'
  );
}

function isPotentialTextType(contentType, finalUrl) {
  const type = baseContentType(contentType);
  return (
    !type ||
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('javascript') ||
    type.includes('xml') ||
    isM3u8Type(type) ||
    /\.m3u8(?:$|[?#])/i.test(finalUrl)
  );
}

async function readBodyLimited(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      await response.body.cancel?.().catch(() => {});
      throw createHttpError(413, 'Upstream text response is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch (_) {
    return false;
  }
}

function looksLikeHtmlOrScript(text) {
  return /^\s*<(?:!doctype\s+html|html|head|body|script|iframe|svg)\b/i.test(text);
}

function resolvePlaylistUri(baseUrl, value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:data|blob|skd):/i.test(raw)) return '';
  try {
    const resolved = new URL(raw, baseUrl);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : '';
  } catch (_) {
    return '';
  }
}

function createSignedProxyUrl(targetUrl, env, now) {
  const signed = createResourceProxyToken(targetUrl, env, now);
  const base = `/proxy/${encodeURIComponent(targetUrl)}`;
  if (!signed) return base;
  return `${base}?resource=${encodeURIComponent(signed.token)}&rb=${signed.bucket}`;
}

function rewriteM3u8(content, baseUrl, env, now) {
  return String(content)
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith('#')) {
        const resolved = resolvePlaylistUri(baseUrl, line);
        return resolved ? createSignedProxyUrl(resolved, env, now) : line;
      }
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        const resolved = resolvePlaylistUri(baseUrl, uri);
        return resolved ? `URI="${createSignedProxyUrl(resolved, env, now)}"` : match;
      });
    })
    .join('\n');
}

function copySafeResponseHeaders(upstreamHeaders, res) {
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(name);
    if (value) res.setHeader(name, value);
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function setCacheHeaders(res, mode, maxAge) {
  if (!['token', 'resource'].includes(mode)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return;
  }
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  res.setHeader(
    'Vercel-CDN-Cache-Control',
    `public, s-maxage=${Math.min(maxAge, CDN_CACHE_TTL)}, stale-while-revalidate=${CDN_STALE_TTL}`
  );
}

function writeJsonError(res, status, message) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json({ success: false, error: message });
}

function publicError(status) {
  if (status === 400) return '代理目标被安全策略拒绝';
  if (status === 401) return '代理访问未授权';
  if (status === 413) return '上游响应过大';
  if (status === 415) return '不支持的上游内容类型';
  if (status === 499) return '请求已取消';
  if (status === 504) return '上游请求超时';
  return '上游资源暂时不可用';
}

export function createProxyHandler({
  fetchImpl = secureFetch,
  env = process.env,
  now = () => Date.now()
} = {}) {
  return async function proxyHandler(req, res) {
    setSecurityHeaders(res);

    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return res.status(204).end();
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return writeJsonError(res, 405, 'Method not allowed');
    }

    const targetUrl = extractTargetUrl(req);
    if (!targetUrl) return writeJsonError(res, 400, publicError(400));

    const requestNow = now();
    const mode = authorizationMode(req, targetUrl, env, requestNow);
    if (!mode) return writeJsonError(res, 401, publicError(401));

    const abortContext = createAbortContext(req, res, UPSTREAM_TIMEOUT_MS);
    try {
      const { response, finalUrl } = await fetchWithValidatedRedirects(fetchImpl, targetUrl, {
        method: req.method,
        headers: createRequestHeaders(targetUrl, req.headers),
        signal: abortContext.controller.signal
      });

      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw createHttpError(response.status >= 500 ? 502 : response.status, 'Upstream request failed');
      }

      const upstreamType = response.headers.get('content-type') || '';
      copySafeResponseHeaders(response.headers, res);

      if (req.method === 'HEAD') {
        const safeType = isM3u8Type(upstreamType)
          ? 'application/vnd.apple.mpegurl'
          : isBinaryType(upstreamType)
            ? baseContentType(upstreamType)
            : 'application/octet-stream';
        res.setHeader('Content-Type', safeType);
        setCacheHeaders(res, mode, isM3u8Type(upstreamType) ? PLAYLIST_CACHE_TTL : BINARY_CACHE_TTL);
        await response.body?.cancel?.().catch(() => {});
        return res.status(response.status).end();
      }

      if (isBinaryType(upstreamType) && !isM3u8Type(upstreamType)) {
        res.setHeader('Content-Type', baseContentType(upstreamType));
        setCacheHeaders(res, mode, BINARY_CACHE_TTL);
        res.status(response.status);
        if (!response.body) return res.end();
        await pipeline(Readable.fromWeb(response.body), res, { signal: abortContext.controller.signal });
        return;
      }

      if (!isPotentialTextType(upstreamType, finalUrl)) {
        await response.body?.cancel?.().catch(() => {});
        throw createHttpError(415, 'Unsupported upstream content type');
      }

      const body = await readBodyLimited(response, MAX_TEXT_BYTES);
      const text = body.toString('utf8');
      const m3u8 = isM3u8Type(upstreamType) || text.trimStart().startsWith('#EXTM3U');
      if (m3u8) {
        const rewritten = rewriteM3u8(text, finalUrl, env, requestNow);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        setCacheHeaders(res, mode, PLAYLIST_CACHE_TTL);
        return res.status(response.status).send(rewritten);
      }

      const json = looksLikeJson(text);
      const type = baseContentType(upstreamType);
      if (json) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      } else if (type === 'text/plain' && !looksLikeHtmlOrScript(text)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      } else {
        throw createHttpError(415, 'Unsupported upstream text content');
      }
      setCacheHeaders(res, mode, Math.min(BINARY_CACHE_TTL, 300));
      return res.status(response.status).send(body);
    } catch (error) {
      const aborted = abortContext.controller.signal.aborted;
      const status = abortContext.timedOut
        ? 504
        : aborted
          ? 499
          : Number.isInteger(error?.status)
            ? error.status
            : 502;
      logDebug(`${new URL(targetUrl).hostname}: ${error?.message || 'proxy failure'}`);
      return writeJsonError(res, status, publicError(status));
    } finally {
      abortContext.cleanup();
    }
  };
}

export const proxyInternals = {
  extractTargetUrl,
  isForbiddenAddress,
  isForbiddenHostname,
  normalizeSafeTargetUrl,
  rewriteM3u8
};

export default createProxyHandler();

import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function abortError(reason, message = 'Upstream request aborted') {
  const error = new Error(reason instanceof Error ? reason.message : message, {
    cause: reason instanceof Error ? reason : undefined
  });
  error.name = 'AbortError';
  return error;
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
  connect: { lookup: safeLookup }
});

function normalizePublicUrl(value, base) {
  let url;
  try {
    url = base ? new URL(String(value || ''), base) : new URL(String(value || ''));
  } catch (_) {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    isForbiddenHostname(url.hostname)
  ) {
    return null;
  }
  url.hash = '';
  return url;
}

function redirectOptions(options, status, crossOrigin) {
  const method = String(options.method || 'GET').toUpperCase();
  if (crossOrigin && !['GET', 'HEAD'].includes(method)) {
    const error = new Error('Cross-origin redirects are blocked for non-GET requests');
    error.code = 'ERR_BLOCKED_REDIRECT';
    throw error;
  }
  const headers = new Headers(options.headers || {});
  if (crossOrigin) {
    headers.delete('authorization');
    headers.delete('proxy-authorization');
    headers.delete('cookie');
    headers.delete('host');
  }
  const switchToGet = status === 303 || ([301, 302].includes(status) && method === 'POST');
  if (switchToGet) {
    headers.delete('content-length');
    headers.delete('content-type');
  }
  return switchToGet
    ? { ...options, method: 'GET', body: undefined, headers }
    : { ...options, headers };
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch (_) {}
}

async function fetchWithSafeRedirects(fetchImpl, value, options, signal) {
  let currentUrl = normalizePublicUrl(value);
  if (!currentUrl) {
    const error = new Error('Upstream URL must resolve to a public HTTP(S) address');
    error.code = 'ERR_BLOCKED_ADDRESS';
    throw error;
  }
  let requestOptions = { ...options };

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl.href, {
      ...requestOptions,
      signal,
      redirect: 'manual',
      dispatcher: secureDispatcher
    });
    if (!REDIRECT_STATUSES.has(response?.status)) return response;
    if (redirectCount === MAX_REDIRECTS) {
      await cancelResponseBody(response);
      const error = new Error('Upstream redirected too many times');
      error.code = 'ERR_TOO_MANY_REDIRECTS';
      throw error;
    }

    const location = response.headers?.get?.('location');
    const nextUrl = normalizePublicUrl(location, currentUrl);
    if (!nextUrl) {
      await cancelResponseBody(response);
      const error = new Error('Upstream redirect target is not public');
      error.code = 'ERR_BLOCKED_REDIRECT';
      throw error;
    }
    try {
      requestOptions = redirectOptions(
        requestOptions,
        response.status,
        nextUrl.origin !== currentUrl.origin
      );
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    await cancelResponseBody(response);
    currentUrl = nextUrl;
  }

  throw new Error('Unreachable redirect state');
}

export async function fetchWithTimeout(
  fetchImpl,
  url,
  options = {},
  {
    signal: parentSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    consume
  } = {}
) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch runtime is unavailable');
  if (parentSignal?.aborted) throw abortError(parentSignal.reason);

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`Upstream request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  let rejectOnAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectOnAbort = () => reject(abortError(controller.signal.reason));
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });

  try {
    const response = await Promise.race([
      fetchWithSafeRedirects(fetchImpl, url, options, controller.signal),
      aborted
    ]);
    if (typeof consume !== 'function') return response;
    return await Promise.race([Promise.resolve().then(() => consume(response)), aborted]);
  } catch (error) {
    if (parentSignal?.aborted) throw abortError(parentSignal.reason);
    if (controller.signal.aborted) throw abortError(controller.signal.reason, 'Upstream request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function responseTooLarge(maxBytes) {
  const error = new Error(`Upstream response exceeds ${maxBytes} bytes`);
  error.code = 'RESPONSE_TOO_LARGE';
  return error;
}

export async function readResponseBytes(response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const limit = Math.max(1024, Number(maxBytes) || DEFAULT_MAX_RESPONSE_BYTES);
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw responseTooLarge(limit);
  }

  if (!response?.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw responseTooLarge(limit);
    return bytes;
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
      if (total > limit) throw responseTooLarge(limit);
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
  return bytes;
}

export async function readResponseText(response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  if (response?.body?.getReader || typeof response?.arrayBuffer === 'function') {
    return new TextDecoder().decode(await readResponseBytes(response, maxBytes));
  }
  const text = String(await response.text());
  if (Buffer.byteLength(text) > maxBytes) throw responseTooLarge(maxBytes);
  return text;
}

export async function readResponseJson(response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  if (
    response?.body?.getReader ||
    typeof response?.arrayBuffer === 'function' ||
    typeof response?.text === 'function'
  ) {
    return JSON.parse(await readResponseText(response, maxBytes));
  }
  const value = await response.json();
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw responseTooLarge(maxBytes);
  return value;
}

export {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  fetchWithSafeRedirects,
  isForbiddenAddress,
  isForbiddenHostname
};

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

function normalizeAction(action) {
  const value = Array.isArray(action) ? action[0] : action;
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host);
}

export function validateBridgeBaseUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (isPrivateHostname(url.hostname)) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url;
  } catch (_) {
    return null;
  }
}

function getTimeoutMs(env = {}) {
  const value = Number.parseInt(env.TVBOX_BRIDGE_TIMEOUT_MS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function appendQueryParams(targetUrl, query = {}) {
  Object.entries(query).forEach(([key, value]) => {
    if (key === 'action') return;
    if (Array.isArray(value)) {
      value.forEach((item) => item !== undefined && item !== null && targetUrl.searchParams.append(key, item));
      return;
    }
    if (value !== undefined && value !== null && value !== '') {
      targetUrl.searchParams.set(key, value);
    }
  });
}

function createStatusResponse(status, message, extra = {}) {
  return {
    httpStatus: status === STATUS.UNSUPPORTED ? 501 : 200,
    body: {
      status,
      message,
      ...extra
    }
  };
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

  if (typeof fetchImpl !== 'function') {
    return createStatusResponse(STATUS.ERROR, 'Fetch runtime is unavailable');
  }

  const targetUrl = new URL(`${bridgeBaseUrl.toString()}/api/tvbox/${normalizedAction}`);
  appendQueryParams(targetUrl, query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs(env));

  try {
    const headers = {
      Accept: 'application/json'
    };
    if (env.TVBOX_BRIDGE_TOKEN) {
      headers.Authorization = `Bearer ${env.TVBOX_BRIDGE_TOKEN}`;
    }

    const response = await fetchImpl(targetUrl.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { status: STATUS.ERROR, message: await response.text().catch(() => '') };

    if (response.status === 401 || response.status === 403) {
      return createStatusResponse(STATUS.UNSUPPORTED, 'TVBox bridge authorization failed');
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
    return createStatusResponse(
      isTimeout ? STATUS.TIMEOUT : STATUS.ERROR,
      isTimeout ? 'TVBox bridge request timed out' : 'TVBox bridge request failed',
      { error: error?.message || String(error) }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function writeBridgeJsonResponse(res, result) {
  res.status(result.httpStatus || 200);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(result.body);
}

export { STATUS };

import assert from 'node:assert/strict';
import {
  proxyTvboxBridgeRequest,
  writeBridgeJsonResponse
} from '../server/tvbox-bridge-proxy.mjs';

function bridgeResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = new Map();
    this.body = null;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
    return this;
  }

  json(body) {
    this.body = body;
    return this;
  }
}

const unsupported = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: '庆余年' },
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without bridge url');
  }
});
assert.equal(unsupported.body.status, 'unsupported');

const blockedPrivate = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: '庆余年' },
  env: { TVBOX_BRIDGE_URL: 'http://127.0.0.1:9979' },
  fetchImpl: async () => {
    throw new Error('fetch should not be called for private bridge url');
  }
});
assert.equal(blockedPrivate.body.status, 'unsupported');

for (const blockedUrl of [
  'http://127.0.0.2:9979',
  'http://[::1]:9979',
  'http://[fc00::1]:9979',
  'http://[fe80::1]:9979',
  'http://100.64.0.1:9979',
  'http://[::ffff:127.0.0.1]:9979'
]) {
  const blocked = await proxyTvboxBridgeRequest({
    action: 'health',
    env: { TVBOX_BRIDGE_URL: blockedUrl },
    fetchImpl: async () => {
      throw new Error('fetch should not be called for a non-public bridge url');
    }
  });
  assert.equal(blocked.body.status, 'unsupported', blockedUrl);
}

let insecureBridgeCalls = 0;
const insecureAuthenticatedBridge = await proxyTvboxBridgeRequest({
  action: 'health',
  env: {
    TVBOX_BRIDGE_URL: 'http://bridge-http.example.test',
    TVBOX_BRIDGE_TOKEN: 'must-not-cross-http'
  },
  fetchImpl: async () => {
    insecureBridgeCalls += 1;
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(insecureAuthenticatedBridge.body.status, 'unsupported');
assert.equal(insecureBridgeCalls, 0);

const forwardingEnv = {
  TVBOX_BRIDGE_URL: 'https://bridge-forward.example.test/base/',
  TVBOX_BRIDGE_TOKEN: 'server-secret'
};
let forwardingCalls = 0;
let forwardedUrl = '';
let forwardedAuth = '';
const forwarded = await proxyTvboxBridgeRequest({
  action: 'search',
  query: {
    sourceKey: '厂长',
    wd: '庆余年',
    action: 'ignored',
    tracking: 'must-not-be-forwarded'
  },
  env: forwardingEnv,
  fetchImpl: async (url, options) => {
    forwardingCalls += 1;
    forwardedUrl = url;
    forwardedAuth = options.headers.Authorization;
    return bridgeResponse({ status: 'ready', list: [{ vod_name: '庆余年' }] });
  }
});
assert.equal(forwarded.body.status, 'ready');
assert.equal(forwarded.body.list.length, 1);
assert.equal(forwarded.cacheStatus, 'MISS');
assert.equal(forwardingCalls, 1);

const parsedForwardedUrl = new URL(forwardedUrl);
assert.equal(parsedForwardedUrl.pathname, '/base/api/tvbox/search');
assert.deepEqual(
  Array.from(parsedForwardedUrl.searchParams.keys()).sort(),
  ['sourceKey', 'wd']
);
assert.equal(parsedForwardedUrl.searchParams.get('sourceKey'), '厂长');
assert.equal(parsedForwardedUrl.searchParams.get('wd'), '庆余年');
assert.equal(forwardedAuth, 'Bearer server-secret');

const cachedIgnoringUnknown = await proxyTvboxBridgeRequest({
  action: 'search',
  query: {
    sourceKey: '厂长',
    wd: '庆余年',
    cacheBuster: 'different-unknown-value'
  },
  env: forwardingEnv,
  fetchImpl: async () => {
    forwardingCalls += 1;
    throw new Error('unknown parameters must not bypass the normalized cache key');
  }
});
assert.equal(cachedIgnoringUnknown.cacheStatus, 'HIT');
assert.equal(forwardingCalls, 1);

let invalidFetchCalls = 0;
const repeatedParameter = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: ['one', 'two'] },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-invalid.example.test',
    TVBOX_BRIDGE_TOKEN: 'invalid-test'
  },
  fetchImpl: async () => {
    invalidFetchCalls += 1;
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(repeatedParameter.httpStatus, 400);
assert.equal(repeatedParameter.body.status, 'unsupported');
assert.equal(invalidFetchCalls, 0);

const oversizedParameter = await proxyTvboxBridgeRequest({
  action: 'detail',
  query: { sourceKey: '荐片', id: 'x'.repeat(513) },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-invalid.example.test',
    TVBOX_BRIDGE_TOKEN: 'invalid-test'
  },
  fetchImpl: async () => {
    invalidFetchCalls += 1;
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(oversizedParameter.httpStatus, 400);
assert.equal(invalidFetchCalls, 0);

let rootForwardedUrl = '';
await proxyTvboxBridgeRequest({
  action: 'health',
  query: { ignored: 'value' },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-root.example.test',
    TVBOX_BRIDGE_TOKEN: 'root-test'
  },
  fetchImpl: async (url) => {
    rootForwardedUrl = url;
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(rootForwardedUrl, 'https://bridge-root.example.test/api/tvbox/health');

let redirectCalls = 0;
const blockedRedirect = await proxyTvboxBridgeRequest({
  action: 'health',
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-redirect.example.test',
    TVBOX_BRIDGE_TOKEN: 'redirect-test'
  },
  fetchImpl: async () => {
    redirectCalls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.2:9979/api/tvbox/health' }
    });
  }
});
assert.equal(blockedRedirect.body.status, 'unsupported');
assert.equal(redirectCalls, 1);

let crossOriginRedirectCalls = 0;
const blockedAuthenticatedRedirect = await proxyTvboxBridgeRequest({
  action: 'health',
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-origin.example.test',
    TVBOX_BRIDGE_TOKEN: 'redirect-origin-secret'
  },
  fetchImpl: async (_url, options) => {
    crossOriginRedirectCalls += 1;
    assert.equal(options.headers.Authorization, 'Bearer redirect-origin-secret');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://redirect-target.example.test/api/tvbox/health' }
    });
  }
});
assert.equal(blockedAuthenticatedRedirect.body.status, 'unsupported');
assert.equal(crossOriginRedirectCalls, 1);

let sameOriginRedirectCalls = 0;
const allowedSameOriginRedirect = await proxyTvboxBridgeRequest({
  action: 'health',
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-same-origin.example.test/base',
    TVBOX_BRIDGE_TOKEN: 'same-origin-secret'
  },
  fetchImpl: async (url, options) => {
    sameOriginRedirectCalls += 1;
    assert.equal(options.headers.Authorization, 'Bearer same-origin-secret');
    if (sameOriginRedirectCalls === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: '/api/tvbox/health' }
      });
    }
    assert.equal(url, 'https://bridge-same-origin.example.test/api/tvbox/health');
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(allowedSameOriginRedirect.body.status, 'ready');
assert.equal(sameOriginRedirectCalls, 2);

const oversizedBridgeResponse = await proxyTvboxBridgeRequest({
  action: 'sources',
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-oversized.example.test',
    TVBOX_BRIDGE_TOKEN: 'oversized-test',
    TVBOX_BRIDGE_MAX_RESPONSE_BYTES: '1024'
  },
  fetchImpl: async () => bridgeResponse({
    status: 'ready',
    payload: 'x'.repeat(4096)
  })
});
assert.equal(oversizedBridgeResponse.body.status, 'error');
assert.match(oversizedBridgeResponse.body.message, /too large/i);

const timedOut = await proxyTvboxBridgeRequest({
  action: 'detail',
  query: { sourceKey: '厂长', id: 'abc' },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-timeout.example.test',
    TVBOX_BRIDGE_TOKEN: 'timeout-test',
    TVBOX_BRIDGE_TIMEOUT_MS: '1'
  },
  fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
    setTimeout(() => resolve(bridgeResponse({ status: 'ready' })), 30);
  })
});
assert.equal(timedOut.body.status, 'timeout');

const noResult = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '荐片', wd: 'nothing' },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-negative.example.test',
    TVBOX_BRIDGE_TOKEN: 'negative-test'
  },
  fetchImpl: async () => bridgeResponse({ status: 'no_result', list: [] })
});
assert.equal(noResult.cachePolicy.browserMaxAge, 5);
assert.equal(noResult.cachePolicy.memoryTtlMs, 20_000);
assert.equal(noResult.cachePolicy.noStore, undefined);

const loginRequired = await proxyTvboxBridgeRequest({
  action: 'detail',
  query: { sourceKey: '荐片', id: 'login' },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge-login.example.test',
    TVBOX_BRIDGE_TOKEN: 'login-test'
  },
  fetchImpl: async () => bridgeResponse({ status: 'login_required', episodes: [] })
});
assert.equal(loginRequired.cachePolicy.noStore, true);
assert.equal(loginRequired.cachePolicy.memoryTtlMs, 30_000);

const readyResponse = new MockResponse();
writeBridgeJsonResponse(readyResponse, forwarded);
assert.match(readyResponse.headers.get('cache-control'), /^private, max-age=30$/);
assert.equal(readyResponse.headers.get('vercel-cdn-cache-control'), 'no-store');
assert.doesNotMatch(readyResponse.headers.get('cache-control'), /\bpublic\b/);

const noResultResponse = new MockResponse();
writeBridgeJsonResponse(noResultResponse, noResult);
assert.equal(noResultResponse.headers.get('cache-control'), 'private, max-age=5');
assert.equal(noResultResponse.headers.get('vercel-cdn-cache-control'), 'no-store');

const loginResponse = new MockResponse();
writeBridgeJsonResponse(loginResponse, loginRequired);
assert.equal(loginResponse.headers.get('cache-control'), 'private, no-store');
assert.equal(loginResponse.headers.get('vercel-cdn-cache-control'), 'no-store');

const inflightEnv = {
  TVBOX_BRIDGE_URL: 'https://bridge-inflight.example.test',
  TVBOX_BRIDGE_TOKEN: 'inflight-test',
  TVBOX_BRIDGE_MAX_INFLIGHT: '1'
};
let releaseFirst = null;
let inflightFetchCalls = 0;
const firstInflight = proxyTvboxBridgeRequest({
  action: 'play',
  query: { sourceKey: '瓜子', id: 'first', episode: '0' },
  env: inflightEnv,
  fetchImpl: async () => {
    inflightFetchCalls += 1;
    return new Promise((resolve) => {
      releaseFirst = () => resolve(bridgeResponse({
        status: 'ready',
        url: 'https://cdn.example/first.m3u8'
      }));
    });
  }
});
while (!releaseFirst) await new Promise((resolve) => setTimeout(resolve, 0));

const rejectedByInflightLimit = await proxyTvboxBridgeRequest({
  action: 'play',
  query: { sourceKey: '瓜子', id: 'second', episode: '0' },
  env: inflightEnv,
  fetchImpl: async () => {
    inflightFetchCalls += 1;
    return bridgeResponse({ status: 'ready' });
  }
});
assert.equal(rejectedByInflightLimit.httpStatus, 503);
assert.equal(rejectedByInflightLimit.body.status, 'timeout');
assert.equal(inflightFetchCalls, 1);
releaseFirst();
await firstInflight;

console.log(JSON.stringify({
  ok: true,
  unsupported: unsupported.body.status,
  privateUrl: blockedPrivate.body.status,
  normalizedForwardedUrl: forwardedUrl,
  unknownParamsIgnored: cachedIgnoringUnknown.cacheStatus === 'HIT',
  invalidParamsBlocked: invalidFetchCalls === 0,
  privateAddressVariantsBlocked: true,
  privateRedirectBlocked: blockedRedirect.body.status,
  insecureAuthenticatedBridgeBlocked: insecureAuthenticatedBridge.body.status,
  crossOriginAuthenticatedRedirectBlocked: blockedAuthenticatedRedirect.body.status,
  oversizedResponseBlocked: oversizedBridgeResponse.body.status,
  timeout: timedOut.body.status,
  cachePolicies: {
    ready: readyResponse.headers.get('cache-control'),
    noResult: noResultResponse.headers.get('cache-control'),
    loginRequired: loginResponse.headers.get('cache-control'),
    cdn: readyResponse.headers.get('vercel-cdn-cache-control')
  },
  inflightLimited: rejectedByInflightLimit.httpStatus
}, null, 2));

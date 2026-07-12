import { proxyTvboxBridgeRequest } from '../server/tvbox-bridge-proxy.mjs';

const unsupported = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: '庆余年' },
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without bridge url');
  }
});
if (unsupported.body.status !== 'unsupported') {
  throw new Error(`expected unsupported when bridge is not configured, got ${unsupported.body.status}`);
}

const blockedPrivate = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: '庆余年' },
  env: { TVBOX_BRIDGE_URL: 'http://127.0.0.1:9979' },
  fetchImpl: async () => {
    throw new Error('fetch should not be called for private bridge url');
  }
});
if (blockedPrivate.body.status !== 'unsupported') {
  throw new Error(`expected private bridge url to be unsupported, got ${blockedPrivate.body.status}`);
}

let forwardedUrl = '';
let forwardedAuth = '';
const forwarded = await proxyTvboxBridgeRequest({
  action: 'search',
  query: { sourceKey: '厂长', wd: '庆余年', action: 'ignored' },
  env: {
    TVBOX_BRIDGE_URL: 'https://bridge.example.test/base/',
    TVBOX_BRIDGE_TOKEN: 'server-secret'
  },
  fetchImpl: async (url, options) => {
    forwardedUrl = url;
    forwardedAuth = options.headers.Authorization;
    return {
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ready', list: [{ vod_name: '庆余年' }] })
    };
  }
});
if (forwarded.body.status !== 'ready' || forwarded.body.list.length !== 1) {
  throw new Error('expected ready bridge response to pass through');
}
if (!forwardedUrl.startsWith('https://bridge.example.test/base/api/tvbox/search?')) {
  throw new Error(`unexpected forwarded url: ${forwardedUrl}`);
}
if (!forwardedUrl.includes('sourceKey=%E5%8E%82%E9%95%BF') || !forwardedUrl.includes('wd=%E5%BA%86%E4%BD%99%E5%B9%B4')) {
  throw new Error(`query params were not forwarded correctly: ${forwardedUrl}`);
}
if (forwardedUrl.includes('action=')) {
  throw new Error(`internal action query param leaked to bridge: ${forwardedUrl}`);
}
if (forwardedAuth !== 'Bearer server-secret') {
  throw new Error('bridge token was not sent as server-side Authorization header');
}

const timedOut = await proxyTvboxBridgeRequest({
  action: 'detail',
  query: { sourceKey: '厂长', id: 'abc' },
  env: { TVBOX_BRIDGE_URL: 'https://bridge.example.test', TVBOX_BRIDGE_TIMEOUT_MS: '1' },
  fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
    setTimeout(() => resolve({
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ready' })
    }), 30);
  })
});
if (timedOut.body.status !== 'timeout') {
  throw new Error(`expected timeout, got ${timedOut.body.status}`);
}

console.log(JSON.stringify({
  ok: true,
  unsupported: unsupported.body.status,
  privateUrl: blockedPrivate.body.status,
  forwardedUrl,
  timeout: timedOut.body.status
}, null, 2));

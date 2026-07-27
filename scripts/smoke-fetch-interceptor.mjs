import assert from 'assert/strict';
import vm from 'vm';
import { readFileSync } from 'fs';

const configSource = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
for (const match of configSource.matchAll(/jisu:\s*\{([^}]+)\}/g)) {
  assert.doesNotMatch(match[1], /\bdetail\s*:/, 'jisu must use its working CMS detail endpoint');
}

const originalFetchCalls = [];
let cancelledUpstreamSignal = null;

async function originalFetch(input, init = {}) {
  originalFetchCalls.push(String(input));
  if (String(input).includes('cancel-detail')) {
    cancelledUpstreamSignal = init.signal;
    return new Promise((resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init.signal?.aborted) {
        rejectAbort();
        return;
      }
      init.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
  }
  return new Response(JSON.stringify({
    code: 200,
    list: [
      { vod_id: 'demo-id', vod_name: 'Demo' }
    ]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const context = {
  URL,
  Request,
  Response,
  AbortController,
  console,
  setTimeout,
  clearTimeout,
  API_SITES: {
    demo: {
      api: 'https://cms.example.test',
      name: 'Demo源'
    }
  },
  API_CONFIG: {
    search: {
      path: '/api.php/provide/vod/?ac=detail&wd=',
      headers: {}
    },
    detail: {
      path: '/api.php/provide/vod/?ac=detail&ids=',
      headers: {}
    }
  },
  PROXY_URL: '/proxy/',
  window: {
    location: {
      origin: 'https://tv.cursorflow.top'
    },
    fetch: originalFetch,
    isAuthSessionReady: () => true,
    isPasswordVerified: () => true
  }
};
context.fetch = (...args) => context.window.fetch(...args);
context.globalThis = context;

vm.createContext(context);
vm.runInContext(readFileSync(new URL('../js/api.js', import.meta.url), 'utf8'), context);

const tvboxResponse = await context.window.fetch('/api/tvbox/health');
assert.equal(await tvboxResponse.text(), JSON.stringify({
  code: 200,
  list: [
    { vod_id: 'demo-id', vod_name: 'Demo' }
  ]
}));
assert.equal(originalFetchCalls[0], '/api/tvbox/health');

const searchResponse = await context.window.fetch('/api/search?wd=庆余年&source=demo');
const searchJson = await searchResponse.json();
assert.equal(searchJson.code, 200);
assert.equal(searchJson.list[0].source_code, 'demo');
assert.ok(originalFetchCalls.some((url) => url.startsWith('/proxy/https%3A%2F%2Fcms.example.test')));

context.window.isAuthSessionReady = () => false;
const unauthorizedResponse = await context.window.fetch(
  new Request('https://tv.cursorflow.top/api/search?wd=blocked&source=demo')
);
assert.equal(unauthorizedResponse.status, 401);
assert.equal((await unauthorizedResponse.json()).code, 401);

context.window.isAuthSessionReady = () => true;
const detailAbortController = new AbortController();
const cancelledDetailRequest = context.window.fetch(
  '/api/detail?id=cancel-detail&source=demo',
  { signal: detailAbortController.signal }
);
await new Promise(resolve => setTimeout(resolve, 0));
detailAbortController.abort();
await assert.rejects(cancelledDetailRequest, error => error?.name === 'AbortError');
assert.equal(cancelledUpstreamSignal?.aborted, true);

console.log(JSON.stringify({
  ok: true,
  tvboxPassThrough: originalFetchCalls[0],
  legacySearchIntercepted: searchJson.list[0].source_code,
  unauthorizedStatus: unauthorizedResponse.status,
  detailCancellationReachedUpstream: cancelledUpstreamSignal?.aborted === true
}, null, 2));

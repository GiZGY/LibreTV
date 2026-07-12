import assert from 'assert/strict';
import vm from 'vm';
import { readFileSync } from 'fs';

const originalFetchCalls = [];

async function originalFetch(input) {
  originalFetchCalls.push(String(input));
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
    }
  },
  PROXY_URL: '/proxy/',
  window: {
    location: {
      origin: 'https://tv.cursorflow.top'
    },
    fetch: originalFetch
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

console.log(JSON.stringify({
  ok: true,
  tvboxPassThrough: originalFetchCalls[0],
  legacySearchIntercepted: searchJson.list[0].source_code
}, null, 2));

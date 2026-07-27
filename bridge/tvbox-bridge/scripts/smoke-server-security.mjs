import assert from 'node:assert/strict';
import { once } from 'node:events';
import { STATUS } from '../src/status.mjs';
import { createBridgeApp, resolveBridgeConfig } from '../src/server.mjs';

assert.throws(
  () => resolveBridgeConfig({ NODE_ENV: 'production' }),
  /TVBOX_BRIDGE_TOKEN is required/
);
assert.throws(
  () => resolveBridgeConfig({ NODE_ENV: 'development' }),
  /TVBOX_BRIDGE_TOKEN is required/
);

const explicitDevelopment = resolveBridgeConfig({
  NODE_ENV: 'development',
  BRIDGE_ALLOW_INSECURE_DEV: 'true'
});
assert.equal(explicitDevelopment.allowInsecureDevelopment, true);

const token = 'bridge-security-smoke-token';
const config = resolveBridgeConfig({
  NODE_ENV: 'production',
  TVBOX_BRIDGE_TOKEN: token,
  HOST: '127.0.0.1',
  PORT: '9979',
  BRIDGE_MAX_CONCURRENCY: '3',
  BRIDGE_MAX_QUEUE: '64'
});

let upstreamCalls = 0;
let sharedAbortCount = 0;
let activeAdapterCalls = 0;
let peakAdapterCalls = 0;
let notifyStarted = null;
let started = new Promise((resolve) => {
  notifyStarted = resolve;
});

const adapter = {
  search(keyword, { signal }) {
    upstreamCalls += 1;
    activeAdapterCalls += 1;
    peakAdapterCalls = Math.max(peakAdapterCalls, activeAdapterCalls);
    notifyStarted?.(keyword);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        activeAdapterCalls = Math.max(0, activeAdapterCalls - 1);
        return true;
      };
      const timer = setTimeout(() => {
        if (!finish()) return;
        resolve({
          status: STATUS.READY,
          sourceKey: '测试源',
          list: [{ vod_id: keyword, vod_name: keyword }]
        });
      }, 80);
      signal.addEventListener('abort', () => {
        if (!finish()) return;
        sharedAbortCount += 1;
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }
};

const source = {
  key: '测试源',
  status: STATUS.READY,
  reason: ''
};
const app = createBridgeApp(config, {
  getSource: (key) => key === source.key ? source : null,
  getAdapter: (key) => key === source.key ? adapter : null,
  listSources: () => [source],
  summarizeSources: () => ({ total: 1, byStatus: { ready: 1 }, fastSearch: 1 })
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const authHeaders = { Authorization: `Bearer ${token}` };

try {
  const unauthorized = await fetch(`${base}/api/tvbox/health`);
  assert.equal(unauthorized.status, 401);

  const health = await fetch(`${base}/api/tvbox/health`, { headers: authHeaders });
  assert.equal(health.status, 200);
  assert.equal(health.headers.has('x-powered-by'), false);
  const healthBody = await health.json();
  assert.equal(healthBody.status, STATUS.READY);
  assert.equal(healthBody.concurrency.maxConcurrent, 3);

  const firstController = new AbortController();
  const firstRequest = fetch(
    `${base}/api/tvbox/search?sourceKey=${encodeURIComponent(source.key)}&wd=shared`,
    { headers: authHeaders, signal: firstController.signal }
  );
  await started;

  const secondRequest = fetch(
    `${base}/api/tvbox/search?sourceKey=${encodeURIComponent(source.key)}&wd=shared`,
    { headers: authHeaders }
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  firstController.abort();

  await assert.rejects(firstRequest, (error) => error?.name === 'AbortError');
  const survivingResponse = await secondRequest;
  assert.equal(survivingResponse.status, 200);
  assert.equal(survivingResponse.headers.get('x-openstream-cache'), 'COALESCED');
  assert.equal((await survivingResponse.json()).status, STATUS.READY);
  assert.equal(upstreamCalls, 1);
  assert.equal(sharedAbortCount, 0);

  started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const loneController = new AbortController();
  const loneRequest = fetch(
    `${base}/api/tvbox/search?sourceKey=${encodeURIComponent(source.key)}&wd=lone`,
    { headers: authHeaders, signal: loneController.signal }
  );
  await started;
  loneController.abort();
  await assert.rejects(loneRequest, (error) => error?.name === 'AbortError');

  const abortDeadline = Date.now() + 500;
  while (sharedAbortCount === 0 && Date.now() < abortDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(sharedAbortCount, 1, 'last disconnected waiter should abort the adapter signal');

  const bulkResponses = await Promise.all(
    Array.from({ length: 20 }, (_, index) => fetch(
      `${base}/api/tvbox/search?sourceKey=${encodeURIComponent(source.key)}&wd=bulk-${index}`,
      { headers: authHeaders }
    ))
  );
  assert.ok(bulkResponses.every((response) => response.status === 200));
  await Promise.all(bulkResponses.map((response) => response.json()));
  assert.equal(peakAdapterCalls, 3, 'bridge server must enforce its global adapter limit');

  console.log(JSON.stringify({
    ok: true,
    productionFailClosed: true,
    explicitDevelopmentAllowed: true,
    unauthorizedStatus: unauthorized.status,
    coalescedWaiterSurvived: true,
    loneRequestAbortedAdapter: true,
    globalConcurrencyPeak: peakAdapterCalls
  }, null, 2));
} finally {
  server.close();
  await once(server, 'close');
}

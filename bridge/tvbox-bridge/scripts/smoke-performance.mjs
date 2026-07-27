import assert from 'node:assert/strict';
import {
  fetchWithTimeout,
  readResponseJson
} from '../src/http.mjs';
import { createConcurrencyLimiter } from '../src/concurrency-limiter.mjs';
import { createResponseCache } from '../src/response-cache.mjs';

const cache = createResponseCache({ maxEntries: 4 });
let factoryCalls = 0;
const factory = async () => {
  factoryCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 15));
  return { status: 'ready', list: [1] };
};

const [first, coalesced] = await Promise.all([
  cache.getOrCreate('search|test', factory, { ttlMs: 1000 }),
  cache.getOrCreate('search|test', factory, { ttlMs: 1000 })
]);
const hit = await cache.getOrCreate('search|test', factory, { ttlMs: 1000 });

assert.equal(factoryCalls, 1, 'concurrent and repeated requests should share one upstream call');
assert.equal(first.value.status, 'ready');
assert.equal(coalesced.cacheStatus, 'COALESCED');
assert.equal(hit.cacheStatus, 'HIT');

const sharedCache = createResponseCache({ maxEntries: 4 });
const firstWaiter = new AbortController();
const secondWaiter = new AbortController();
let sharedFactoryCalls = 0;
let sharedTaskAborted = false;
const sharedFactory = (signal) => new Promise((resolve, reject) => {
  sharedFactoryCalls += 1;
  const timer = setTimeout(() => resolve({ status: 'ready', list: ['shared'] }), 40);
  signal.addEventListener('abort', () => {
    sharedTaskAborted = true;
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

const disconnected = sharedCache.getOrCreate('search|shared', sharedFactory, {
  signal: firstWaiter.signal,
  ttlMs: 1000
});
await new Promise((resolve) => setTimeout(resolve, 5));
const surviving = sharedCache.getOrCreate('search|shared', sharedFactory, {
  signal: secondWaiter.signal,
  ttlMs: 1000
});
await new Promise((resolve) => setTimeout(resolve, 5));
firstWaiter.abort(new Error('first waiter disconnected'));

await assert.rejects(disconnected, (error) => error?.name === 'AbortError');
const survivingResult = await surviving;
assert.equal(survivingResult.value.status, 'ready');
assert.equal(survivingResult.cacheStatus, 'COALESCED');
assert.equal(sharedFactoryCalls, 1, 'coalesced waiters must use one shared factory');
assert.equal(sharedTaskAborted, false, 'one disconnected waiter must not abort the shared task');

const loneCache = createResponseCache({ maxEntries: 2 });
const loneWaiter = new AbortController();
let loneTaskAborted = false;
const loneRequest = loneCache.getOrCreate(
  'search|lone',
  (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      loneTaskAborted = true;
      reject(signal.reason);
    }, { once: true });
  }),
  { signal: loneWaiter.signal, ttlMs: 1000 }
);
await new Promise((resolve) => setTimeout(resolve, 5));
loneWaiter.abort(new Error('only waiter disconnected'));
await assert.rejects(loneRequest, (error) => error?.name === 'AbortError');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(loneTaskAborted, true, 'shared task should abort after its last waiter disconnects');

let aborted = false;
await assert.rejects(
  fetchWithTimeout(
    async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    'https://upstream.example.test',
    {},
    { timeoutMs: 10 }
  ),
  (error) => error?.name === 'AbortError'
);
assert.equal(aborted, true, 'bridge timeout must abort the underlying fetch');

let bodyAborted = false;
await assert.rejects(
  fetchWithTimeout(
    async (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          bodyAborted = true;
          const error = new Error('body aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }),
    'https://upstream.example.test/body',
    {},
    {
      timeoutMs: 10,
      consume: (response) => response.json()
    }
  ),
  (error) => error?.name === 'AbortError'
);
assert.equal(bodyAborted, true, 'bridge timeout must cover response body consumption');

let redirectCalls = 0;
await assert.rejects(
  fetchWithTimeout(
    async () => {
      redirectCalls += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/internal' }
      });
    },
    'https://public.example.test/start',
    {},
    { timeoutMs: 100 }
  ),
  (error) => error?.code === 'ERR_BLOCKED_REDIRECT'
);
assert.equal(redirectCalls, 1, 'private redirect must be blocked before a second request');

let privateTargetCalls = 0;
await assert.rejects(
  fetchWithTimeout(
    async () => {
      privateTargetCalls += 1;
      return new Response('should not run');
    },
    'http://169.254.169.254/latest/meta-data',
    {},
    { timeoutMs: 100 }
  ),
  (error) => error?.code === 'ERR_BLOCKED_ADDRESS'
);
assert.equal(privateTargetCalls, 0, 'private initial targets must be blocked before fetch');

let publicRedirectCalls = 0;
let redirectedHeaders;
const publicRedirect = await fetchWithTimeout(
  async (_url, options) => {
    publicRedirectCalls += 1;
    if (publicRedirectCalls === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://cdn.example.test/final' }
      });
    }
    redirectedHeaders = new Headers(options.headers);
    return new Response('ok', { status: 200 });
  },
  'https://public.example.test/start',
  {
    headers: {
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      'X-Public-Header': 'keep'
    }
  },
  { timeoutMs: 100 }
);
assert.equal(publicRedirect.status, 200);
assert.equal(publicRedirectCalls, 2);
assert.equal(redirectedHeaders.get('authorization'), null);
assert.equal(redirectedHeaders.get('cookie'), null);
assert.equal(redirectedHeaders.get('x-public-header'), 'keep');

let rejectedRedirectBodyCancelled = 0;
await assert.rejects(
  fetchWithTimeout(
    async () => ({
      status: 307,
      headers: new Headers({ Location: 'https://other.example.test/final' }),
      body: {
        async cancel() {
          rejectedRedirectBodyCancelled += 1;
        }
      }
    }),
    'https://public.example.test/start',
    { method: 'POST', body: 'payload' },
    { timeoutMs: 100 }
  ),
  (error) => error?.code === 'ERR_BLOCKED_REDIRECT'
);
assert.equal(rejectedRedirectBodyCancelled, 1);

let redirectLimitCalls = 0;
let redirectLimitBodiesCancelled = 0;
await assert.rejects(
  fetchWithTimeout(
    async () => {
      redirectLimitCalls += 1;
      return {
        status: 302,
        headers: new Headers({ Location: '/again' }),
        body: {
          async cancel() {
            redirectLimitBodiesCancelled += 1;
          }
        }
      };
    },
    'https://public.example.test/start',
    {},
    { timeoutMs: 100 }
  ),
  (error) => error?.code === 'ERR_TOO_MANY_REDIRECTS'
);
assert.equal(redirectLimitCalls, 4);
assert.equal(redirectLimitBodiesCancelled, 4);

const limiter = createConcurrencyLimiter({ maxConcurrent: 3, maxQueue: 20 });
let active = 0;
let peakActive = 0;
await Promise.all(Array.from({ length: 20 }, (_, index) => limiter.run(async () => {
  active += 1;
  peakActive = Math.max(peakActive, active);
  await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3)));
  active -= 1;
})));
assert.equal(peakActive, 3, 'distinct cache keys must still obey the global adapter limit');

const saturated = createConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 1 });
let releaseSaturated;
const running = saturated.run(() => new Promise((resolve) => {
  releaseSaturated = resolve;
}));
const queued = saturated.run(async () => 'queued');
await assert.rejects(
  saturated.run(async () => 'overflow'),
  (error) => error?.code === 'BRIDGE_BUSY'
);
releaseSaturated();
await Promise.all([running, queued]);

await assert.rejects(
  readResponseJson(new Response(JSON.stringify({ payload: 'x'.repeat(4096) })), 1024),
  (error) => error?.code === 'RESPONSE_TOO_LARGE'
);

console.log(JSON.stringify({
  ok: true,
  cache: { factoryCalls, first: first.cacheStatus, coalesced: coalesced.cacheStatus, hit: hit.cacheStatus },
  sharedCancellation: {
    factoryCalls: sharedFactoryCalls,
    disconnectedWaiterIsolated: !sharedTaskAborted,
    loneTaskAborted
  },
  timeoutAborted: aborted,
  bodyTimeoutAborted: bodyAborted,
  redirectSecurity: {
    privateRedirectBlocked: true,
    privateInitialTargetBlocked: true,
    publicRedirectFollowed: true,
    crossOriginCredentialsStripped: true,
    rejectedBodiesCancelled: true
  },
  concurrency: { peakActive, maxConcurrent: 3 },
  queueOverflowRejected: true,
  oversizedBodyRejected: true
}, null, 2));

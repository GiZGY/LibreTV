import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourceHealthCode = await readFile(new URL('../js/source-health.js', import.meta.url), 'utf8');
const searchCode = await readFile(new URL('../js/search.js', import.meta.url), 'utf8');
const appCode = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

let now = 1_000_000;
class FakeDate extends Date {
  static now() {
    return now;
  }
}

const stored = new Map();
const healthContext = {
  Date: FakeDate,
  console,
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
  localStorage: {
    getItem(key) {
      return stored.has(key) ? stored.get(key) : null;
    },
    setItem(key, value) {
      stored.set(key, String(value));
    }
  },
  API_SITES: {
    'tvbox:demo': { name: 'Bridge demo', bridge: true },
    cms: { name: 'CMS demo' },
    'tvbox:UC': { name: 'UC login source', bridge: true }
  },
  addEventListener() {}
};
healthContext.window = healthContext;
vm.createContext(healthContext);
vm.runInContext(sourceHealthCode, healthContext);

const health = healthContext.OpenStreamSourceHealth;
health.recordSourceEvent('tvbox:demo', { status: 'unsupported', ms: 10 });
assert.equal(health.getSourceStatus('tvbox:demo'), 'unsupported');
assert.equal(health.getSearchPlan(['tvbox:demo']).length, 0);

now += 30 * 60 * 1000 + 1;
const retryPlan = health.getSearchPlan(['tvbox:demo']);
assert.equal(retryPlan.length, 1);
assert.equal(retryPlan[0].tier, 'C');
assert.equal(retryPlan[0].retryDue, true);

health.recordSourceEvent('tvbox:demo', { status: 'ready', ms: 20 });
assert.equal(health.getSourceStatus('tvbox:demo'), 'ready');
health.recordSourceEvent('cms', { status: 'no_result', ms: 30 });
assert.equal(health.getSourceStatus('cms'), 'no_result');
health.recordSourceEvent('cms', { status: 'timeout', ms: 40 });
assert.equal(health.getSourceStatus('cms'), 'timeout');
assert.equal(health.getSearchPlan(['tvbox:UC']).length, 0);

health.recordSourceEvent('confirmed-bad', { status: 'unplayable', ms: 50 });
assert.equal(health.getSourceStatus('confirmed-bad'), 'unplayable');
assert.equal(health.getSearchPlan(['confirmed-bad']).length, 0);
health.recordSourceEvent('confirmed-bad', { status: 'ready', ms: 25 });
assert.equal(
  health.getSourceStatus('confirmed-bad'),
  'unplayable',
  'a search success must not clear a confirmed playback failure'
);
health.recordSourceEvent('confirmed-bad', {
  status: 'ready',
  ms: 25,
  verifiedPlayable: true
});
assert.equal(health.getSourceStatus('confirmed-bad'), 'ready');
health.recordSourceEvent('confirmed-bad', { status: 'unplayable', ms: 50 });
now += 24 * 60 * 60 * 1000 + 1;
assert.equal(health.getSearchPlan(['confirmed-bad'])[0]?.tier, 'C');

for (let index = 0; index < 7; index += 1) {
  health.recordSourceEvent('terminal-source', { status: 'error', ms: 100 });
}
health.recordSourceEvent('terminal-source', { status: 'unplayable', ms: 100 });
assert.equal(
  health.getSourceStatus('terminal-source'),
  'unplayable',
  'failure thresholds must not downgrade terminal states'
);

for (let index = 0; index < 8; index += 1) {
  health.recordSourceEvent('dead-source', { status: 'timeout', ms: 100 });
}
assert.equal(health.getSourceStatus('dead-source'), 'dead');
assert.equal(health.getSearchPlan(['dead-source']).length, 0);

for (let index = 0; index < 8; index += 1) {
  health.recordSourceEvent('fast-failure-source', { status: 'error', ms: 20 });
}
assert.equal(health.getSourceStatus('fast-failure-source'), 'dead');
assert.equal(
  health.getSearchPlan(['fast-failure-source']).length,
  0,
  'permanently broken fast sources must enter cooldown'
);

const qualityStatusStart = appCode.indexOf('function getQualityHealthStatus(');
const qualityStatusEnd = appCode.indexOf('async function runPassiveQualitySample', qualityStatusStart);
assert.ok(qualityStatusStart >= 0 && qualityStatusEnd > qualityStatusStart);
const qualityStatusContext = {};
vm.createContext(qualityStatusContext);
vm.runInContext(appCode.slice(qualityStatusStart, qualityStatusEnd), qualityStatusContext);
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'unplayable',
  playOk: false,
  segmentOk: false
}), 'unplayable');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  playOk: true,
  segmentOk: true
}), 'ready');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchStatus: 'no_result'
}), 'no_result');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'timeout'
}), 'timeout');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'unsupported'
}), 'unsupported');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailStatus: 'error',
  detailOk: false,
  error: 'temporary failure'
}), 'error');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'error',
  error: 'temporary failure'
}), 'error');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'unplayable'
}), 'unplayable');
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  episodesCount: 20,
  searchStatus: 'ready',
  detailStatus: 'ready',
  playTested: false
}), null);
assert.equal(qualityStatusContext.getQualityHealthStatus({
  searchOk: true,
  detailOk: true,
  playTested: true,
  playStatus: 'unknown',
  error: 'probe cannot verify this encryption method'
}), null);

let responseMode = 'empty';
const searchContext = {
  URL,
  URLSearchParams,
  AbortController,
  Response,
  console: {
    ...console,
    warn() {}
  },
  setTimeout,
  clearTimeout,
  SEARCH_FILTERS_CONFIG: {
    default: { type: 'all', year: '', genre: '' },
    types: [{ value: 'all' }, { value: 'movie' }, { value: 'tv' }],
    typeKeywords: { movie: ['电影'], tv: ['电视剧'] }
  },
  API_CONFIG: {
    search: {
      headers: {},
      pageConcurrency: 2,
      maxPages: 1
    }
  },
  PROXY_URL: '/proxy/',
  API_SITES: {
    demo: {
      api: 'https://cms.example.test/api.php/provide/vod',
      name: 'Demo source'
    }
  },
  getCustomApiInfo() {
    return null;
  },
  ProxyAuth: {
    async addAuthToProxyUrl(url) {
      return url;
    }
  }
};
searchContext.window = searchContext;
searchContext.fetch = async () => {
  if (responseMode === 'http-error') return new Response('', { status: 503 });
  if (responseMode === 'invalid-json') {
    return new Response('{not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (responseMode === 'network-error') throw new TypeError('network down');
  return new Response(JSON.stringify({ list: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
vm.createContext(searchContext);
vm.runInContext(searchCode, searchContext);

assert.deepEqual(
  Array.from(await searchContext.searchByAPIAndKeyWord('demo', 'empty-query', {}, { maxPages: 1 })),
  []
);

responseMode = 'http-error';
await assert.rejects(
  searchContext.searchByAPIAndKeyWord('demo', 'http-query', {}, { maxPages: 1 }),
  error => error?.name === 'SourceSearchError' && error?.status === 503
);

responseMode = 'invalid-json';
await assert.rejects(
  searchContext.searchByAPIAndKeyWord('demo', 'json-query', {}, { maxPages: 1 }),
  error => error?.name === 'SourceSearchError'
);

responseMode = 'network-error';
await assert.rejects(
  searchContext.searchByAPIAndKeyWord('demo', 'network-query', {}, { maxPages: 1 }),
  error => error?.name === 'SourceSearchError'
);

console.log(JSON.stringify({
  ok: true,
  statusesDistinct: ['ready', 'timeout', 'unsupported', 'unplayable', 'no_result'],
  suppressedSourceCooldownRetry: true,
  deadStatusIsStable: true,
  fastFailuresEnterCooldown: true,
  confirmedUnplayableSuppressed: true,
  verifiedPlaybackRequiredForRecovery: true,
  httpFailureIsNotNoResult: true,
  invalidPayloadIsNotNoResult: true
}, null, 2));

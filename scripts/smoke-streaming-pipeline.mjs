import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const storage = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  performance,
  AbortController,
  AbortSignal,
  DOMException,
  URL,
  URLSearchParams,
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  }
};
context.window = context;
context.location = { origin: 'http://localhost:8080' };
context.__bridgeResponse = {
  ok: true,
  status: 200,
  body: { status: 'unsupported', list: [] }
};
context.fetch = async (url) => {
  if (String(url).startsWith('http://localhost:8080/api/tvbox/')) {
    return {
      ok: context.__bridgeResponse.ok,
      status: context.__bridgeResponse.status,
      json: async () => context.__bridgeResponse.body
    };
  }
  throw new Error(`unexpected fetch: ${url}`);
};
vm.createContext(context);

function runFile(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

runFile('js/config.js');
storage.set('openstreamSourceHealth', JSON.stringify({
  version: 1,
  updatedAt: Date.now(),
  sources: {
    'tvbox:荐片': {
      status: 'unsupported',
      failure: 3,
      updatedAt: Date.now() - 31 * 60 * 1000
    }
  }
}));
runFile('js/source-health.js');
runFile('js/result-aggregator.js');

vm.runInContext(`
  window.__abortedSources = [];
  window.__tailCalls = 0;
  window.__failedEnrichCalls = 0;
  const mockDelay = (ms, signal, apiId) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      window.__abortedSources.push(apiId);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
  async function searchByAPIAndKeyWord(apiId, query, filters, options = {}) {
    if (apiId === 'failed-fast') {
      window.__failedEnrichCalls += 1;
      await mockDelay(5, options.signal, apiId);
      return [];
    }
    if (apiId === 'tail') {
      window.__tailCalls += 1;
      await mockDelay(10, options.signal, apiId);
      return [{ vod_id: 'tail-id', vod_name: query + ' 特别篇', source_code: apiId, source_name: '补充源' }];
    }
    if (apiId === 'slow') {
      await mockDelay(500, options.signal, apiId);
      return [{ vod_id: '3', vod_name: query + ' 慢源', source_code: apiId, source_name: '慢源' }];
    }
    if (apiId === 'timeout') {
      await mockDelay(5000, options.signal, apiId);
      return [{ vod_id: '4', vod_name: query + ' 超时', source_code: apiId, source_name: '超时源' }];
    }
    await mockDelay(apiId === 'fast2' ? 80 : 20, options.signal, apiId);
    return [{ vod_id: apiId, vod_name: query + ' 第一季', source_code: apiId, source_name: apiId }];
  }
`, context);

runFile('js/source-adapter.js');
runFile('js/streaming-search.js');

const recoveredBridgePlan = context.OpenStreamSourceHealth.getSearchPlan(['tvbox:荐片']);
if (recoveredBridgePlan.length !== 1 || recoveredBridgePlan[0].sourceKey !== 'tvbox:荐片') {
  throw new Error('unsupported bridge sources should be retried after cooldown');
}

const bridgeProbe = await context.OpenStreamSourceAdapter.search('tvbox:厂长', '庆余年', {}, { maxPages: 1 });
if (bridgeProbe.status !== 'unsupported') {
  throw new Error('unconfigured tvbox bridge should report unsupported');
}

context.__bridgeResponse = {
  ok: false,
  status: 503,
  body: { status: 'timeout', message: 'busy', list: [] }
};
const timeoutBridgeProbe = await context.OpenStreamSourceAdapter.search(
  'tvbox:超时源',
  '状态测试',
  {},
  { maxPages: 1, bypassCache: true }
);
if (timeoutBridgeProbe.status !== 'timeout') {
  throw new Error('bridge 503 timeout status must survive the frontend adapter');
}
context.__bridgeResponse = {
  ok: false,
  status: 501,
  body: { status: 'unsupported', message: 'unsupported', list: [] }
};
const unsupportedBridgeProbe = await context.OpenStreamSourceAdapter.search(
  'tvbox:不支持源',
  '状态测试',
  {},
  { maxPages: 1, bypassCache: true }
);
if (unsupportedBridgeProbe.status !== 'unsupported') {
  throw new Error('bridge 501 unsupported status must survive the frontend adapter');
}
context.__bridgeResponse = {
  ok: true,
  status: 200,
  body: { status: 'unsupported', list: [] }
};

const compatibleDuplicateResults = context.OpenStreamResultAggregator.aggregateResults([
  {
    vod_id: 'known',
    vod_name: '庆余年',
    vod_year: '2019',
    type_name: '国产剧',
    source_code: 'known-source',
    source_name: 'Known'
  },
  {
    vod_id: 'partial',
    vod_name: '庆余年',
    vod_year: '',
    type_name: '电视剧',
    source_code: 'partial-source',
    source_name: 'Partial'
  }
]);
if (compatibleDuplicateResults.length !== 1 || compatibleDuplicateResults[0].source_count !== 2) {
  throw new Error('compatible partial metadata should aggregate into one title');
}
const ambiguousSameTitleResults = context.OpenStreamResultAggregator.aggregateResults([
  { vod_id: 'a', vod_name: '同名作品', source_code: 'source-a', source_name: 'A' },
  { vod_id: 'b', vod_name: '同名作品', source_code: 'source-b', source_name: 'B' }
]);
if (ambiguousSameTitleResults.length !== 2) {
  throw new Error('fully ambiguous same-title works must not be blindly merged');
}
const ambiguousPartialMetadataResults = context.OpenStreamResultAggregator.aggregateResults([
  {
    vod_id: 'old',
    vod_name: '同名电影',
    vod_year: '2000',
    type_name: '电影',
    source_code: 'old-source',
    source_name: 'Old'
  },
  {
    vod_id: 'new',
    vod_name: '同名电影',
    vod_year: '2020',
    type_name: '电影',
    source_code: 'new-source',
    source_name: 'New'
  },
  {
    vod_id: 'unknown-year',
    vod_name: '同名电影',
    type_name: '电影',
    source_code: 'partial-source',
    source_name: 'Partial'
  }
]);
if (ambiguousPartialMetadataResults.length !== 3) {
  throw new Error('partial metadata must not be assigned to an arbitrary same-title version');
}
const exactSourceIdentityResults = context.OpenStreamResultAggregator.aggregateResults([
  {
    vod_id: 'same-id',
    vod_name: '示例片',
    vod_year: '2024',
    source_code: 'same-source',
    source_name: 'Same'
  },
  {
    vod_id: 'same-id',
    vod_name: '示例片 高清',
    vod_year: '2025',
    source_code: 'same-source',
    source_name: 'Same'
  }
]);
if (exactSourceIdentityResults.length !== 1 || exactSourceIdentityResults[0].source_count !== 1) {
  throw new Error('the same source and vod id must not render duplicate cards');
}

const updates = [];
const result = await context.OpenStreamStreamingSearch.runStreamingSearch({
  sources: ['fast1', 'fast2', 'slow', 'timeout'],
  query: '庆余年',
  filters: {},
  config: {
    firstPageBudget: 1,
    enrichPageBudget: 1,
    totalBudgetMs: 900,
    sourceConcurrency: 2,
    tierTimeoutMs: { S: 120, A: 120, B: 180, C: 180 },
    minResultsBeforeSkippingSlowTier: 99
  },
  onUpdate(payload) {
    updates.push({
      completed: payload.completed,
      count: payload.results.length
    });
  }
});

if (!updates.some(item => item.count > 0)) {
  throw new Error('streaming search did not emit partial results');
}

if (result.results.length < 1) {
  throw new Error('streaming search returned no aggregated results');
}

const hasAggregatedDuplicate = result.results.some(item => item.source_count >= 2);
if (!hasAggregatedDuplicate) {
  throw new Error('duplicate movie results were not aggregated');
}

if (!context.__abortedSources.includes('slow') || !context.__abortedSources.includes('timeout')) {
  throw new Error(`timed out requests were not aborted: ${JSON.stringify(context.__abortedSources)}`);
}

context.OpenStreamSourceHealth.getSearchPlan = (sourceKeys) => sourceKeys.map((sourceKey, index) => ({
  sourceKey,
  tier: index === sourceKeys.length - 1 ? 'C' : 'S',
  score: 100 - index
}));
const dedupSkipResult = await context.OpenStreamStreamingSearch.runStreamingSearch({
  sources: ['fast1', 'fast2', 'tail'],
  query: '重复结果测试',
  filters: {},
  config: {
    firstPageBudget: 1,
    enrichPageBudget: 1,
    totalBudgetMs: 1000,
    sourceConcurrency: 1,
    tierTimeoutMs: { S: 200, A: 200, B: 200, C: 200 },
    minResultsBeforeSkippingSlowTier: 2
  }
});
if (context.__tailCalls !== 1 || dedupSkipResult.results.length !== 2) {
  throw new Error('slow-tier skipping must use aggregated unique count, not duplicate raw count');
}

context.OpenStreamSourceHealth.getSearchPlan = (sourceKeys) => sourceKeys.map((sourceKey) => ({
  sourceKey,
  tier: 'S',
  score: 100
}));
await context.OpenStreamStreamingSearch.runStreamingSearch({
  sources: ['failed-fast'],
  query: '失败源补页测试',
  filters: {},
  config: {
    firstPageBudget: 1,
    enrichPageBudget: 2,
    totalBudgetMs: 500,
    sourceConcurrency: 1,
    tierTimeoutMs: { S: 100, A: 100, B: 100, C: 100 },
    minResultsBeforeSkippingSlowTier: 99
  }
});
if (context.__failedEnrichCalls !== 1) {
  throw new Error('failed sources must not enter the enrichment phase');
}

context.OpenStreamSourceHealth.getSearchPlan = (sourceKeys) => sourceKeys.map((sourceKey) => ({
  sourceKey,
  tier: 'B',
  score: 0
}));
let hedgeFirstResultAt = null;
const hedgeStartedAt = performance.now();
const originalSearchByApi = context.searchByAPIAndKeyWord;
context.searchByAPIAndKeyWord = async (apiId, query, filters, options = {}) => {
  if (apiId === 'hedge-fast') {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return [{ vod_id: 'hedge-fast', vod_name: query, source_code: apiId, source_name: apiId }];
  }
  if (apiId.startsWith('hedge-slow')) {
    await vm.runInContext('mockDelay', context)(1200, options.signal, apiId);
    return [];
  }
  return originalSearchByApi(apiId, query, filters, options);
};
await context.OpenStreamStreamingSearch.runStreamingSearch({
  sources: ['hedge-slow-1', 'hedge-slow-2', 'hedge-slow-3', 'hedge-slow-4', 'hedge-fast'],
  query: '对冲调度',
  filters: {},
  config: {
    firstPageBudget: 1,
    enrichPageBudget: 1,
    totalBudgetMs: 700,
    sourceConcurrency: 4,
    sourceMaxConcurrency: 5,
    sourceHedgeDelayMs: 60,
    tierTimeoutMs: { S: 600, A: 600, B: 600, C: 600 },
    minResultsBeforeSkippingSlowTier: 99
  },
  onUpdate(payload) {
    if (hedgeFirstResultAt === null && payload.results.length > 0) {
      hedgeFirstResultAt = performance.now() - hedgeStartedAt;
    }
  }
});
if (hedgeFirstResultAt === null || hedgeFirstResultAt > 250) {
  throw new Error(`hedged source was head-of-line blocked for ${hedgeFirstResultAt}ms`);
}

await new Promise((resolve) => setTimeout(resolve, 250));
const healthRaw = storage.get('openstreamSourceHealth');
if (!healthRaw || !JSON.parse(healthRaw).sources.timeout) {
  throw new Error('source health status was not recorded');
}

console.log(JSON.stringify({
  ok: true,
  partialUpdates: updates.length,
  finalResults: result.results.length,
  dedupSkipResults: dedupSkipResult.results.length,
  failedSourceCalls: context.__failedEnrichCalls,
  bridgeStatusesPreserved: true,
  compatibleDuplicatesMerged: compatibleDuplicateResults.length,
  ambiguousTitlesPreserved: ambiguousSameTitleResults.length,
  ambiguousPartialMetadataPreserved: ambiguousPartialMetadataResults.length,
  exactSourceIdentityDeduplicated: exactSourceIdentityResults.length,
  hedgedFirstResultMs: Math.round(hedgeFirstResultAt),
  elapsedMs: result.elapsedMs
}, null, 2));

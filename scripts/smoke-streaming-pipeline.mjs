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
vm.createContext(context);

function runFile(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

runFile('js/config.js');
runFile('js/source-health.js');
runFile('js/result-aggregator.js');

vm.runInContext(`
  const mockDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  async function searchByAPIAndKeyWord(apiId, query, filters, options = {}) {
    if (apiId === 'slow') {
      await mockDelay(500);
      return [{ vod_id: '3', vod_name: query + ' 慢源', source_code: apiId, source_name: '慢源' }];
    }
    if (apiId === 'timeout') {
      await mockDelay(5000);
      return [{ vod_id: '4', vod_name: query + ' 超时', source_code: apiId, source_name: '超时源' }];
    }
    await mockDelay(apiId === 'fast2' ? 80 : 20);
    return [{ vod_id: apiId, vod_name: query + ' 第一季', source_code: apiId, source_name: apiId }];
  }
`, context);

runFile('js/streaming-search.js');

const updates = [];
const result = await context.OpenStreamStreamingSearch.runStreamingSearch({
  sources: ['fast1', 'fast2', 'slow', 'timeout'],
  query: '庆余年',
  filters: {},
  config: {
    firstPageBudget: 1,
    enrichPageBudget: 1,
    totalBudgetMs: 900,
    tierTimeoutMs: { S: 120, A: 120, B: 180, C: 180 },
    tierConcurrency: { S: 2, A: 2, B: 2, C: 1 },
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

const healthRaw = storage.get('openstreamSourceHealth');
if (!healthRaw || !JSON.parse(healthRaw).sources.timeout) {
  throw new Error('source health status was not recorded');
}

console.log(JSON.stringify({
  ok: true,
  partialUpdates: updates.length,
  finalResults: result.results.length,
  elapsedMs: result.elapsedMs
}, null, 2));

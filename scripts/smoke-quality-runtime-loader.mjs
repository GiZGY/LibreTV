import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const start = appSource.indexOf('let qualityRuntimePromise = null;');
const end = appSource.indexOf('function readPassiveQualitySamples()', start);
assert.ok(start >= 0 && end > start, 'quality runtime loader source is missing');

let appendCount = 0;
let failFirstLoad = true;
const context = {
  Error,
  Promise,
  document: {
    body: {
      dataset: {
        qualityRuntimeSrc: 'compiled/quality-runtime.min.js?v=test'
      }
    },
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {};
    },
    head: {
      appendChild(script) {
        appendCount += 1;
        queueMicrotask(() => {
          if (failFirstLoad) {
            failFirstLoad = false;
            script.onerror();
            return;
          }
          context.OpenStreamQualitySelection = {};
          context.OpenStreamPlaybackQuality = {};
          script.onload();
        });
      }
    }
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(appSource.slice(start, end), context);

await assert.rejects(
  context.ensureQualityRuntime(),
  /质量检测模块加载失败/
);
assert.equal(appendCount, 1);

const [firstRetry, secondRetry] = await Promise.all([
  context.ensureQualityRuntime(),
  context.ensureQualityRuntime()
]);
assert.equal(firstRetry, undefined);
assert.equal(secondRetry, undefined);
assert.equal(appendCount, 2, 'concurrent callers must share one retry load');

await context.ensureQualityRuntime();
assert.equal(appendCount, 2, 'loaded runtime must be reused without another request');

console.log(JSON.stringify({
  ok: true,
  failedLoadRetried: true,
  concurrentLoadCoalesced: true,
  loadedRuntimeReused: true
}, null, 2));

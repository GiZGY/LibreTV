import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = { console };
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/quality-selection.js'), 'utf8'),
  context,
  { filename: 'js/quality-selection.js' }
);

const candidates = Array.from({ length: 12 }, (_, index) => ({ apiId: `source-${index + 1}` }));
const verifiedIds = new Set(['source-1', 'source-4', 'source-6', 'source-7', 'source-9']);
const testedIds = [];
const results = await context.OpenStreamQualitySelection.testCandidatesUntilLimit(candidates, {
  batchSize: 5,
  limit: 5,
  async test(candidate) {
    testedIds.push(candidate.apiId);
    const playOk = verifiedIds.has(candidate.apiId);
    return {
      apiId: candidate.apiId,
      quality: {
        score: playOk ? 90 : 80,
        searchOk: true,
        detailOk: true,
        episodesCount: 10,
        playOk,
        segmentOk: playOk
      }
    };
  }
});

const selected = context.OpenStreamQualitySelection.selectVerifiedPlayable(results, 5);
assert.deepEqual(Array.from(selected, (item) => item.apiId), Array.from(verifiedIds));
assert.equal(testedIds.length, 10, 'candidate testing should continue past the first batch, then stop at five playable sources');
assert.ok(
  selected.every((item) => item.quality.playOk && item.quality.segmentOk),
  'unverified media segments must never fill selection slots'
);
assert.equal(
  context.OpenStreamQualitySelection.isVerifiedPlayable({
    quality: {
      searchOk: true,
      detailOk: true,
      episodesCount: 10,
      playOk: true,
      segmentOk: false
    }
  }),
  false,
  'a response without a verified media segment must not be selected'
);
assert.ok(!testedIds.includes('source-11') && !testedIds.includes('source-12'));

let exhaustedCount = 0;
const exhausted = await context.OpenStreamQualitySelection.testCandidatesUntilLimit(candidates.slice(0, 7), {
  batchSize: 3,
  limit: 5,
  async test(candidate) {
    exhaustedCount += 1;
    return {
      apiId: candidate.apiId,
      quality: {
        score: 50,
        searchOk: true,
        detailOk: true,
        episodesCount: 1,
        playOk: false,
        segmentOk: false
      }
    };
  }
});
assert.equal(exhaustedCount, 7, 'all candidates should be tested when fewer than five are playable');
assert.equal(context.OpenStreamQualitySelection.selectVerifiedPlayable(exhausted, 5).length, 0);

let activeWorkers = 0;
let maxActiveWorkers = 0;
const concurrent = await context.OpenStreamQualitySelection.mapWithConcurrency(
  [30, 5, 15, 1],
  {
    concurrency: 2,
    async worker(delay, index) {
      activeWorkers += 1;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      await new Promise((resolve) => setTimeout(resolve, delay));
      activeWorkers -= 1;
      return `${index}:${delay}`;
    }
  }
);
assert.deepEqual(Array.from(concurrent), ['0:30', '1:5', '2:15', '3:1']);
assert.equal(maxActiveWorkers, 2);

console.log(JSON.stringify({
  ok: true,
  tested: testedIds.length,
  selected: selected.length,
  exhaustedCount,
  maxActiveWorkers
}, null, 2));

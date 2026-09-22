import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import vm from 'node:vm';

const fixture = JSON.parse(await readFile(new URL('./fixtures/ad-corpus-20260922.json', import.meta.url), 'utf8'));
const dataIndex = process.argv.indexOf('--data');
const data = dataIndex < 0 ? null : process.argv[dataIndex + 1];
if (dataIndex >= 0 && (!data || !isAbsolute(data))) throw new Error('--data requires an absolute local evidence directory');
// Archive-time regression, not a claim that expired rules remain active today.
const replayTime = Date.parse(fixture.recordedAt + 'T23:59:59Z');
class ReplayDate extends Date { static now() { return replayTime; } }
const context = { window: {}, Date: ReplayDate };
vm.createContext(context);
vm.runInContext(await readFile(new URL('../js/ad-guard.js', import.meta.url), 'utf8'), context);
vm.runInContext(await readFile(new URL('../js/ad-rules.js', import.meta.url), 'utf8'), context);
const guard = context.window.OpenStreamAdGuard;
const rules = context.window.OpenStreamAdRules;
let checkedBytes = 0, positive = 0, negative = 0;
for (const entry of fixture.cases) {
    assert.match(entry.id, /^[a-f0-9]{64}$/);
    assert.ok(['skip', 'preserve'].includes(entry.expectation));
    let time = 20;
    const verified = new Map();
    const fragments = [];
    for (const [index, segment] of entry.segments.entries()) {
        assert.match(segment.sha256, /^[a-f0-9]{64}$/);
        assert.ok(segment.duration > 0);
        if (data) {
            const bytes = await readFile(join(data, 'evidence', entry.id, index + '.bin'));
            assert.equal(createHash('sha256').update(bytes).digest('hex'), segment.sha256, entry.id + ': evidence changed');
            checkedBytes += bytes.length;
        }
        const fragment = {sn:index,url:'https://fixture.invalid/' + index,start:time,duration:segment.duration};
        fragments.push(fragment);
        verified.set(guard.fragmentKey(fragment), segment.sha256);
        time += segment.duration;
    }
    fragments.push({sn:fragments.length,url:'https://fixture.invalid/ending',start:time,duration:60});
    const before = JSON.stringify(fragments);
    const candidates = guard.findCandidates(fragments, rules, replayTime);
    const ranges = candidates.map(candidate=>guard.rangeFor(candidate, verified, time+60)).filter(Boolean);
    if (entry.expectation === 'skip') {
        positive++;
        assert.equal(ranges.length, 1, entry.id + ': reviewed sequence should match once');
        assert.equal(ranges[0].start, 20);
        assert.equal(ranges[0].end, time);
        for (const fragment of fragments.slice(0,-1)) {
            const partial = new Map(verified); partial.delete(guard.fragmentKey(fragment));
            assert.ok(candidates.every(candidate=>!guard.rangeFor(candidate,partial,time+60)), 'missing part must refuse a skip');
        }
    } else {
        negative++;
        assert.equal(ranges.length, 0, entry.id + ': negative control must remain intact');
    }
    assert.equal(JSON.stringify(fragments), before, 'playlist mutation');
}
console.log(JSON.stringify({ok:true,positive,negative,actualBytesVerified:!!data,checkedBytes,
    scope:'captured corpus only; not all-source or full-film coverage'}));

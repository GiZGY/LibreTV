import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/native-ad-evidence.js', import.meta.url), 'utf8'), context);
const { validate } = context.window.OpenStreamNativeAdEvidence;
const now = Date.parse('2026-09-22T12:00:00Z');
const hash = char => char.repeat(64);
const rule = { id: 'fixture', expiresAt: '2026-09-23T12:00:00Z', segments: [
    { duration: 5, sha256: hash('a') }, { duration: 5, sha256: hash('b') }
] };
const evidence = {
    schema: 1, mediaUrlSha256: hash('c'), manifestSha256: hash('d'),
    reviewedAt: '2026-09-22T10:00:00Z', expiresAt: '2026-09-23T10:00:00Z',
    timeline: { engine: 'webkit-native', start: 0, duration: 120 },
    ranges: [{ ruleId: 'fixture', start: 20, end: 30,
        segments: [{ identity: hash('e') }, { identity: hash('f') }] }]
};
const input = { evidence, mediaUrlSha256: hash('c'), manifestSha256: hash('d'),
    duration: 120, timelineStart: 0, now, rules: [rule],
    verifiedSegments: new Map([[hash('e'), hash('a')], [hash('f'), hash('b')]]) };
assert.equal(validate(input).supported, true);
for (const patch of [
    { manifestSha256: hash('a') }, { mediaUrlSha256: hash('a') },
    { duration: 60 }, { duration: Infinity }, { timelineStart: 1 },
    { now: now + 2 * 86400000 }, { rules: [] },
    { rules: [{ ...rule, action: 'report_overlay' }] },
    { verifiedSegments: new Map([[hash('e'), hash('a')]]) },
    { verifiedSegments: new Map([[hash('e'), hash('b')], [hash('f'), hash('a')]]) }
]) assert.equal(validate({ ...input, ...patch }).supported, false);
for (const mutate of [
    e => e.timeline.engine = 'hlsjs', e => e.expiresAt = 'invalid',
    e => e.ranges[0].end = 119, e => e.ranges[0].start = -1,
    e => e.ranges.push(structuredClone(e.ranges[0])),
    e => e.ranges[0].segments[1].identity = hash('e')
]) {
    const changed = structuredClone(evidence); mutate(changed);
    assert.equal(validate({ ...input, evidence: changed }).supported, false);
}
assert.equal(evidence.ranges[0].end, 30, 'validation must not mutate evidence');
console.log('Native evidence contract: exact version, native timing, every hash, expiry, non-overlap and overlay exclusion passed; synthetic contract fixtures only');

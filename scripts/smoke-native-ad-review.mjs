import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { publicEvidence, verifyReview } from './verify-native-ad-review.mjs';

const safe = publicEvidence({ schema: 1, cookie: 'private', mediaUrl: 'private', timeline: { token: 'private' },
    ranges: [{ secret: 'private', segments: [{ url: 'private', key: 'private', index: 1 }] }] });
assert.ok(!JSON.stringify(safe).includes('private'));
const dir = await mkdtemp(join(tmpdir(), 'native-review-'));
const bundlePath = join(dir, 'bundle.json');
try {
    await writeFile(bundlePath, JSON.stringify({ resources: [{ url: 'https://example.test/a', file: '../missing' }] }));
    await assert.rejects(verifyReview(bundlePath));
    await writeFile(bundlePath, JSON.stringify({ resources: [], evidence: {} }));
    await assert.rejects(verifyReview(bundlePath));
    if (process.env.AD_EVIDENCE) {
        const manifest = await readFile(join(process.env.AD_EVIDENCE, 'preview.m3u8'));
        const entries = [...manifest.toString().matchAll(/#EXTINF:([\d.]+),[^\n]*\n(\d+\.bin)(?:\n|$)/g)];
        assert.ok(entries.length > 0);
        const hash = value => createHash('sha256').update(value).digest('hex');
        const context = { window: {} };
        vm.runInNewContext(await readFile(new URL('../js/ad-rules.js', import.meta.url), 'utf8'), context);
        const parts = [];
        for (const entry of entries) {
            await copyFile(join(process.env.AD_EVIDENCE, entry[2]), join(dir, entry[2]));
            parts.push({ duration: Number(entry[1]), sha256: hash(await readFile(join(dir, entry[2]))) });
        }
        const rule = context.window.OpenStreamAdRules.find(rule => rule.segments.length === parts.length &&
            rule.segments.every((part, i) => part.sha256 === parts[i].sha256));
        assert.ok(rule);
        const mediaUrl = 'https://example.test/preview.m3u8';
        const duration = parts.reduce((sum, part) => sum + part.duration, 0);
        const evidence = { schema: 1, mediaUrlSha256: hash(mediaUrl), manifestSha256: hash(manifest),
            reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
            timeline: { engine: 'webkit-native', start: 0, duration },
            ranges: [{ ruleId: rule.id, start: 0, end: duration, segments: entries.map((entry, i) => ({
                index: i, identity: hash(JSON.stringify([i, new URL(entry[2], mediaUrl).href, Number(entry[1])])) })) }] };
        await writeFile(join(dir, 'preview.m3u8'), manifest);
        const bundle = { mediaUrl, evidence, resources: [{ url: mediaUrl, file: 'preview.m3u8' },
            ...entries.map(entry => ({ url: new URL(entry[2], mediaUrl).href, file: entry[2] }))] };
        await writeFile(bundlePath, JSON.stringify(bundle));
        assert.equal((await verifyReview(bundlePath)).evidence.manifestSha256, evidence.manifestSha256);
        await writeFile(join(dir, entries[0][2]), 'changed');
        await assert.rejects(verifyReview(bundlePath));
        console.log('Captured bytes verified and tampering rejected; timing is synthetic in this test, NOT publishable native calibration');
    }
    console.log('Native review: private field removal, invalid/missing evidence rejection passed; no rule published');
} finally { await rm(dir, { recursive: true, force: true }); }

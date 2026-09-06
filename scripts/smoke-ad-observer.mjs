import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { candidateStatus, compileRules, createBudget, discoverBlocks, downloadSegment, LIMITS,
  observeMedia, pruneState, reviewCandidate, sequenceId, sha256 } from '../services/ad-observer/core.mjs';
import { openStore, readSnapshot } from '../services/ad-observer/store.mjs';
import { exportRelease, parseArgs, runCycle } from '../services/ad-observer/worker.mjs';
import { validateRules } from '../services/ad-observer/rule-gate.mjs';

const playlist = '#EXTM3U\n#EXTINF:200,\nfilm.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:5,\na.ts?token=private\n#EXTINF:5,\nb.ts?token=private\n#EXT-X-DISCONTINUITY\n#EXTINF:200,\nrest.ts\n#EXT-X-ENDLIST';
const payloads = [Buffer.from('ad-part-a'), Buffer.from('ad-part-b')];
const read = async url => payloads[url.includes('/a.ts') ? 0 : 1];
const media = { text: playlist, url: 'https://media.test/vod/list.m3u8?signature=private' };
assert.equal(discoverBlocks(playlist).blocks.length, 1);
assert.equal(discoverBlocks(playlist.replace('#EXT-X-ENDLIST', '')).status, 'unsupported_live');
for (const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="key"', '#EXT-X-MAP:URI="init"']) {
  assert.equal(discoverBlocks(playlist.replace('#EXTM3U', '#EXTM3U\n' + tag)).blocks.length, 0);
}
assert.equal(discoverBlocks(playlist.replace('a.ts?token=private', '#EXT-X-BYTERANGE:10@0\na.ts')).blocks.length, 0);
assert.equal(discoverBlocks(playlist.replace('a.ts?token=private', '#EXT-X-GAP\na.ts')).blocks.length, 0);
const mixed = playlist.replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"')
  .replace('#EXT-X-DISCONTINUITY', '#EXT-X-DISCONTINUITY\n#EXT-X-KEY:METHOD=NONE');
assert.equal(discoverBlocks(mixed).blocks.length, 1, 'unencrypted candidates in encrypted films remain inspectable');
const many = '#EXTM3U\n' + Array.from({ length: 10 }, (_, i) => `#EXT-X-DISCONTINUITY\n#EXTINF:5,\na${i}.ts\n#EXTINF:5,\nb${i}.ts`).join('\n') + '\n#EXT-X-ENDLIST';
assert.notEqual(discoverBlocks(many, 0).blocks[0][0].url, discoverBlocks(many, 4).blocks[0][0].url);
assert.equal(discoverBlocks(many).blocks.length, 4);

const state = { candidates: {} };
const budget = createBudget();
const first = await observeMedia({ source: 'sourceA', title: 'Movie A', index: 0, media }, { state, budget, rules: [], read });
const id = first.results[0].id;
assert.equal(first.results[0].status, 'single_title_candidate');
await observeMedia({ source: 'sourceB', title: 'Movie A', index: 0, media }, { state, budget, rules: [], read });
assert.equal(candidateStatus(state.candidates[id], []), 'single_title_candidate', 'same film on another provider is not cross-title confirmation');
const second = await observeMedia({ source: 'sourceB', title: 'Movie B', index: 0, media }, { state, budget, rules: [], read });
assert.equal(second.results[0].status, 'needs_review');
assert.deepEqual(compileRules(state, []), [], 'repeat content is never automatically an ad');
assert.doesNotMatch(JSON.stringify(state), /private|token|signature|\.ts|https:/);
await observeMedia({ source: 'sourceA', title: 'Movie A', index: 0, media }, { state, budget, rules: [], read });
assert.equal(state.candidates[id].observations.length, 3, 'same observation is idempotent');
const failedState = { candidates: {} };
const failed = await observeMedia({ source: 'a', title: 'b', index: 0, media }, {
  state: failedState, budget, rules: [], read: async url => { if (url.includes('/b.ts')) throw new Error('private url'); return payloads[0]; }
});
assert.equal(failed.results[0].status, 'content_fetch_failed');
assert.equal(Object.keys(failedState.candidates).length, 0, 'partial downloads cannot become rules');

let requested = 0;
const blockedBudget = createBudget();
await assert.rejects(downloadSegment('http://127.0.0.1/media', blockedBudget, { fetchImpl: async () => { requested++; } }));
assert.equal(requested, 0);
await assert.rejects(downloadSegment('https://media.test/a', createBudget(), { fetchImpl: async () =>
  new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/credentials' } }) }));
const exhausted = { bytes: LIMITS.bytes, requests: 0 };
await assert.rejects(downloadSegment('https://media.test/a', exhausted), /Budget/);
assert.equal(exhausted.exhausted, true);
const concurrentBudget = { bytes: LIMITS.bytes - LIMITS.segmentBytes, requests: 0 };
let completeFetch;
const pendingDownload = downloadSegment('https://media.test/a', concurrentBudget, {
  fetchImpl: () => new Promise(resolve => { completeFetch = resolve; })
});
await assert.rejects(downloadSegment('https://media.test/b', concurrentBudget), /Budget/);
completeFetch(new Response(payloads[0]));
await pendingDownload;
assert.equal(concurrentBudget.requests, 1, 'concurrent reservations cannot exceed global budget');
const tiny = createBudget();
await downloadSegment('https://media.test/a', tiny, { fetchImpl: async () => new Response(payloads[0]) });
assert.equal(tiny.bytes, payloads[0].length);
await assert.rejects(downloadSegment('https://media.test/a', createBudget(), { fetchImpl: async () =>
  new Response('oversize', { headers: { 'content-length': String(LIMITS.segmentBytes + 1) } }) }));
const alreadyAborted = new AbortController(); alreadyAborted.abort();
await assert.rejects(downloadSegment('https://media.test/a', createBudget(), { signal: alreadyAborted.signal }), { name: 'AbortError' });

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstream-ad-observer-test-'));
let store;
try {
  await fs.chmod(directory, 0o700);
  store = await openStore(directory);
  await assert.rejects(openStore(directory), /locked/);
  const fakeAudit = async ({ onMedia, queries }) => {
    const rows = [];
    for (const query of queries) {
      const observation = await onMedia({ source: 'bfzy', title: query.title, index: 0, media });
      rows.push({ source: 'bfzy', title: query.title, status: 'manifest_analyzed', lines: [{ index: 0, status: 'manifest_analyzed', observation }] });
    }
    return { scope: { sources: 1, titlesPerSource: queries.length }, rows };
  };
  const report = await runCycle(store, { audit: fakeAudit, read });
  assert.equal(report.status, 'completed');
  assert.equal(report.candidates[0].status, 'needs_review');
  assert.equal(report.candidates[0].evidenceAvailable, true);
  assert.equal((await readSnapshot(directory)).runs, 1, 'status can read a complete snapshot while worker owns lock');
  assert.doesNotMatch(JSON.stringify(report), /private|signature|token|https:/);
  const entry = store.state.candidates[id];
  assert.equal(await store.verifyEvidence(entry), id);
  const preview = await fs.readFile(path.join(directory, 'evidence', id, 'preview.m3u8'), 'utf8');
  assert.doesNotMatch(preview, /https:|token/);
  const now = new Date(), expiresAt = new Date(now.getTime() + 86400000).toISOString();
  const review = { verdict: 'ad', reviewedAt: now.toISOString(), expiresAt, evidenceDigest: id };
  assert.throws(() => reviewCandidate(entry, { ...review, evidenceDigest: 'bad' }));
  assert.throws(() => reviewCandidate(entry, { ...review, expiresAt: 'invalid' }));
  reviewCandidate(entry, review);
  const rules = compileRules(store.state, []);
  assert.equal(rules.length, 1);
  assert.throws(() => compileRules({ candidates: {} }, Array.from({ length: 33 }, (_, i) => ({ ...rules[0], id: String(i) }))), /capacity/);
  assert.equal(sequenceId(rules[0].segments), id);
  assert.equal((await validateRules(rules)).status, 'passed');
  await assert.rejects(validateRules([{ ...rules[0], segments: [{ duration: 5, sha256: sha256('a') }] }]));
  assert.equal(candidateStatus(entry, rules), 'known_ad');
  const release = await exportRelease(store);
  assert.equal(release.validation.browserPlayback, 'not_executed');
  assert.equal((await exportRelease(store)).version, release.version);
  reviewCandidate(entry, { ...review, verdict: 'content' });
  assert.equal(compileRules(store.state, rules).length, 0, 'content review withdraws even matching baseline rules');
  assert.equal(candidateStatus(entry, rules), 'confirmed_content');
  reviewCandidate(entry, { ...review, verdict: 'uncertain' });
  assert.equal(compileRules(store.state, []).length, 0);
  assert.equal(compileRules(store.state, rules).length, 0, 'uncertainty suspends a baseline rule too');
  reviewCandidate(entry, review);
  assert.equal(compileRules(store.state, [], new Date(Date.now() + 2 * 86400000)).length, 0, 'sampling does not renew review expiry');
  await fs.writeFile(path.join(directory, 'evidence', id, '0.bin'), 'tampered');
  await assert.rejects(store.verifyEvidence(entry), /Evidence changed/);
  await store.save(); await store.close(); store = await openStore(directory);
  assert.equal(store.state.runs, 1);
  assert.equal(Object.keys(store.state.candidates).length, 1);
  pruneState(store.state, new Date(Date.now() + 31 * 86400000));
  await store.collectExpiredEvidence();
  assert.equal(Object.keys(store.state.candidates).length, 0);
  await assert.rejects(fs.access(path.join(directory, 'evidence', id)), { code: 'ENOENT' });
  const interrupted = new AbortController(); interrupted.abort();
  const partialReport = await runCycle(store, { signal: interrupted.signal, audit: async ({ signal }) => {
    assert.equal(signal.aborted, true); return { scope: {}, rows: [] };
  } });
  assert.equal(partialReport.status, 'interrupted');
} finally {
  if (store) await store.close();
  await fs.rm(directory, { recursive: true, force: true });
}

assert.equal(parseArgs(['once', '--data', '/tmp/private']).command, 'once');
assert.throws(() => parseArgs(['watch', '--data', '/tmp/private', '--interval-hours', '0']));
assert.throws(() => parseArgs(['review', '--data', '/tmp/private', '--id', id, '--verdict', 'ad']));
assert.throws(() => parseArgs(['once', '--data', '/tmp/a', '--data', '/tmp/b']));
assert.throws(() => parseArgs(['typo', '--data', '/tmp/private']));
const foreignDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstream-ad-observer-foreign-'));
try {
  await fs.chmod(foreignDirectory, 0o700);
  await fs.writeFile(path.join(foreignDirectory, 'user-file.txt'), 'keep');
  await assert.rejects(openStore(foreignDirectory), /empty dedicated/);
  assert.equal(await fs.readFile(path.join(foreignDirectory, 'user-file.txt'), 'utf8'), 'keep');
} finally { await fs.rm(foreignDirectory, { recursive: true }); }
console.log(JSON.stringify({ ok: true, repeatIsNotAd: true, encryptedPreserved: true, privateAddressBlocked: true,
  boundedTraffic: true, atomicStore: true, evidenceIntegrity: true, expiryAndRevocation: true,
  runtimeMatcherGate: true, productionDeployment: false }));

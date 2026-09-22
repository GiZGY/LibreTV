import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSite, selectSample } from './audit-source-health.mjs';

const site = { name: 'Fixture', api: 'https://fixture.example/api.php/provide/vod' };
const video = { vod_id: 1, vod_name: '星际穿越', vod_play_url: '正片$https://media.example/index.m3u8?secret=private' };
test('sample selects the film rather than a documentary about the film', () => {
  const doc = { vod_name: '《星际穿越》中的科学' };
  const version = { vod_name: '星际穿越(原声版)' };
  assert.equal(selectSample([doc, version], '星际穿越'), version);
  assert.equal(selectSample([doc, version, video], '星际穿越'), video);
});
test('health audit requires detail, playlist and segment; report contains no media URLs', async () => {
  const calls = [];
  const requestImpl = async (value, sample) => {
    const url = new URL(value); calls.push([url, sample]);
    if (sample) return { bytes: 65536 };
    if (url.hostname === 'media.example') return { text: '#EXTM3U\n#EXTINF:8,\nfirst.ts\n#EXTINF:8,\nsecond.ts', url: url.href };
    return { text: JSON.stringify({ list: [video] }) };
  };
  const row = await probeSite('fixture', site, '星际穿越', { requestImpl });
  assert.equal(row.status, 'sample_reachable');
  assert.equal(calls.length, 4);
  assert.equal(calls[1][0].searchParams.get('ids'), '1');
  assert.equal(calls[3][0].pathname, '/second.ts');
  assert.doesNotMatch(JSON.stringify(row), /private|media\.example|m3u8/);
});
test('empty search, invalid response, failure and timeout remain distinct', async () => {
  for (const [status, response] of [['no_result', { list: [] }], ['invalid_response', {}]]) {
    const row = await probeSite('fixture', site, '星际穿越', { requestImpl: async () => ({ text: JSON.stringify(response) }) });
    assert.equal(row.status, status);
  }
  const row = await probeSite('fixture', site, '星际穿越', { requestImpl: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } });
  assert.equal(row.status, 'timeout');
});
test('a valid catalogue alone is not a playable source', async () => {
  const row = await probeSite('fixture', site, '星际穿越', { requestImpl: async value => {
    if (new URL(value).hostname === 'media.example') throw Object.assign(new Error(), { status: 403 });
    return { text: JSON.stringify({ list: [video] }) };
  } });
  assert.equal(row.status, 'media_unavailable');
  assert.equal(row.lines[0].status, 'access_denied');
});

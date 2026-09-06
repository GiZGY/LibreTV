import assert from 'node:assert/strict';
import { selectMovie, cmsPlaylists, failureStatus, resolveMedia, parseOptions, runAudit } from './audit-source-ads.mjs';
import { auditPlaylist } from './audit-hls-ads.mjs';

const movie = { vod_name: 'X战警：天启', vod_id: 1 };
assert.deepEqual(parseOptions(['--sources', 'bfzy', '--out', '/tmp/report.json']), { '--sources': 'bfzy', '--out': '/tmp/report.json' });
assert.throws(() => parseOptions(['--sources']), /arguments/);
assert.throws(() => parseOptions(['--typo', 'value']), /arguments/);
assert.throws(() => parseOptions(['--sources', 'bfzy', '--sources', 'mdzy']), /arguments/);
await assert.rejects(runAudit({ sources: ['unknown-source'] }), /Unknown source/);
assert.equal(selectMovie([{ vod_name: 'X战警：天启[解说]' }, movie], 'X 战警:天启'), movie);
assert.equal(selectMovie({}, 'example'), undefined);
assert.deepEqual(cmsPlaylists({ vod_play_url: 'HD$https://a.test/a.m3u8?signature=private$$$HD$https://a.test/a.m3u8?signature=private#2$https://a.test/b.m3u8$$$HD$https://a.test/c.m3u8' }), ['https://a.test/a.m3u8?signature=private', 'https://a.test/b.m3u8']);
assert.deepEqual(cmsPlaylists({ vod_play_url: 'HD$javascript:alert(1)$$$HD$magnet:x' }), []);
assert.equal(failureStatus({ name: 'AbortError' }), 'timeout');
assert.equal(failureStatus({ status: 403 }), 'access_denied');
assert.equal(failureStatus({ code: 'ERR_BLOCKED_ADDRESS' }), 'blocked_address');
assert.equal(failureStatus(new SyntaxError('private data')), 'invalid_json');
assert.equal(failureStatus(new Error('private data')), 'fetch_failed');

const media = '#EXTM3U\n#EXTINF:10,\nfilm.ts\n#EXT-X-ENDLIST';
const requests = [];
const result = await resolveMedia('https://start.test/master', async url => {
  requests.push(url);
  return requests.length === 1
    ? { text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200\nhigh/index.m3u8', url: 'https://redirect.test/path/master.m3u8' }
    : { text: media, url };
});
assert.equal(result.text, media);
assert.deepEqual(requests, ['https://start.test/master', 'https://redirect.test/path/low/index.m3u8']);
await assert.rejects(resolveMedia('https://a.test/a', async url => ({ text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\na', url })), /cycle/);
await assert.rejects(resolveMedia('https://a.test/a', async url => ({ text: '<html>login</html>', url })), /Invalid playlist/);
let nested = 0;
await assert.rejects(resolveMedia('https://a.test/a', async url => ({ text: `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n${++nested}`, url })), /nesting limit/);
assert.equal(nested, 4);

const audit = auditPlaylist('#EXTM3U\n#EXTINF:2,\na.ts?token=private\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\na.ts?token=private\n#EXT-X-ENDLIST');
assert.equal(audit.candidates[0].status, 'needs_content_verification');
assert.doesNotMatch(JSON.stringify(audit), /token|private|\.ts/);
assert.equal(auditPlaylist(media).candidates.length, 0);
console.log(JSON.stringify({ ok: true, exactTitle: true, boundedRenditions: true, timeoutNotEmpty: true, redactedReports: true, candidatesNotConfirmed: true }));

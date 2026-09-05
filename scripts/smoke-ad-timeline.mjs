import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const start = source.indexOf('function filterAdsFromM3U8(');
const end = source.indexOf('// 显示错误', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

// A timestamp reset may occur inside the main film, including encrypted media.
const playlist = [
  '#EXTM3U', '#EXT-X-TARGETDURATION:10', '#EXT-X-MEDIA-SEQUENCE:40',
  '#EXT-X-DISCONTINUITY-SEQUENCE:3',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXTINF:10,', 'film-40.ts', '#EXT-X-DISCONTINUITY',
  '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:10,', 'film-41.m4s',
  '#EXTINF:10,', 'film-42.m4s', '#EXT-X-ENDLIST', ''
].join('\r\n');
for (const strict of [false, true]) {
  assert.equal(context.filterAdsFromM3U8(playlist, strict), playlist);
}
assert.match(source, /loader: Hls\.DefaultConfig\.loader/);
assert.doesNotMatch(source, /loader: adFilteringEnabled \?/);
console.log('HLS timeline preserved, including boundaries, encryption and final segments');

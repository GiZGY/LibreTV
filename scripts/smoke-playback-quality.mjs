import assert from 'node:assert/strict';
import { createCipheriv, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../js/playback-quality.js', import.meta.url), 'utf8');
const sandbox = {
  AbortController,
  TextDecoder,
  URL,
  Uint8Array,
  crypto: webcrypto,
  fetch,
  performance
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'playback-quality.js' });

const requests = [];
const encryptionKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const encryptionIv = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
const encryptedPlaintext = Buffer.alloc(376);
encryptedPlaintext[0] = 0x47;
encryptedPlaintext[188] = 0x47;
const cipher = createCipheriv('aes-128-cbc', encryptionKey, encryptionIv);
const encryptedSegmentBytes = Buffer.concat([
  cipher.update(encryptedPlaintext),
  cipher.final()
]);
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, range: req.headers.range || '' });
  if (req.url === '/master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n/media.m3u8\n');
  }
  if (req.url === '/media.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end('#EXTM3U\n#EXTINF:6,\n/segment.ts\n#EXT-X-ENDLIST\n');
  }
  if (req.url === '/image-master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end('#EXTM3U\n#EXTINF:6,\n/poster.jpg\n#EXT-X-ENDLIST\n');
  }
  if (req.url === '/garbage-master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end('#EXTM3U\n#EXTINF:6,\n/garbage.ts\n#EXT-X-ENDLIST\n');
  }
  if (req.url === '/garbage.ts') {
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.end(Buffer.from('not a media segment'));
  }
  if (req.url === '/gateway-master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end('#EXTM3U\n#EXTINF:6,\n/gateway.ts\n#EXT-X-ENDLIST\n');
  }
  if (req.url === '/gateway.ts') {
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.end('Gateway timeout');
  }
  if (req.url === '/encrypted-master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end([
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:42',
      '#EXT-X-KEY:METHOD=AES-128,URI="/key.bin",IV=0xffeeddccbbaa99887766554433221100',
      '#EXTINF:6,',
      '/encrypted.ts',
      '#EXT-X-ENDLIST'
    ].join('\n'));
  }
  if (req.url === '/sample-aes-master.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end([
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="/key.bin"',
      '#EXTINF:6,',
      '/encrypted.ts',
      '#EXT-X-ENDLIST'
    ].join('\n'));
  }
  if (req.url === '/key.bin') {
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.end(encryptionKey);
  }
  if (req.url === '/encrypted.ts') {
    res.statusCode = req.headers.range ? 206 : 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.end(encryptedSegmentBytes);
  }
  if (req.url === '/poster.jpg') {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
  }
  if (req.url === '/segment.ts') {
    res.statusCode = req.headers.range ? 206 : 200;
    res.setHeader('Content-Type', 'video/mp2t');
    const segment = Buffer.alloc(376);
    segment[0] = 0x47;
    segment[188] = 0x47;
    return res.end(segment);
  }
  if (req.url === '/fake.m3u8') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><title>blocked</title>');
  }
  if (req.url === '/direct.mp4') {
    res.setHeader('Content-Type', 'video/mp4');
    return res.end(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
  }
  res.statusCode = 404;
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

try {
  const probe = sandbox.OpenStreamPlaybackQuality.probePlayback;
  sandbox.location = { href: `${base}/` };
  const relativeFetch = (url, options) => fetch(new URL(url, base), options);
  const hls = await probe('/master.m3u8', { fetchImpl: relativeFetch });
  assert.equal(hls.playOk, true);
  assert.equal(hls.segmentOk, true);
  assert.ok(requests.some((entry) => entry.url === '/segment.ts' && entry.range === 'bytes=0-4095'));

  const direct = await probe(`${base}/direct.mp4`, { fetchImpl: fetch });
  assert.equal(direct.playOk, true);
  assert.equal(direct.segmentOk, true);

  const fake = await probe(`${base}/fake.m3u8`, { fetchImpl: fetch });
  assert.equal(fake.playOk, false);
  assert.equal(fake.segmentOk, false);

  const imageSegment = await probe(`${base}/image-master.m3u8`, { fetchImpl: fetch });
  assert.equal(imageSegment.playOk, false);
  assert.equal(imageSegment.segmentOk, false);

  const garbageSegment = await probe(`${base}/garbage-master.m3u8`, { fetchImpl: fetch });
  assert.equal(garbageSegment.playOk, false);
  assert.equal(garbageSegment.segmentOk, false);

  const gatewaySegment = await probe(`${base}/gateway-master.m3u8`, { fetchImpl: fetch });
  assert.equal(gatewaySegment.playOk, false);
  assert.equal(gatewaySegment.segmentOk, false);

  const encryptedSegment = await probe(`${base}/encrypted-master.m3u8`, { fetchImpl: fetch });
  assert.equal(encryptedSegment.playOk, true);
  assert.equal(encryptedSegment.segmentOk, true);
  assert.equal(encryptedSegment.encrypted, true);
  assert.ok(requests.some((entry) => entry.url === '/key.bin'));

  const unknownEncryption = await probe(`${base}/sample-aes-master.m3u8`, { fetchImpl: fetch });
  assert.equal(unknownEncryption.playOk, false);
  assert.equal(unknownEncryption.segmentOk, false);
  assert.equal(unknownEncryption.inconclusive, true);

  console.log('playback quality smoke passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import {
  createProxyToken,
  createResourceProxyToken,
  createSessionToken
} from '../server/auth-session.mjs';

process.env.UPSTREAM_TIMEOUT_MS = '40';
const { createProxyHandler, proxyInternals } = await import('../api/proxy/[...path].mjs');

const env = { PASSWORD: 'proxy-smoke-password' };
const fixedNow = 1_800_000_000_000;
const proxyAuth = createProxyToken(env, fixedNow);

class MockRequest extends EventEmitter {
  constructor(target, overrides = {}) {
    super();
    this.method = 'GET';
    this.headers = { accept: '*/*' };
    this.query = {
      auth: proxyAuth.token,
      t: String(proxyAuth.bucket),
      '...path': encodeURIComponent(target)
    };
    this.url = `/proxy/${encodeURIComponent(target)}`;
    Object.assign(this, overrides);
  }
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
    this.headersSent = false;
  }

  _write(chunk, _encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
    return this;
  }

  removeHeader(name) {
    this.headers.delete(String(name).toLowerCase());
    return this;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  send(value = '') {
    this.headersSent = true;
    if (value !== undefined && value !== null) {
      this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    }
    this.end();
    return this;
  }

  json(value) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.send(JSON.stringify(value));
  }

  body() {
    return Buffer.concat(this.chunks);
  }
}

async function runHandler(fetchImpl, request) {
  const handler = createProxyHandler({ fetchImpl, env, now: () => fixedNow });
  const response = new MockResponse();
  await handler(request, response);
  if (!response.writableEnded && !response.destroyed) {
    await new Promise((resolve) => {
      response.once('finish', resolve);
      response.once('close', resolve);
    });
  }
  return response;
}

let fetchCalls = 0;
const masterPlaylist = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/main.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=400000,AUDIO="audio"',
  'low.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=1800000,AUDIO="audio"',
  'high.m3u8',
  '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframe.m3u8"',
  ''
].join('\n');

const playlist = await runHandler(async () => {
  fetchCalls += 1;
  return new Response(masterPlaylist, {
    status: 200,
    headers: { 'content-type': 'application/vnd.apple.mpegurl' }
  });
}, new MockRequest('https://media.example/master.m3u8'));
const playlistBody = playlist.body().toString();
assert.equal(playlist.statusCode, 200);
assert.equal(fetchCalls, 1, 'master playlist variants must not be fetched recursively');
assert.match(playlistBody, /audio%2Fmain\.m3u8/);
assert.match(playlistBody, /low\.m3u8/);
assert.match(playlistBody, /high\.m3u8/);
assert.match(playlistBody, /iframe\.m3u8/);
assert.match(playlistBody, /resource=/);
assert.match(playlistBody, /rb=/);
assert.match(playlist.headers.get('cache-control'), /max-age=60/);

const mediaPlaylist = await runHandler(async () => new Response(
  '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nsegment.ts\n',
  { headers: { 'content-type': 'text/plain' } }
), new MockRequest('https://media.example/video/index.m3u8'));
const mediaBody = mediaPlaylist.body().toString();
assert.match(mediaBody, /key\.bin/);
assert.match(mediaBody, /init\.mp4/);
assert.match(mediaBody, /segment\.ts/);

const image = await runHandler(async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
  status: 200,
  headers: {
    'content-type': 'image/png',
    etag: '"poster"',
    'set-cookie': 'session=leak',
    'clear-site-data': '"cookies"'
  }
}), new MockRequest('https://images.example/poster.png'));
assert.deepEqual(Array.from(image.body()), [137, 80, 78, 71]);
assert.equal(image.headers.get('etag'), '"poster"');
assert.equal(image.headers.has('set-cookie'), false);
assert.equal(image.headers.has('clear-site-data'), false);
assert.equal(image.headers.get('x-content-type-options'), 'nosniff');

const json = await runHandler(async () => new Response('{"ok":true}', {
  headers: {
    'content-type': 'text/html',
    'set-cookie': 'secret=value',
    'content-security-policy': 'default-src *'
  }
}), new MockRequest('https://api.example/data'));
assert.equal(json.statusCode, 200);
assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');
assert.equal(json.headers.has('set-cookie'), false);
assert.equal(json.headers.has('content-security-policy'), false);

const html = await runHandler(async () => new Response('<html><script>alert(1)</script></html>', {
  headers: { 'content-type': 'text/html' }
}), new MockRequest('https://unsafe.example/page'));
assert.equal(html.statusCode, 415);
assert.doesNotMatch(html.body().toString(), /alert|unsafe\.example/);

for (const target of [
  'http://127.0.0.1/private',
  'http://10.0.0.1/private',
  'http://192.168.1.1/private',
  'http://172.16.0.1/private',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1]/private',
  'http://[::ffff:127.0.0.1]/private'
]) {
  let called = false;
  const blocked = await runHandler(async () => {
    called = true;
    return new Response('unexpected');
  }, new MockRequest(target));
  assert.equal(blocked.statusCode, 400, `${target} should be blocked`);
  assert.equal(called, false, `${target} must not reach fetch`);
}

let redirectCalls = 0;
const redirectBlocked = await runHandler(async () => {
  redirectCalls += 1;
  return new Response(null, {
    status: 302,
    headers: { location: 'http://127.0.0.1/admin' }
  });
}, new MockRequest('https://public.example/redirect'));
assert.equal(redirectBlocked.statusCode, 400);
assert.equal(redirectCalls, 1);

const resourceTarget = 'https://media.example/video/segment.ts';
const resourceAuth = createResourceProxyToken(resourceTarget, env, fixedNow);
const resourceRequest = new MockRequest(resourceTarget, {
  query: {
    resource: resourceAuth.token,
    rb: String(resourceAuth.bucket),
    '...path': encodeURIComponent(resourceTarget)
  }
});
const resourceResponse = await runHandler(async () => new Response(Uint8Array.from([1, 2, 3]), {
  headers: { 'content-type': 'video/mp2t' }
}), resourceRequest);
assert.equal(resourceResponse.statusCode, 200);
assert.deepEqual(Array.from(resourceResponse.body()), [1, 2, 3]);

const wrongResourceTarget = 'https://media.example/video/other.ts';
const wrongResource = await runHandler(async () => new Response('unexpected'), new MockRequest(wrongResourceTarget, {
  query: {
    resource: resourceAuth.token,
    rb: String(resourceAuth.bucket),
    '...path': encodeURIComponent(wrongResourceTarget)
  }
}));
assert.equal(wrongResource.statusCode, 401, 'resource token must be bound to one URL');

const sessionToken = createSessionToken(env, fixedNow);
const sessionResponse = await runHandler(async () => new Response('{"session":true}', {
  headers: { 'content-type': 'application/json' }
}), new MockRequest('https://api.example/session', {
  headers: {
    accept: 'application/json',
    cookie: `openstream_session=${encodeURIComponent(sessionToken)}`
  },
  query: {
    '...path': encodeURIComponent('https://api.example/session')
  }
}));
assert.equal(sessionResponse.statusCode, 200);
assert.match(sessionResponse.headers.get('cache-control'), /private, no-store/);

const invalidAuth = await runHandler(async () => new Response('unexpected'), new MockRequest(
  'https://safe.example/file',
  {
    query: {
      auth: 'invalid',
      t: String(proxyAuth.bucket),
      '...path': encodeURIComponent('https://safe.example/file')
    }
  }
));
assert.equal(invalidAuth.statusCode, 401);

let timeoutAborted = false;
const timeoutStart = Date.now();
const timedOut = await runHandler((_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => {
    timeoutAborted = true;
    reject(options.signal.reason);
  }, { once: true });
}), new MockRequest('https://slow.example/secret?token=do-not-leak'));
assert.equal(timedOut.statusCode, 504);
assert.equal(timeoutAborted, true);
assert.ok(Date.now() - timeoutStart < 500);
assert.doesNotMatch(timedOut.body().toString(), /slow\.example|do-not-leak/);

assert.equal(proxyInternals.isForbiddenAddress('100.64.0.1'), true);
assert.equal(proxyInternals.isForbiddenAddress('224.0.0.1'), true);
assert.equal(proxyInternals.isForbiddenAddress('8.8.8.8'), false);
assert.equal(proxyInternals.isForbiddenHostname('service.local'), true);

console.log(JSON.stringify({
  ok: true,
  adaptiveVariantsPreserved: 2,
  playlistFetches: fetchCalls,
  privateTargetsBlocked: 7,
  redirectValidation: true,
  responseHeaderAllowlist: true,
  resourceTokenBoundToUrl: true,
  streamTimeoutAborted: timeoutAborted
}, null, 2));

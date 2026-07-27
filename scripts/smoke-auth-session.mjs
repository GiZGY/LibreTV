import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import {
  AUTH_COOKIE_NAME,
  createProxyToken,
  createResourceProxyToken,
  createSessionToken,
  verifyPassword,
  verifyProxyToken,
  verifyResourceProxyToken,
  verifySessionToken
} from '../server/auth-session.mjs';

process.env.PASSWORD = 'auth-smoke-password';
const authHandler = (await import('../api/auth/[action].mjs')).default;
const tvboxHandler = (await import('../api/tvbox/[action].mjs')).default;
const env = { PASSWORD: process.env.PASSWORD };
const now = Date.now();

class MockRequest extends EventEmitter {
  constructor({ method = 'GET', action = 'status', headers = {}, body } = {}) {
    super();
    this.method = method;
    this.query = { action };
    this.headers = headers;
    this.body = body;
    this.socket = { remoteAddress: '198.51.100.20' };
  }
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
    return this;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  json(value) {
    this.chunks.push(Buffer.from(JSON.stringify(value)));
    this.end();
    return this;
  }
  bodyJson() {
    return JSON.parse(Buffer.concat(this.chunks).toString('utf8'));
  }
}

async function invoke(handler, request) {
  const response = new MockResponse();
  await handler(request, response);
  return response;
}

assert.equal(verifyPassword('auth-smoke-password', env), true);
assert.equal(verifyPassword('wrong', env), false);
assert.equal((await import('../server/auth-session.mjs')).isPasswordConfigured({ PASSWORD: 'short' }), false);
const weakEnv = { PASSWORD: 'short-pass' };
assert.equal(verifyPassword('short-pass', weakEnv), false);
assert.equal(createSessionToken(weakEnv, now), '');
assert.equal(verifySessionToken(createSessionToken(weakEnv, now), weakEnv, now), false);
assert.equal(createProxyToken(weakEnv, now), null);
assert.equal(verifyProxyToken('guessed-token', now, weakEnv, now), false);
assert.equal(createResourceProxyToken('https://media.example/segment.ts', weakEnv, now), null);

const session = createSessionToken(env, now);
assert.equal(verifySessionToken(session, env, now), true);
assert.equal(verifySessionToken(`${session}tampered`, env, now), false);
assert.equal(verifySessionToken(session, env, now + 31 * 24 * 60 * 60 * 1000), false);

const proxy = createProxyToken(env, now);
assert.equal(verifyProxyToken(proxy.token, proxy.bucket, env, now), true);
assert.equal(verifyProxyToken(proxy.token, proxy.bucket, env, now + 11 * 60 * 1000), false);

const resourceUrl = 'https://media.example/segment.ts';
const resource = createResourceProxyToken(resourceUrl, env, now);
assert.equal(verifyResourceProxyToken(resourceUrl, resource.token, resource.bucket, env, now), true);
assert.equal(verifyResourceProxyToken(`${resourceUrl}?other=1`, resource.token, resource.bucket, env, now), false);

const login = await invoke(authHandler, new MockRequest({
  method: 'POST',
  action: 'login',
  headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
  body: { password: process.env.PASSWORD }
}));
assert.equal(login.statusCode, 200);
assert.equal(login.bodyJson().authenticated, true);
const cookie = String(login.headers.get('set-cookie'));
assert.match(cookie, new RegExp(`^${AUTH_COOKIE_NAME}=`));
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Strict/);
assert.match(cookie, /Secure/);

const cookiePair = cookie.split(';')[0];
const status = await invoke(authHandler, new MockRequest({
  action: 'status',
  headers: { cookie: cookiePair }
}));
assert.equal(status.statusCode, 200);
assert.equal(status.bodyJson().authenticated, true);
assert.ok(status.bodyJson().proxy?.token);

const unauthenticatedStatus = await invoke(authHandler, new MockRequest({ action: 'status' }));
assert.equal(unauthenticatedStatus.bodyJson().authenticated, false);
assert.equal(unauthenticatedStatus.bodyJson().proxy, null);

const logout = await invoke(authHandler, new MockRequest({
  method: 'POST',
  action: 'logout',
  headers: { cookie: cookiePair, 'x-forwarded-proto': 'https' }
}));
assert.equal(logout.statusCode, 200);
assert.match(String(logout.headers.get('set-cookie')), /Max-Age=0/);

let rateLimited = null;
for (let index = 0; index < 9; index += 1) {
  rateLimited = await invoke(authHandler, new MockRequest({
    method: 'POST',
    action: 'login',
    headers: { 'x-forwarded-for': `203.0.113.${index + 1}` },
    body: { password: 'wrong-password' }
  }));
}
assert.equal(
  rateLimited.statusCode,
  429,
  'untrusted forwarded headers must not bypass the per-client limiter'
);

const tvboxUnauthenticated = await invoke(tvboxHandler, new MockRequest({
  action: 'health'
}));
assert.equal(tvboxUnauthenticated.statusCode, 401);

for (const file of ['index.html', 'player.html']) {
  const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\{\{PASSWORD\}\}|window\.__ENV__\.PASSWORD|libs\/sha256/);
}

console.log(JSON.stringify({
  ok: true,
  httpOnlySession: true,
  shortLivedProxyToken: true,
  targetBoundResourceToken: true,
  unauthenticatedTvboxBlocked: true,
  passwordNotEmbeddedInHtml: true
}, null, 2));

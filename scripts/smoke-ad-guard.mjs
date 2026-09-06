import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { auditPlaylist } from './audit-hls-ads.mjs';

const source = fs.readFileSync(new URL('../js/ad-guard.js', import.meta.url), 'utf8');
const audit = auditPlaylist('#EXTM3U\n#EXTINF:40,\nfilm.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:5,\na.ts?token=private\n#EXT-X-DISCONTINUITY\n#EXTINF:40,\nrest.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:5,\na.ts?token=private\n#EXT-X-ENDLIST');
assert.equal(audit.duration, 90);
assert.equal(audit.candidates.length, 1);
assert.equal(audit.candidates[0].status, 'needs_content_verification');
assert.doesNotMatch(JSON.stringify(audit), /private|token/);
const context = vm.createContext({ console, Uint8Array, setTimeout, clearTimeout });
context.window = context;
context.crypto = webcrypto;
context.document = { createElement: () => ({
  children: [], handlers: {}, setAttribute() {}, remove() { this.removed = true; },
  addEventListener(name, callback) { this.handlers[name] = callback; },
  append(...children) { this.children.push(...children); }
}) };
vm.runInContext(source, context);
const guard = context.OpenStreamAdGuard;
const payloads = [Buffer.from('confirmed-ad-part-1'), Buffer.from('confirmed-ad-part-2')];
const hashes = payloads.map(payload => createHash('sha256').update(payload).digest('hex'));
const rule = { id: 'fixture', expiresAt: new Date(Date.now() + 86400000).toISOString(), segments: hashes.map(sha256 => ({ duration: 5, sha256 })) };
const fragments = [
  { sn: 1, url: 'https://media.test/film.ts', start: 0, duration: 20, type: 'main' },
  { sn: 2, url: 'https://media.test/a.ts', start: 20, duration: 5, type: 'main' },
  { sn: 3, url: 'https://media.test/b.ts', start: 25, duration: 5, type: 'main' },
  { sn: 4, url: 'https://media.test/rest.ts', start: 30, duration: 3570, type: 'main' }
];
const before = JSON.stringify(fragments);
const candidates = guard.findCandidates(fragments, [rule]);
assert.equal(candidates.length, 1);
assert.equal(guard.rangeFor(candidates[0], new Map(), 3600), null);
const verified = new Map([[guard.fragmentKey(fragments[1]), hashes[0]], [guard.fragmentKey(fragments[2]), hashes[1]]]);
assert.equal(guard.rangeFor(candidates[0], verified, 3600).end, 30);
assert.equal(guard.rangeFor(candidates[0], verified, 29), null);
assert.equal(guard.rangeFor(candidates[0], verified, Infinity), null);
assert.equal(guard.findCandidates(fragments, [{ ...rule, expiresAt: '2000-01-01' }]).length, 0);
const mismatch = new Map(verified); mismatch.set(guard.fragmentKey(fragments[2]), 'changed-bytes');
assert.equal(guard.rangeFor(candidates[0], mismatch, 3600), null);
const repeated = { ...candidates[0], parts: candidates[0].parts.map(frag => ({ ...frag, sn: frag.sn + 10 })) };
assert.equal(guard.rangeFor(repeated, verified, 3600), null, 'a repeated URL must be verified for the new occurrence');

class Emitter {
  events = new Map();
  on(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
  off(name, callback) { this.events.get(name)?.delete(callback); }
  async emit(name, data) { await Promise.all([...this.events.get(name) || []].map(callback => callback(name, data))); }
}
const events = { LEVEL_LOADED: 'level', FRAG_LOADED: 'fragment', DESTROYING: 'destroy' };
const hls = new Emitter();
const video = {
  currentTime: 21, duration: 3600, paused: false, seeking: false, ended: false,
  seekable: { length: 1, start: () => 0, end: () => 3600 }, handlers: {},
  addEventListener(name, callback) { this.handlers[name] = callback; },
  removeEventListener(name) { delete this.handlers[name]; }
};
const host = { nodes: [], appendChild(node) { this.nodes.push(node); } };
let enabled = true;
const dispose = guard.attach({ hls, video, events, host, rules: [rule], enabled: () => enabled });
await hls.emit('level', { details: { live: false, fragments } });
await hls.emit('fragment', { frag: fragments[1], payload: payloads[0] });
assert.equal(video.currentTime, 21, 'one matching segment must not authorize skipping the whole block');
enabled = false;
await hls.emit('fragment', { frag: fragments[2], payload: payloads[1] });
assert.equal(video.currentTime, 21);
enabled = true;
await hls.emit('fragment', { frag: fragments[2], payload: payloads[1] });
assert.equal(video.currentTime, 30);
assert.equal(video.duration, 3600);
host.nodes[0].children[1].handlers.click();
assert.equal(video.currentTime, 21, 'undo restores the original playback position');
video.handlers.timeupdate();
assert.equal(video.currentTime, 21, 'undo must not be immediately overridden');
await hls.emit('destroy');
dispose();
assert.equal(video.handlers.timeupdate, undefined);
assert.ok([...hls.events.values()].every(listeners => listeners.size === 0));
assert.equal(JSON.stringify(fragments), before, 'HLS media structure must remain untouched');

// A pending digest after destruction cannot seek or update a disposed player.
const lateHls = new Emitter();
let finishDigest;
context.crypto = { subtle: { digest: () => new Promise(resolve => { finishDigest = resolve; }) } };
const lateDispose = guard.attach({ hls: lateHls, video, events, rules: [rule] });
await lateHls.emit('level', { details: { live: false, fragments } });
const pending = lateHls.emit('fragment', { frag: fragments[1], payload: payloads[0] });
lateDispose();
finishDigest(new Uint8Array(32).buffer);
await pending;
assert.equal(video.currentTime, 21);
const order = [];
const response = { data: new Uint8Array([1, 2, 3]).buffer };
const loadContext = { frag: fragments[1] };
const callbacks = { onProgress() {}, onSuccess(received, stats, ctx) {
  assert.equal(received, response);
  assert.equal(ctx, loadContext);
  order.push('forward');
} };
class BaseLoader {
  load(ctx, config, wrapped) {
    assert.equal(wrapped.onProgress, callbacks.onProgress);
    wrapped.onSuccess(response, {}, ctx, null);
  }
}
const ObservedLoader = guard.createFragmentLoader(BaseLoader, (ctx, received) => {
  assert.equal(ctx, loadContext);
  assert.equal(received, response);
  order.push('inspect');
});
new ObservedLoader().load(loadContext, {}, callbacks);
assert.deepEqual(order, ['inspect', 'forward']);
console.log(JSON.stringify({ ok: true, requiresEveryFingerprint: true, originalDurationPreserved: true, undo: true, cleanup: true, unknownContentUntouched: true }));

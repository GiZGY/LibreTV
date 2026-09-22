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
vm.runInContext(fs.readFileSync(new URL('../js/ad-rules.js', import.meta.url), 'utf8'), context);
const ruleIds = new Set();
for (const configured of context.OpenStreamAdRules) {
  assert.ok(!ruleIds.has(configured.id), 'rule IDs must be unique');
  ruleIds.add(configured.id);
  let start = 30;
  const parts = configured.segments.map((part, i) => {
    const frag = { sn: i, url: `https://fixture.test/${i}.ts`, start, duration: part.duration };
    start += part.duration;
    return frag;
  });
  parts.push({ sn: parts.length, url: 'https://fixture.test/film.ts', start, duration: 1000 });
  // Expiration is tested separately; keep archived rule regressions repeatable.
  const candidate = guard.findCandidates(parts, [configured], Date.parse(configured.reviewedAt))[0];
  assert.ok(candidate, `${configured.id}: complete sequence must be discoverable`);
  const active = { ...candidate, rule: { ...configured, expiresAt: new Date(Date.now() + 86400000).toISOString() } };
  const complete = new Map(candidate.parts.map((frag, i) => [guard.fragmentKey(frag), configured.segments[i].sha256]));
  assert.equal(guard.rangeFor(active, complete, start + 1000).end, start);
  for (const part of candidate.parts) {
    const partial = new Map(complete); partial.delete(guard.fragmentKey(part));
    assert.equal(guard.rangeFor(active, partial, start + 1000), null, `${configured.id}: every part is mandatory`);
  }
}
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
for (const firstDuration of [3, 7, NaN, Infinity, 0, -1]) {
  const broken = {...candidates[0],parts:candidates[0].parts.map(part=>({...part}))};
  broken.parts[0].duration=firstDuration;
  assert.equal(guard.rangeFor(broken,verified,3600),null,'internal gaps/overlaps must fail even with a plausible overall interval');
}
const invalidBoundary = {...candidates[0],next:{...candidates[0].next,start:NaN}};
assert.equal(guard.rangeFor(invalidBoundary,verified,3600),null,'invalid next-fragment coordinates must refuse a skip');
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
assert.equal(dispose.getStatus().candidates, 1);
assert.equal(dispose.getStatus().verifiedRanges, 0);
await hls.emit('fragment', { frag: fragments[1], payload: payloads[0] });
assert.equal(video.currentTime, 21, 'one matching segment must not authorize skipping the whole block');
enabled = false;
await hls.emit('fragment', { frag: fragments[2], payload: payloads[1] });
assert.equal(video.currentTime, 21);
enabled = true;
await hls.emit('fragment', { frag: fragments[2], payload: payloads[1] });
assert.equal(video.currentTime, 30);
assert.equal(dispose.getStatus().skips, 1);
assert.equal(dispose.getStatus().verifiedRanges, 1);
assert.doesNotMatch(JSON.stringify(dispose.getStatus()), /https?:|media.test/);
assert.equal(video.duration, 3600);
host.nodes[0].children[1].handlers.click();
assert.equal(video.currentTime, 21, 'undo restores the original playback position');
video.handlers.timeupdate();
assert.equal(video.currentTime, 21, 'undo must not be immediately overridden');
await hls.emit('destroy');
dispose();
assert.equal(dispose.getStatus().disposed, true);
assert.equal(video.handlers.timeupdate, undefined);
assert.ok([...hls.events.values()].every(listeners => listeners.size === 0));
assert.equal(JSON.stringify(fragments), before, 'HLS media structure must remain untouched');

const aesKey = new Uint8Array(16).fill(7), aesIv = new Uint8Array(16).fill(3);
const importedAes = await webcrypto.subtle.importKey('raw', aesKey, 'AES-CBC', false, ['encrypt']);
const transferableCipher = await webcrypto.subtle.encrypt({name:'AES-CBC',iv:aesIv},importedAes,payloads[0]);
const decrypting = guard.decryptForInspection(transferableCipher,{method:'AES-128',keyFormat:'identity',key:aesKey,iv:aesIv});
structuredClone(transferableCipher,{transfer:[transferableCipher]});
assert.equal(Buffer.from(await decrypting).toString(),payloads[0].toString(),'loader inspection must survive HLS worker buffer transfer');
const encryptedParts = fragments.map(part => ({...part, decryptdata:{method:'AES-128',keyFormat:'identity',key:aesKey,iv:aesIv}}));
const aesHls = new Emitter(), aesVideo = {...video,currentTime:21,handlers:{}};
const aesGuard = guard.attach({hls:aesHls,video:aesVideo,events,rules:[rule]});
await aesHls.emit('level',{details:{live:false,fragments:encryptedParts}});
for (let i=0;i<2;i++) {
  const payload = await webcrypto.subtle.encrypt({name:'AES-CBC',iv:aesIv},importedAes,payloads[i]);
  await aesHls.emit('fragment',{frag:encryptedParts[i+1],payload});
  assert.equal(aesVideo.currentTime,i===0?21:30,'AES still requires every plaintext fingerprint');
}
assert.equal(aesVideo.duration,3600);
assert.equal(aesKey[0],7,'inspection must not mutate the player key');
await assert.rejects(guard.decryptForInspection(new Uint8Array(16),{method:'SAMPLE-AES',keyFormat:'identity',key:aesKey,iv:aesIv}));
await assert.rejects(guard.decryptForInspection(new Uint8Array(16),{method:'AES-128',keyFormat:'other',key:aesKey,iv:aesIv}));
await assert.rejects(guard.decryptForInspection(new Uint8Array(16),{method:'AES-128',keyFormat:'identity',iv:aesIv}));
aesGuard();

const overlayHls=new Emitter(),overlayVideo={...video,currentTime:21,handlers:{}};
const overlaySignals=[];
const overlayGuard=guard.attach({hls:overlayHls,video:overlayVideo,events,rules:[],overlayRules:[rule],onOverlay:value=>overlaySignals.push(value)});
await overlayHls.emit('level',{details:{live:false,fragments}});
await overlayHls.emit('fragment',{frag:fragments[1],payload:payloads[0]});
assert.equal(overlaySignals.length,0,'partial evidence cannot flag a programme version');
await overlayHls.emit('fragment',{frag:fragments[2],payload:payloads[1]});
assert.equal(overlaySignals.length,1);
assert.equal(overlayVideo.currentTime,21,'burned-in advertising must never seek past programme footage');
assert.equal(overlayGuard.getStatus().skips,0);
assert.equal(overlayGuard.getStatus().overlays,1);
assert.equal(guard.rangeFor({...candidates[0],rule:{...rule,action:'report_overlay'}},verified,3600),null);
overlayVideo.handlers.timeupdate();
assert.equal(overlaySignals.length,1,'one signal per fingerprint per playback session');
overlayGuard();

// Equal-duration scenes used to overflow the global cap and erase every rule.
const uniform = Array.from({ length: 1000 }, (_, sn) => ({
  sn, url: `https://fixture.test/uniform-${sn}.ts`, start: sn * 5, duration: 5, type: 'main'
}));
const uniformCandidates = guard.findCandidates(uniform, [rule]);
assert.equal(uniformCandidates.length, 256);
assert.equal(uniformCandidates.truncated, true);
const bounded = guard.findCandidates(uniform, [rule], Date.now(), { start: 3881, end: 4091 });
assert.ok(bounded.length > 0 && bounded.length < 50);
assert.equal(bounded.truncated, false);
const distantHls = new Emitter();
const distantVideo = { ...video, currentTime: 0, duration: 5000, handlers: {},
  seekable: { length: 1, start: () => 0, end: () => 5000 } };
const distantGuard = guard.attach({ hls: distantHls, video: distantVideo, events, rules: [rule] });
await distantHls.emit('level', { details: { live: false, fragments: uniform } });
distantVideo.currentTime = 4001;
await distantHls.emit('fragment', { frag: uniform[800], payload: payloads[0] });
assert.equal(distantVideo.currentTime, 4001, 'a seek must not weaken full-sequence verification');
await distantHls.emit('fragment', { frag: uniform[801], payload: payloads[1] });
assert.equal(distantVideo.currentTime, 4010, 'known ads late in a uniform movie remain detectable');
assert.equal(distantVideo.duration, 5000);
assert.equal(distantGuard.getStatus().candidateLimitReached, false);
distantVideo.currentTime = 0;
distantVideo.handlers.timeupdate();
assert.equal(distantGuard.getStatus().verifiedSegments, 0, 'hashes outside the playback window are evicted');
distantGuard();

// Buffering may correct EXTINF by more than the discovery tolerance. Refreshing
// after a seek must retain fully verified candidates, without relaxing bounds.
const correctedParts = fragments.map(part=>({...part}));
const correctedVideo = {...video,currentTime:5,paused:true,handlers:{}};
const correctedHls = new Emitter();
const correctedGuard = guard.attach({hls:correctedHls,video:correctedVideo,events,rules:[rule]});
await correctedHls.emit('level',{details:{live:false,fragments:correctedParts}});
await correctedHls.emit('fragment',{frag:correctedParts[1],payload:payloads[0]});
await correctedHls.emit('fragment',{frag:correctedParts[2],payload:payloads[1]});
correctedParts[1].duration=5.04;
correctedParts[2].start=25.04;
correctedParts[2].duration=4.96;
correctedVideo.currentTime=21;
correctedVideo.paused=false;
correctedVideo.handlers.timeupdate();
assert.equal(correctedVideo.currentTime,30,'demux correction must not erase a verified sequence on refresh');
assert.equal(correctedGuard.getStatus().verifiedRanges,1);
correctedGuard();

// A receiver may use different coordinates. Neither verified bytes nor a
// pending digest authorize a remote seek; local playback can resume safely.
const remoteListeners = new Map();
const remoteVideo = {...video,currentTime:21,handlers:{},remote:{state:'disconnected',
  addEventListener(name,fn){remoteListeners.set(name,fn);},
  removeEventListener(name){remoteListeners.delete(name);}}};
const remoteHls = new Emitter();
const remoteGuard = guard.attach({hls:remoteHls,video:remoteVideo,events,rules:[rule]});
await remoteHls.emit('level',{details:{live:false,fragments}});
remoteVideo.paused = true;
await remoteHls.emit('fragment',{frag:fragments[1],payload:payloads[0]});
await remoteHls.emit('fragment',{frag:fragments[2],payload:payloads[1]});
assert.equal(remoteGuard.getStatus().verifiedRanges,1);
remoteVideo.paused = false;
for(const state of ['connecting','connected']){
  remoteVideo.remote.state=state;
  remoteListeners.get(state==='connecting'?'connecting':'connect')();
  remoteVideo.handlers.timeupdate();
  assert.equal(remoteVideo.currentTime,21,'remote timeline must remain untouched');
  assert.equal(remoteGuard.getStatus().supported,false);
  assert.equal(remoteGuard.getStatus().reason,'remote_playback');
}
remoteVideo.remote.state='disconnected';
remoteVideo.webkitCurrentPlaybackTargetIsWireless=true;
remoteVideo.handlers.webkitcurrentplaybacktargetiswirelesschanged();
remoteVideo.handlers.timeupdate();
assert.equal(remoteVideo.currentTime,21,'AirPlay must also disable local seeks');
remoteVideo.webkitCurrentPlaybackTargetIsWireless=false;
remoteListeners.get('disconnect')();
remoteVideo.handlers.timeupdate();
assert.equal(remoteVideo.currentTime,30,'verified local playback resumes after disconnect');
remoteGuard();
assert.equal(remoteListeners.size,0);
assert.equal(Object.keys(remoteVideo.handlers).length,0);

const handoverHls = new Emitter();
const handoverVideo = {...video,currentTime:21,handlers:{},remote:{state:'disconnected'}};
const handoverGuard = guard.attach({hls:handoverHls,video:handoverVideo,events,rules:[rule]});
await handoverHls.emit('level',{details:{live:false,fragments}});
await handoverHls.emit('fragment',{frag:fragments[1],payload:payloads[0]});
let finishRemoteDigest;
context.crypto = {subtle:{digest:()=>new Promise(resolve=>{finishRemoteDigest=resolve;})}};
const handoverPending=handoverHls.emit('fragment',{frag:fragments[2],payload:payloads[1]});
handoverVideo.remote.state='connected';
finishRemoteDigest(new Uint8Array(Buffer.from(hashes[1],'hex')).buffer);
await handoverPending;
assert.equal(handoverVideo.currentTime,21,'a digest finishing during handover must not seek');
assert.equal(handoverGuard.getStatus().skips,0);
handoverGuard();
context.crypto=webcrypto;

// Inspection overload must not retain an unbounded queue or authorize a skip.
const boundedHls = new Emitter();
const completions = [];
context.crypto = { subtle: { digest: () => new Promise(resolve => completions.push(resolve)) } };
const boundedInspection = guard.attach({ hls: boundedHls, video, events, rules: [rule] });
await boundedHls.emit('level', { details: { live: false, fragments } });
const jobs = [];
for (let i = 0; i < 6; i++) jobs.push(boundedHls.emit('fragment', {
  frag: { ...fragments[1], sn: 100 + i }, payload: payloads[0]
}));
assert.equal(completions.length, 4);
assert.equal(boundedInspection.getStatus().inspectionLimitHits, 2);
completions.splice(0).forEach(resolve => resolve(new Uint8Array(32).buffer));
await Promise.all(jobs);
assert.equal(boundedInspection.getStatus().pendingInspections, 0);
assert.equal(boundedInspection.getStatus().pendingInspectionBytes, 0);
const large = new Uint8Array(8 * 1024 * 1024);
const largeJobs = [0, 1, 2].map(i => boundedHls.emit('fragment', {
  frag: { ...fragments[1], sn: 200 + i }, payload: large
}));
assert.equal(completions.length, 2, '16 MiB input budget enforced before hashing');
assert.equal(boundedInspection.getStatus().pendingInspectionBytes, 16 * 1024 * 1024);
completions.splice(0).forEach(resolve => resolve(new Uint8Array(32).buffer));
await Promise.all(largeJobs);
assert.equal(boundedInspection.getStatus().pendingInspectionBytes, 0);
assert.equal(boundedInspection.getStatus().skips, 0);
boundedInspection();

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

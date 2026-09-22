import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../web/player-preview.js', import.meta.url), 'utf8');
const start = source.indexOf('customType:{m3u8(video,url){');
const end = source.indexOf('\n    volume:', start);
assert.ok(start > 0 && end > start);
const custom = source.slice(start + 'customType:'.length, end).trim().replace(/,$/, '');
function scenario(mode, native = true) {
    const events = [];
    let errorHandler;
    const video = { muted: true, volume: 0, paused: true, played: { length: 0 }, readyState: 0, disableRemotePlayback: true,
        play: () => { events.push('play'); return Promise.resolve(); },
        canPlayType: () => native ? 'maybe' : '' };
    class Hls {
        static isSupported() { return true; }
        static DefaultConfig = { loader: class {} };
        static Events = { ERROR: 'error' };
        static ErrorTypes = { MEDIA_ERROR: 'mediaError' };
        constructor() { events.push('construct'); if (mode === 'constructor') throw Error('init'); }
        on(_event, handler) { errorHandler = handler; }
        recoverMediaError() { events.push('recover'); }
        loadSource() { if (mode === 'load') throw Error('load'); }
        attachMedia() { events.push('mse'); }
        destroy() { events.push('destroy'); }
    }
    const context = { video, next: {}, Hls, setTimeout, clearTimeout, fail: () => events.push('fail'),
        window: { Hls: mode === 'missing' ? undefined : Hls,
            OpenStreamNativeAdSession: { attach: () => { events.push('native'); return () => {}; } } },
        OpenStreamAdGuard: { createFragmentLoader: () => class {}, attach: () => () => events.push('dispose') } };
    vm.createContext(context);
    vm.runInContext('let hls=null,guard=null,nativePlayback=false;let recoveries=0;var custom=' + custom + ';', context);
    let error;
    try { context.custom.m3u8(video, 'https://example.test/movie.m3u8'); } catch (e) { error = e; }
    return { events, video, error, next: context.next, emit: error => errorHandler?.('error', error) };
}
for (const mode of ['missing', 'constructor', 'load']) {
    const result = scenario(mode);
    assert.equal(result.error, undefined);
    assert.ok(result.events.includes('native'));
    assert.equal(result.video.disableRemotePlayback, false);
    assert.equal(result.video.muted, true);
    assert.equal(result.video.volume, 0);
    if (mode === 'load') assert.deepEqual(result.events, ['construct', 'dispose', 'destroy', 'native']);
}
assert.deepEqual(scenario('working').events, ['construct', 'mse']);
assert.ok(scenario('constructor', false).error);
assert.match(scenario('missing', false).next.innerHTML, /不支持/);
const startupError = { fatal: true, type: 'mediaError', details: 'bufferAddCodecError' };
const startup = scenario('working');
startup.video.paused = false;
startup.emit(startupError);
assert.deepEqual(startup.events, ['construct', 'mse', 'dispose', 'destroy', 'native', 'play']);
startup.emit(startupError);
assert.equal(startup.events.filter(event => event === 'native').length, 1);
const alreadyPlaying = scenario('working');
alreadyPlaying.video.played.length = 1;
alreadyPlaying.emit(startupError);
assert.ok(alreadyPlaying.events.includes('recover'));
assert.ok(!alreadyPlaying.events.includes('native'));
const network = scenario('working');
network.emit({ fatal: true, type: 'networkError', details: 'manifestLoadError' });
assert.ok(network.events.includes('fail'));
assert.ok(!network.events.includes('native'));
const unsupported = scenario('working', false);
unsupported.emit(startupError);unsupported.emit(startupError);
assert.deepEqual(unsupported.events.slice(-2), ['recover', 'fail']);
console.log('Player native fallback: missing Hls, constructor/load failures, disposal order, mute preservation and unsupported browser passed; simulated integration only');

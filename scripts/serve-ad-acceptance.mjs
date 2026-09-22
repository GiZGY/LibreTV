import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

// Offline browser acceptance. Synthetic media never becomes a production rule.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'openstream-ad-acceptance-'));
process.once('exit', () => rmSync(directory, {recursive:true,force:true}));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
try {
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
        '-c:a', 'aac', '-b:a', '64k', '-g', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
        '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
        '-hls_segment_filename', join(directory, 'part%02d.ts'), join(directory, 'video.m3u8')],
    { stdio: 'inherit' });
} catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
}
let segments = [];
let duration = 24, adStart = 8, adEnd = 12;
const captured = new Map();
let capturedPlaylist = null;
for (const name of ['part04.ts', 'part05.ts']) {
    segments.push({ duration: 2, sha256: createHash('sha256').update(await readFile(join(directory, name))).digest('hex') });
}
if (process.env.AD_EVIDENCE) {
    // Explicit local capture only; never fetch playlist URLs or accept paths from HTTP.
    const evidence = process.env.AD_EVIDENCE;
    if (!isAbsolute(evidence)) throw new Error('AD_EVIDENCE must be absolute');
    const playlist = await readFile(join(evidence, 'preview.m3u8'), 'utf8');
    const entries = [...playlist.matchAll(/#EXTINF:([\d.]+),[^\n]*\n(\d+\.bin)(?:\n|$)/g)];
    if (!playlist.includes('#EXT-X-ENDLIST') || entries.length < 2 || entries.length > 100 ||
        entries.some(entry => !(Number(entry[1]) > 0)) || entries.reduce((sum, entry) => sum + Number(entry[1]), 0) > 120) {
        throw new Error('Invalid captured sequence');
    }
    segments = [];
    let bytes = 0;
    for (const [index, entry] of entries.entries()) {
        const body = await readFile(join(evidence, entry[2]));
        bytes += body.length;
        if (body.length > 8 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw new Error('Capture exceeds budget');
        captured.set('/capture' + index + '.ts', { type: 'video/mp2t', body });
        segments.push({duration:Number(entry[1]),sha256:createHash('sha256').update(body).digest('hex')});
    }
    adStart = 4;
    adEnd = adStart + segments.reduce((sum, part) => sum + part.duration, 0);
    duration = adEnd + 4;
    capturedPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + Math.ceil(Math.max(2,...segments.map(part=>part.duration))) +
        '\n#EXTINF:2,\npart00.ts\n#EXTINF:2,\npart01.ts\n#EXT-X-DISCONTINUITY\n' +
        segments.map((part,index)=>'#EXTINF:'+part.duration+',\ncapture'+index+'.ts\n').join('') +
        '#EXT-X-DISCONTINUITY\n#EXTINF:2,\npart02.ts\n#EXTINF:2,\npart03.ts\n#EXT-X-ENDLIST\n';
}
let rules = [{ id: 'synthetic-only', expiresAt: new Date(Date.now() + 3600000).toISOString(), segments }];
if (process.env.AD_CONFIGURED_RULE === '1') {
    const context = {window:{}};
    vm.runInNewContext(await readFile(join(root,'js/ad-rules.js'),'utf8'), context);
    rules = context.window.OpenStreamAdRules.filter(rule => Date.parse(rule.expiresAt)>Date.now() &&
        rule.segments.length===segments.length && rule.segments.every((part,index)=>
            part.sha256===segments[index].sha256 && Math.abs(part.duration-segments[index].duration)<0.025));
    if (rules.length!==1) throw new Error('Capture must match exactly one active configured rule');
}
const html = `<!doctype html><meta charset="utf-8"><title>Local ad acceptance</title>
<style>body{font:16px system-ui;max-width:900px;margin:32px auto}video{width:480px}button{padding:10px;margin:5px}pre{white-space:pre-wrap}.ad-skip-notice{padding:12px;background:#eee}</style>
<h1>Local ad acceptance</h1><p>Local fixture: ${duration.toFixed(3)} seconds; test interval ${adStart}–${adEnd.toFixed(3)} seconds. Rule mode: ${process.env.AD_CONFIGURED_RULE === '1' ? 'configured local rule' : 'synthetic test rule'}. No upstream requests or publishing.</p>
<button id="run">Run browser checks</button><div id="host"><video id="video" muted playsinline controls></video></div>
<pre id="result" role="status">Ready</pre>
<script src="/hls.js"></script><script src="/ad-guard.js"></script><script>
const rules = ${JSON.stringify(rules)};
const expectedDuration = ${duration}, adStart = ${adStart}, adEnd = ${adEnd};
const video = document.querySelector('video'), output = document.querySelector('#result');
let hls, guard, timeout;
const results = [];
const report = () => output.textContent = JSON.stringify({results, time:video.currentTime, duration:video.duration, guard:guard?.getStatus()}, null, 2);
const check = (name, pass) => { results.push({name, pass:!!pass,time:video.currentTime,duration:video.duration,skips:guard?.getStatus().skips}); report(); if (!pass) throw new Error(name); };
const until = (test, label, limit = 15000) => new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => { if(test()) return resolve(); if(performance.now()-start>limit) return reject(new Error('timeout: '+label)); timeout=setTimeout(poll, 30); }; poll();
});
function setup(activeRules, enabled = () => true) {
    guard?.(); hls?.destroy();
    hls = new Hls({enableWorker:true,maxBufferLength:30,maxMaxBufferLength:60,
        fLoader:OpenStreamAdGuard.createFragmentLoader(Hls.DefaultConfig.loader, (context,response)=>guard?.inspect(context,response))});
    guard = OpenStreamAdGuard.attach({hls,video,events:Hls.Events,host:document.querySelector('#host'),rules:activeRules,enabled});
    hls.on(Hls.Events.ERROR, (_event,data)=> { if(data.fatal) { results.push({name:'fatal media error',pass:false,detail:data.details}); report(); } });
    hls.loadSource('/video.m3u8'); hls.attachMedia(video);
}
document.querySelector('#run').onclick = async function() {
    this.disabled=true; results.length=0;
    try {
        check('HLS supported', Hls.isSupported());
        setup(rules); await video.play();
        await until(()=>guard.getStatus().verifiedRanges===1,'full fingerprints');
        check('original duration', Math.abs(video.duration-expectedDuration)<0.2);
        video.currentTime=adStart+0.2;
        await until(()=>guard.getStatus().skips===1,'known interval skipped');
        check('skip boundary', video.currentTime>=adEnd-0.1 && video.currentTime<adEnd+1);
        check('duration preserved after skip', Math.abs(video.duration-expectedDuration)<0.2);
        const undo=document.querySelector('.ad-skip-notice button');
        check('undo offered', !!undo); undo.click();
        await until(()=>!video.seeking && video.currentTime<adStart+2,'undo returned');
        const resumed=video.currentTime;
        await until(()=>video.currentTime>resumed+0.4,'undo plays');
        check('undo does not immediately reskip',guard.getStatus().skips===1 && video.currentTime<adEnd);
        video.currentTime=expectedDuration-2;
        await until(()=>video.ended,'film ending retained');
        check('content reaches original ending',Math.abs(video.currentTime-expectedDuration)<0.2);
        guard(); check('dispose',guard.getStatus().disposed);
        setup([{...rules[0],segments:rules[0].segments.map((part,i)=>i?{...part,sha256:'0'.repeat(64)}:part)}]);
        await video.play();
        await until(()=>video.readyState>=3 && video.duration>0,'negative video ready');
        video.currentTime=adStart+0.2;
        await until(()=>!video.seeking && video.currentTime>adStart+1,'negative content plays');
        check('partial match preserves content',guard.getStatus().skips===0 && video.currentTime<adEnd);
        setup([{...rules[0],expiresAt:'2000-01-01T00:00:00Z'}]);
        await video.play();
        await until(()=>video.readyState>=3 && video.duration>0,'expired video ready');
        video.currentTime=adStart+0.2;
        await until(()=>!video.seeking && video.currentTime>adStart+1,'expired content plays');
        check('expired rule preserves content',guard.getStatus().skips===0 && guard.getStatus().candidates===0 && video.currentTime<adEnd);
        setup(rules,()=>false);
        await video.play();
        await until(()=>video.readyState>=3 && video.duration>0,'disabled video ready');
        video.currentTime=adStart+0.2;
        await until(()=>!video.seeking && video.currentTime>adStart+1,'disabled content plays');
        check('disabled guard preserves content',guard.getStatus().skips===0 && video.currentTime<adEnd);
        video.pause(); guard(); hls.destroy();
        results.push({name:'complete',pass:results.every(item=>item.pass)}); report();
    } catch(error) { results.push({name:error.message,pass:false}); video.pause(); report(); }
    finally { clearTimeout(timeout); this.disabled=false; }
};
window.addEventListener('pagehide',()=>{clearTimeout(timeout);guard?.();hls?.destroy();});
</script>`;
const files = new Map([
    ['/', { type: 'text/html; charset=utf-8', body: Buffer.from(html) }],
    ['/hls.js', { type: 'text/javascript', body: await readFile(join(root, 'libs/hls.min.js')) }],
    ['/ad-guard.js', { type: 'text/javascript', body: await readFile(join(root, 'js/ad-guard.js')) }]
]);
for (const name of await readdir(directory)) {
    files.set('/' + name, { type: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', body: await readFile(join(directory, name)) });
}
for (const [name, entry] of captured) files.set(name, entry);
if (capturedPlaylist) files.set('/video.m3u8', {type:'application/vnd.apple.mpegurl',body:Buffer.from(capturedPlaylist)});
if (process.env.AD_AES === '1') {
    const key = randomBytes(16), iv = randomBytes(16);
    for (const [name, entry] of files) {
        if (!name.endsWith('.ts')) continue;
        const cipher = createCipheriv('aes-128-cbc', key, iv);
        files.set(name, {...entry,body:Buffer.concat([cipher.update(entry.body),cipher.final()])});
    }
    const playlist = files.get('/video.m3u8');
    playlist.body = Buffer.from(playlist.body.toString().replace('#EXTM3U',
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/fixture.key",IV=0x'+iv.toString('hex')));
    files.set('/fixture.key',{type:'application/octet-stream',body:key});
}
for (const name of ['native-ad-evidence.js', 'native-ad-verifier.js', 'native-ad-guard.js', 'native-ad-session.js', 'native-ad-transport.js']) {
    files.set('/' + name, {type:'text/javascript',body:await readFile(join(root,'js',name))});
}
const nativeHtml = (await readFile(join(root,'scripts/fixtures/native-ad-acceptance.html'),'utf8'))
    .replace('__CONFIG__',JSON.stringify({duration,adStart,adEnd,rules}));
files.set('/native', {type:'text/html; charset=utf-8',body:Buffer.from(nativeHtml)});
const playerSource = await readFile(join(root,'web/player-preview.js'),'utf8');
const customStart = playerSource.indexOf('customType:{m3u8(video,url){');
const customEnd = playerSource.indexOf('\n    volume:',customStart);
if (customStart < 0 || customEnd <= customStart) throw new Error('Player custom type boundary changed');
const customType = playerSource.slice(customStart+'customType:'.length,customEnd).trim().replace(/,$/,'');
const fallbackHtml = (await readFile(join(root,'scripts/fixtures/native-player-fallback.html'),'utf8'))
    .replace('__CUSTOM_TYPE__',customType)
    .replace('<script src="/native-ad-session.js">','<script src="/native-ad-transport.js"></script><script src="/native-ad-session.js">');
files.set('/native-player',{type:'text/html; charset=utf-8',body:Buffer.from(fallbackHtml)});
files.set('/artplayer.js',{type:'text/javascript',body:await readFile(join(root,'web/libs/artplayer.min.js'))});
const server = createServer((req, res) => {
    const entry = files.get(req.url);
    if (req.method !== 'GET' || !entry) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':entry.type,'Cache-Control':'no-store','Content-Length':entry.body.length});
    res.end(entry.body);
});
const close = () => {
    // Bytes are already in memory; cleanup must not wait for browser keep-alives.
    rmSync(directory, {recursive:true,force:true});
    server.closeAllConnections();
    server.close(() => process.exit());
};
process.once('SIGINT', close); process.once('SIGTERM', close);
server.on('error', async error => { await rm(directory, {recursive:true,force:true}); console.error(error.message); process.exit(1); });
server.listen(Number(process.env.PORT || 18443), '127.0.0.1', () => console.log('Local browser acceptance: http://127.0.0.1:' + server.address().port));

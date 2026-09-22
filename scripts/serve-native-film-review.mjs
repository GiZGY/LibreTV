import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyReview } from './verify-native-ad-review.mjs';

const directory = process.env.NATIVE_REVIEW_DIR;
if (!directory) throw Error('Explicit private review directory required');
const candidate = JSON.parse(await readFile(resolve(directory, 'calibration-candidate.json'), 'utf8'));
const url = new URL(candidate.mediaUrl);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) || candidate.end <= candidate.start) {
    throw Error('Invalid private review candidate');
}
const verified = process.env.NATIVE_REVIEW_GUARD === '1'
    ? await verifyReview(resolve(directory, 'review-bundle.json')) : null;
const proof = verified ? { ...verified.verification, verifiedSegments: [...verified.verification.verifiedSegments] } : null;
const data = JSON.stringify({ url: url.href, start: candidate.start, end: candidate.end, proof }).replace(/</g, '\\u003c');
const modules = new Map();
for (const file of ['native-ad-evidence.js', 'native-ad-guard.js']) modules.set('/'+file, await readFile(new URL('../js/'+file,import.meta.url)));
const html = `<!doctype html><meta charset="utf-8"><title>Native film review</title>
<style>body{font:16px system-ui;margin:24px;background:#eee;color:#111}video{width:min(900px,95vw);display:block}button{padding:10px;margin:8px}textarea{width:95%;height:240px}</style>
<h1>Silent native film review</h1><p>Original source and timeline. Guard testing uses locally verified captured bytes; no rule is published.</p>
<button id="test">Run verified guard checks</button>
<button data-point="before">Before candidate</button><button data-point="inside">Inside candidate</button><button data-point="after">After candidate</button><button data-point="tail">Final 12 seconds</button><button id="pause">Pause</button>
<div><button data-edge="start" data-offset="-0.08">Start minus 80ms</button><button data-edge="start" data-offset="0.08">Start plus 80ms</button><button data-edge="end" data-offset="-0.08">End minus 80ms</button><button data-edge="end" data-offset="0.08">End plus 80ms</button></div>
<video muted playsinline controls preload="none"></video><textarea aria-label="Review observations" readonly></textarea>
<script src="/native-ad-evidence.js"></script><script src="/native-ad-guard.js"></script><script>
const config=${data},video=document.querySelector('video'),out=document.querySelector('textarea');
video.muted=true;video.defaultMuted=true;video.volume=0;
const observations=[];let pending=false,last=0,guard;
function report(event){observations.push({event,time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,readyState:video.readyState,muted:video.muted,volume:video.volume,seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)])});out.value=JSON.stringify(observations.slice(-16),null,2);}
async function ready(){if(video.readyState>=1)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('metadata timeout')),20000);const loaded=()=>finish(),error=()=>finish(Error('media error'));function finish(reason){clearTimeout(timer);video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('error',error);reason?reject(reason):resolve();}video.addEventListener('loadedmetadata',loaded);video.addEventListener('error',error);});}
const until=(test,label,limit=25000)=>new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(test())return resolve();if(performance.now()-start>limit)return reject(Error(label));setTimeout(poll,50);};poll();});
document.querySelector('#test').disabled=!config.proof;
document.querySelector('#test').onclick=async()=>{
 if(pending)return;pending=true;
 const check=(label,ok)=>{report(label+(ok?' PASS':' FAIL'));if(!ok)throw Error(label);};
 try{
  video.pause();video.muted=true;video.defaultMuted=true;video.volume=0;
  if(!video.src){video.src=config.url;video.load();}await ready();
  const verification={...config.proof,verifiedSegments:new Map(config.proof.verifiedSegments)};
  const attach=()=>{guard?.();guard=OpenStreamNativeAdGuard.attach({video,host:document.body,getVerification:()=>verification});};
  attach();video.currentTime=config.start-1;await video.play();
  await until(()=>guard.getStatus().skips===1,'first skip');
  await until(()=>video.currentTime>config.end+1,'post skip progress');
  check('post skip duration',Math.abs(video.duration-verification.evidence.timeline.duration)<.2);
  const undo=document.querySelector('.ad-skip-notice button');check('undo available',!!undo);undo.click();
  await until(()=>!video.seeking&&video.currentTime<config.end,'undo restored');
  const at=video.currentTime;await until(()=>video.currentTime>at+.5,'undo progresses');
  check('undo no repeat',guard.getStatus().skips===1);
  video.pause();attach();video.currentTime=config.start-1;await video.play();
  await until(()=>guard.getStatus().skips===1,'fresh skip');
  await until(()=>video.currentTime>config.end+5,'five seconds of programme');
  check('second skip continues',!guard.getStatus().suspended);
  video.currentTime=video.duration-12;
  await until(()=>video.ended,'guard enabled ending',30000);
  check('guard enabled ending',Math.abs(video.currentTime-verification.evidence.timeline.duration)<.2&&!guard.getStatus().suspended);
  check('silent',video.muted&&video.volume===0);report('COMPLETE');
 }catch(error){report('FAIL '+error.message);}finally{video.pause();guard?.();guard=null;pending=false;}
};
document.querySelectorAll('[data-point]').forEach(button=>button.onclick=async()=>{if(pending)return;pending=true;try{video.pause();video.muted=true;video.defaultMuted=true;video.volume=0;if(!video.src){video.src=config.url;video.load();}await ready();const point=button.dataset.point;video.currentTime=point==='before'?Math.max(0,config.start-2):point==='inside'?config.start+2:point==='after'?config.end+.5:Math.max(0,video.duration-12);await video.play();report(point);}catch(_){report('failed');video.pause();}finally{pending=false;}});
document.querySelector('#pause').onclick=()=>{video.pause();report('paused');};
document.querySelectorAll('[data-edge]').forEach(button=>button.onclick=async()=>{
 if(pending)return;pending=true;
 try{
  video.pause();video.muted=true;video.defaultMuted=true;video.volume=0;
  if(!video.src){video.src=config.url;video.load();}await ready();
  const target=config[button.dataset.edge]+Number(button.dataset.offset);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(Error('seek timeout')),15000);
   const seeked=()=>finish();
   function finish(error){clearTimeout(timer);video.removeEventListener('seeked',seeked);error?reject(error):resolve();}
   video.addEventListener('seeked',seeked);video.currentTime=target;
  });
  report(button.textContent);
 }catch(_){report('edge failed');}finally{pending=false;}
});
for(const event of ['seeked','ended','error','durationchange'])video.addEventListener(event,()=>report(event));
video.addEventListener('timeupdate',()=>{if(performance.now()-last>2000){last=performance.now();report('progress');}});
video.addEventListener('volumechange',()=>{if(!video.muted||video.volume!==0){video.muted=true;video.volume=0;}});
window.addEventListener('pagehide',()=>{guard?.();video.pause();video.removeAttribute('src');video.load();});
</script>`;
const server = createServer((req, res) => {
    if(req.method==='GET'&&modules.has(req.url)){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(modules.get(req.url));return;}
    if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
});
const close = () => { server.closeAllConnections(); server.close(); };
process.once('SIGINT', close); process.once('SIGTERM', close);
server.listen(18445, '127.0.0.1', () => console.log('Private native review: http://127.0.0.1:18445'));

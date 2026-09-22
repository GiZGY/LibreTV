import express from 'express';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import auth from '../api/auth/[action].mjs';
import proxy from '../api/proxy/[...path].mjs';

// Explicit private input and loopback binding; never a production route.
if (!process.env.NATIVE_REVIEW_DIR) throw Error('Private review directory required');
dotenv.config({ path: new URL('../.env.local', import.meta.url).pathname });
const { mediaUrl } = JSON.parse(await readFile(resolve(process.env.NATIVE_REVIEW_DIR, 'review-bundle.json'), 'utf8'));
const url = new URL(mediaUrl);
if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid review URL');
const files = ['proxy-auth.js', 'ad-rules.js', 'ad-guard.js', 'native-ad-timelines.js', 'native-ad-evidence.js', 'native-ad-guard.js', 'native-ad-verifier.js', 'native-ad-transport.js', 'native-ad-session.js'];
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); next(); });
app.all('/api/auth/:action', auth);
app.all('/proxy/:encodedUrl', proxy);
for (const file of files) app.get('/' + file, (_req, res) => res.sendFile(new URL('../js/' + file, import.meta.url).pathname));
app.get('/', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Silent native session acceptance</title>
<style>body{font:16px system-ui;margin:24px}video{width:min(800px,95vw);display:block}textarea{width:95%;height:300px}button{padding:12px}</style>
<h1>Silent native session acceptance</h1><button id="run">Run fresh proxy verification</button><video muted playsinline controls preload="none"></video><textarea aria-label="Session results" readonly></textarea>
${files.map(file => '<script src="/' + file + '"></script>').join('')}
<script>
const video=document.querySelector('video'),out=document.querySelector('textarea'),button=document.querySelector('#run');
video.muted=true;video.defaultMuted=true;video.volume=0;
let session;const logs=[];
const log=(event)=>{logs.push({event,time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,muted:video.muted,volume:video.volume,status:session?.getStatus()});out.value=JSON.stringify(logs,null,2);};
const until=(test,label,limit=30000)=>new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(test())return resolve();if(performance.now()-start>limit)return reject(Error(label));setTimeout(poll,100);};poll();});
button.onclick=async()=>{button.disabled=true;try{
 video.muted=true;video.defaultMuted=true;video.volume=0;
 video.src=${JSON.stringify(url.href).replace(/</g, '\u003c')};video.load();
 session=OpenStreamNativeAdSession.attach({video,host:document.body,url:video.src,read:async(url,options)=>{try{const bytes=await OpenStreamNativeAdTransport.read(url,options);log('verified transport bytes '+bytes.length);return bytes;}catch(error){log('transport failure '+error.message);throw error;}}});
 await session.ready;log('fresh verification returned');
 await until(()=>video.readyState>=1,'metadata timeout');
 if(session.getStatus().status!=='active'){
  video.currentTime=192;await video.play();await until(()=>video.currentTime>194,'preserved playback failed');log('UNVERIFIED: original programme still plays');return;
 }
 const record=OpenStreamNativeAdTimelines.find(item=>item.timeline.duration===video.duration);
 if(!record)throw Error('review timeline missing');
 const range=record.ranges[0];video.currentTime=range.start-1;await video.play();
 await until(()=>session.getStatus().playback?.skips===1,'skip timeout');
 await until(()=>video.currentTime>range.end+5,'post-ad programme timeout');log('post-ad programme passed');
 if(Math.abs(video.duration-record.timeline.duration)>.2)throw Error('duration changed');
 const undo=document.querySelector('.ad-skip-notice button');if(!undo)throw Error('undo missing');undo.click();
 await until(()=>!video.seeking&&video.currentTime<range.end,'undo timeout');log('undo passed');
 video.currentTime=video.duration-12;await until(()=>video.ended,'ending timeout');
 if(Math.abs(video.currentTime-record.timeline.duration)>.2)throw Error('ending truncated');
 if(!video.muted||video.volume!==0)throw Error('not silent');log('COMPLETE');
 }catch(error){log('FAIL '+error.message);}finally{video.pause();session?.();button.disabled=false;}};
video.addEventListener('volumechange',()=>{if(!video.muted||video.volume!==0){video.muted=true;video.volume=0;}});
window.addEventListener('pagehide',()=>{session?.();video.pause();video.removeAttribute('src');video.load();});
</script>`));
app.use((_req, res) => res.sendStatus(404));
const server = app.listen(18446, '127.0.0.1', () => console.log('Silent native session review: http://127.0.0.1:18446'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });

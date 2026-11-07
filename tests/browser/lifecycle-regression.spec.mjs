import {test,expect,chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const origin='http://127.0.0.1:18448',filmA='film-lifecyclea',filmB='film-lifecycleb';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function seed(context,{bridge=false,ignoreOldAbort=false}={}){
 await context.addInitScript(({filmA,filmB,bridge,ignoreOldAbort})=>{
  const prefix='openstream_live_';
  const film=(id,name)=>({id,name,type:'电视剧',episodes:4,seasons:1,year:2025,genre:'剧情',rating:8,candidatesComplete:true,
   lines:[{key:'qa:'+id,sourceKey:bridge?'bridge:lifecycle':'qa',videoId:id,flag:'main',name:'生命周期验收线路',health:'fast',episodes:Array.from({length:4},(_,index)=>({name:'第'+(index+1)+'集',url:'/media/sample.mp4?film='+id+'&episode='+(index+1),bridgeEpisode:index}))}]});
  localStorage.setItem(prefix+'filmRecords',JSON.stringify([film(filmA,'生命周期测试剧'),film(filmB,'新会话测试剧')]));
  localStorage.setItem(prefix+'favorites','[]');localStorage.setItem(prefix+'history','[]');localStorage.setItem(prefix+'historyMetadataV2','{}');
  localStorage.setItem(prefix+'playbackRate','1.75');localStorage.setItem(prefix+'autoplay','false');localStorage.setItem(prefix+'mobileAutoTheme','false');
  window.__qaLifecycle=[];window.__qaResolve={aborted:[],finished:[]};
  for(const name of ['visibilitychange','freeze','resume'])document.addEventListener(name,()=>window.__qaLifecycle.push({name,hidden:document.hidden,visibility:document.visibilityState}));
  // This one transport deliberately ignores cancellation. The real adapter and resolver still run.
  // It represents a response already in flight when an old request cannot be stopped.
  const nativeFetch=window.fetch.bind(window);let stripOnce=ignoreOldAbort;
  window.fetch=(input,options)=>{
   const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
   if(stripOnce&&url.pathname==='/api/tvbox/play'&&url.searchParams.get('id')===filmA&&url.searchParams.get('episode')==='1'){
    stripOnce=false;const signal=options?.signal;if(signal)signal.addEventListener('abort',()=>window.__qaResolve.aborted.push('old-episode-2'),{once:true});
    const next={...options};delete next.signal;return nativeFetch(input,next);
   }
   return nativeFetch(input,options);
  };
  localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');
 },{filmA,filmB,bridge,ignoreOldAbort});
}
async function mediaFrame(page){
 const video=page.locator('#watch-player video');await expect(video).toBeVisible();
 await expect.poll(()=>video.evaluate(v=>Number.isFinite(v.duration)&&v.duration>0&&v.readyState>=2&&!v.error),{timeout:15000}).toBe(true);
 await video.evaluate(v=>{
  if(v.__qaFrames!==undefined)return;v.__qaFrames=0;
  if(v.requestVideoFrameCallback){const frame=()=>{v.__qaFrames++;if(v.isConnected)v.requestVideoFrameCallback(frame);};v.requestVideoFrameCallback(frame);}
 });
 return video;
}
async function moving(page,{id=filmA,episode=1,start=false}={}){
 const video=await mediaFrame(page);if(start)await video.evaluate(v=>v.play());
 const before=await video.evaluate(v=>({time:v.currentTime,frames:Math.max(v.getVideoPlaybackQuality?.().totalVideoFrames||0,v.webkitDecodedFrameCount||0,v.__qaFrames||0)}));
 await expect.poll(()=>video.evaluate(v=>({moved:v.currentTime,frames:Math.max(v.getVideoPlaybackQuality?.().totalVideoFrames||0,v.webkitDecodedFrameCount||0,v.__qaFrames||0),paused:v.paused,seeking:v.seeking,error:v.error?.code||0})),{timeout:15000}).toMatchObject({moved:expect.any(Number),paused:false,seeking:false,error:0});
 await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:15000}).toBeGreaterThan(before.time+.2);
 await expect.poll(()=>video.evaluate(v=>Math.max(v.getVideoPlaybackQuality?.().totalVideoFrames||0,v.webkitDecodedFrameCount||0,v.__qaFrames||0)),{timeout:15000}).toBeGreaterThan(before.frames);
 await expect.poll(()=>page.evaluate(()=>({id:LivePlayback.current()?.filmId,episode:LivePlayback.current()?.episode}))).toEqual({id,episode});
 await expect(video).toHaveJSProperty('playbackRate',1.75);await expect(video).toHaveJSProperty('defaultPlaybackRate',1.75);await expect(video).toHaveJSProperty('muted',true);
 expect(await page.evaluate(()=>load('playbackRate',1))).toBe(1.75);return video;
}
async function realSpeed(page,{id=filmA,episode=1,label}={}){
 const video=await moving(page,{id,episode});
 const sample=await video.evaluate(async v=>{
  const frames=()=>Math.max(v.getVideoPlaybackQuality?.().totalVideoFrames||0,v.webkitDecodedFrameCount||0,v.__qaFrames||0),start=v.currentTime,started=performance.now(),firstFrames=frames(),owner=LivePlayback.current();
  let waits=0,interference=0;const waiting=()=>waits++,interrupted=()=>interference++;
  for(const name of ['pause','seeking','error'])v.addEventListener(name,interrupted);v.addEventListener('waiting',waiting);
  const timer=setInterval(()=>{if(v.paused||v.seeking||v.error||LivePlayback.current()!==owner)interference++;},100);
  await new Promise(resolve=>setTimeout(resolve,10000));clearInterval(timer);
  for(const name of ['pause','seeking','error'])v.removeEventListener(name,interrupted);v.removeEventListener('waiting',waiting);
  const elapsed=(performance.now()-started)/1000,result={elapsed,ratio:(v.currentTime-start)/elapsed,framesBefore:firstFrames,framesAfter:frames(),waits,interference,rate:v.playbackRate,defaultRate:v.defaultPlaybackRate,muted:v.muted,paused:v.paused,seeking:v.seeking,error:v.error?.code||0};v.pause();return result;
 });
 expect(sample.elapsed).toBeGreaterThanOrEqual(10);expect(sample.waits).toBe(0);expect(sample.interference).toBe(0);expect(sample.framesAfter).toBeGreaterThan(sample.framesBefore);
 expect(sample.ratio).toBeGreaterThan(1.65);expect(sample.ratio).toBeLessThan(1.85);expect(sample.rate).toBe(1.75);expect(sample.defaultRate).toBe(1.75);expect(sample.muted).toBe(true);expect(sample.paused).toBe(false);expect(sample.seeking).toBe(false);expect(sample.error).toBe(0);
 await expect.poll(()=>page.evaluate(id=>load('historyMetadataV2',{})[id]?.episode,id)).toBe(episode);
 console.log(JSON.stringify({path:label,project:test.info().project.name,id,episode,...sample}));
}
async function nativeChromium(){
 const profile=await mkdtemp(path.join(os.tmpdir(),'openstream-lifecycle-'));
 const process=spawn(chromium.executablePath(),['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const ended=new Promise(resolve=>process.once('exit',resolve));let browser;
 const close=async()=>{await browser?.close().catch(()=>{});if(process.exitCode===null)process.kill('SIGTERM');await Promise.race([ended,pause(3000)]);if(process.exitCode===null){process.kill('SIGKILL');await ended;}await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});};
 try{
  const endpoint=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Native lifecycle browser did not start')),15000);process.once('error',error=>{clearTimeout(timeout);reject(error);});process.once('exit',()=>{clearTimeout(timeout);reject(Error('Native lifecycle browser stopped before connecting'));});process.stderr.on('data',chunk=>{output=(output+chunk).slice(-65536);const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timeout);resolve(match[1]);}});});
  // Standard Playwright forces every page visible/focused, hiding actual browser transitions.
  // A task-owned native profile plus the documented noDefaults option leaves lifecycle untouched.
  browser=await chromium.connectOverCDP(endpoint,{noDefaults:true});return {context:browser.contexts()[0],close};
 }catch(error){await close();throw error;}
}

test('native Chromium real hidden and frozen page resumes the same media session at the selected rate',async({browserName})=>{
 test.skip(browserName!=='chromium','Real visibility/freeze uses Chromium CDP; WebKit is covered by the network lifecycle cases, not claimed as a native hidden-page test.');
 test.info().annotations.push({type:'lifecycle',description:'Native task-owned Chromium profile, focus emulation disabled via noDefaults; document.hidden and freeze/resume events are asserted.'});
 const native=await nativeChromium();
 try{
  await seed(native.context);const page=native.context.pages()[0]||await native.context.newPage(),other=await native.context.newPage();
  await page.goto(origin+'/#player/'+filmA);await page.bringToFront();await moving(page,{start:true});
  const before=await page.evaluate(()=>({hidden:document.hidden,media:LivePlayback.current(),record:load('historyMetadataV2',{})['film-lifecyclea']}));expect(before.hidden).toBe(false);
  await other.goto('about:blank');await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hidden)).toBe(true);
  const cdp=await native.context.newCDPSession(page);await cdp.send('Page.enable');await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await pause(1200);await cdp.send('Page.setWebLifecycleState',{state:'active'});
  await expect.poll(()=>page.evaluate(()=>window.__qaLifecycle.some(event=>event.name==='freeze'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__qaLifecycle.some(event=>event.name==='resume'))).toBe(true);
  await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hidden)).toBe(false);
  const lifecycle=await page.evaluate(()=>window.__qaLifecycle);expect(lifecycle.some(event=>event.name==='visibilitychange'&&event.hidden)).toBe(true);expect(lifecycle.some(event=>event.name==='visibilitychange'&&!event.hidden)).toBe(true);
  expect(await page.evaluate(()=>({filmId:LivePlayback.current()?.filmId,episode:LivePlayback.current()?.episode,episodeKey:LivePlayback.current()?.episodeKey,lineKey:LivePlayback.current()?.lineKey}))).toEqual({filmId:before.media.filmId,episode:before.media.episode,episodeKey:before.media.episodeKey,lineKey:before.media.lineKey});
  console.log(JSON.stringify({path:'native-hidden-freeze-resume',lifecycle}));await realSpeed(page,{label:'native-hidden-freeze-resume-real-speed'});await cdp.detach();
 }finally{await native.close();}
});

async function bridgeFixture(page,{ignoreOldAbort=false}={}){
 await seed(page.context(),{bridge:true,ignoreOldAbort});
 const calls=[],failed=[];let release;const held=new Promise(resolve=>release=resolve),errors=[];
 page.on('requestfailed',request=>{if(new URL(request.url()).pathname==='/api/tvbox/play')failed.push(request.url());});
 page.on('pageerror',error=>errors.push(error.name));
 await page.route('https://media.openstream.test/**',async route=>{const requestURL=new URL(route.request().url()),response=await route.fetch({url:origin+'/media/sample.mp4'+requestURL.search});await route.fulfill({response});});
 await page.route('**/api/tvbox/play?**',async route=>{
  const requestURL=new URL(route.request().url()),id=requestURL.searchParams.get('id'),episode=Number(requestURL.searchParams.get('episode'))+1,entry={id,episode,number:calls.filter(call=>call.id===id&&call.episode===episode).length+1};calls.push(entry);
  if(id===filmA&&episode===2&&entry.number===1)await held;
  try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ready',url:'https://media.openstream.test/sample.mp4?film='+id+'&episode='+episode+'&attempt='+entry.number})});}catch(error){if(!entry.cancelled)throw error;}
 });
 await page.goto('/#player/'+filmA);
 await page.evaluate(()=>{const original=LiveData.resolveEpisode;LiveData.resolveEpisode=async function(...args){const result=await original.apply(this,args);window.__qaResolve.finished.push({index:args[1],aborted:args[2]?.aborted===true});return result;};});
 await moving(page,{start:true});return {calls,failed,release:()=>{for(const call of calls)if(call.id===filmA&&call.episode===2&&call.number===1)call.cancelled=!ignoreOldAbort;release();},errors};
}
async function beginDelayedNext(page,fixture){
 await page.evaluate(()=>window.__oldLifecycleVideo=document.querySelector('#watch-player video'));
 await page.locator('#watch-player .player-next-episode').click();await expect.poll(()=>fixture.calls.filter(call=>call.id===filmA&&call.episode===2).length).toBe(1);
 expect(await page.evaluate(()=>LivePlayback.isBusy())).toBe(true);expect(await page.evaluate(()=>LivePlayback.current()?.episode)).toBe(1);
 await page.locator('[data-nav="home"]').click();await expect.poll(()=>page.evaluate(()=>LivePlayback.current())).toBe(null);
}

test('cancelled network episode resolution can retry without old media, history or rate taking ownership',async({page})=>{
 const fixture=await bridgeFixture(page);
 try{
  await beginDelayedNext(page,fixture);await expect.poll(()=>fixture.failed.some(url=>new URL(url).searchParams.get('episode')==='1')).toBe(true);
  await page.goto('/#player/'+filmB);await moving(page,{id:filmB,start:true});fixture.release();
  await page.goto('/#player/'+filmA);await expect.poll(()=>fixture.calls.filter(call=>call.id===filmA&&call.episode===2).length).toBe(2);await moving(page,{id:filmA,episode:2,start:true});
  expect(await page.locator('video').evaluate(v=>new URL(v.currentSrc).searchParams.get('attempt'))).toBe('2');
  await page.evaluate(()=>{for(const event of ['timeupdate','ended','pause','ratechange','error'])window.__oldLifecycleVideo.dispatchEvent(new Event(event));});
  expect(await page.evaluate(()=>LivePlayback.current().episode)).toBe(2);await realSpeed(page,{id:filmA,episode:2,label:'cancelled-network-resolve-retry'});expect(fixture.errors).toEqual([]);
 }finally{fixture.release();}
});

test('a non-cooperative late resolve returns after leaving but cannot replace the new film or its progress',async({page})=>{
 const fixture=await bridgeFixture(page,{ignoreOldAbort:true});
 try{
  await beginDelayedNext(page,fixture);await expect.poll(()=>page.evaluate(()=>window.__qaResolve.aborted.includes('old-episode-2'))).toBe(true);
  await page.goto('/#player/'+filmB);await moving(page,{id:filmB,start:true});const previous=await page.evaluate(()=>load('historyMetadataV2',{})['film-lifecyclea']);fixture.release();
  await expect.poll(()=>page.evaluate(()=>window.__qaResolve.finished.some(value=>value.index===1&&value.aborted))).toBe(true);
  expect(await page.evaluate(()=>LivePlayback.current().filmId)).toBe(filmB);expect(await page.locator('video').evaluate(v=>new URL(v.currentSrc).searchParams.get('film'))).toBe(filmB);
  await realSpeed(page,{id:filmB,label:'non-cooperative-late-resolve-isolated'});
  expect(await page.evaluate(()=>load('historyMetadataV2',{})['film-lifecyclea'])).toEqual(previous);expect(fixture.errors).toEqual([]);
 }finally{fixture.release();}
});

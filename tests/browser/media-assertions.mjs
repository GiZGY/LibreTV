import {expect} from '@playwright/test';

export function mediaState(video){
 const quality=video.getVideoPlaybackQuality?.();
 return{time:video.currentTime,duration:video.duration,ready:video.readyState,paused:video.paused,seeking:video.seeking,ended:video.ended,error:video.error?.code||null,rate:video.playbackRate,defaultRate:video.defaultPlaybackRate,muted:video.muted,width:video.videoWidth,height:video.videoHeight,frames:quality?.totalVideoFrames??video.webkitDecodedFrameCount??null,connected:video.isConnected};
}

// Linux WebKit/GStreamer may keep HAVE_CURRENT_DATA after a successful seek while
// frames and media time continue advancing. Enough-data prediction is not proof
// of playback; paused loading waits for an error-free decoded current frame only.
export async function expectMediaFrame(page,{timeout=15000}={}){
 const video=page.locator('video');await expect(video).toHaveCount(1);
 let last;
 try{
  await expect.poll(async()=>{
   last=await video.evaluate(v=>({
    ready:Number.isFinite(v.duration)&&v.duration>0&&v.readyState>=v.HAVE_CURRENT_DATA&&v.videoWidth>0&&v.videoHeight>0&&!v.seeking&&!v.error,
    state:{ready:v.readyState,network:v.networkState,duration:Number.isFinite(v.duration)?v.duration:null,time:v.currentTime,paused:v.paused,seeking:v.seeking,error:v.error?.code||null,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount??null,connected:v.isConnected}
   }));return last.ready;
  },{timeout,message:'Media must expose a decoded frame and finish seeking'}).toBe(true);
 }catch(error){
  // Keep signed sources and browser credentials out of retained failure evidence.
  throw new Error(error.message+'\nLast media state: '+JSON.stringify(last?.state||{videoElements:await video.count()}),{cause:error});
 }
 return video;
}

export async function expectPlaybackProgress(page,{timeout=10000,episode,episodeKey,lineKey,rate=1.75}={}){
 if(episode!==undefined)await expect.poll(()=>page.evaluate(()=>window.LivePlayback?.current()?.episode)).toBe(episode);
 if(episodeKey!==undefined)await expect.poll(()=>page.evaluate(()=>window.LivePlayback?.current()?.episodeKey)).toBe(episodeKey);
 if(lineKey!==undefined)await expect.poll(()=>page.evaluate(()=>window.LivePlayback?.current()?.lineKey)).toBe(lineKey);
 const video=await expectMediaFrame(page,{timeout});
 // No play() call here: an automatic transition must preserve its own play intent.
 const result=await video.evaluate(async(v,timeout)=>{
  const read=()=>({time:v.currentTime,ready:v.readyState,paused:v.paused,seeking:v.seeking,ended:v.ended,error:v.error?.code||null,frames:v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount??null,connected:v.isConnected});
  let callbacks=0,id=null;const frame=()=>{callbacks++;id=v.requestVideoFrameCallback(frame);};if(v.requestVideoFrameCallback)id=v.requestVideoFrameCallback(frame);
  const start=read(),until=performance.now()+timeout;let after=start;
  try{while(performance.now()<until){await new Promise(resolve=>setTimeout(resolve,100));after=read();const decoded=Math.max(callbacks,(after.frames??0)-(start.frames??0));if(!after.paused&&!after.seeking&&!after.ended&&!after.error&&after.connected&&after.time>start.time+.15&&decoded>0)return{ok:true,start,after,decoded};}return{ok:false,start,after,decoded:callbacks};}finally{if(id!==null)v.cancelVideoFrameCallback?.(id);}
 },timeout);
 expect(result.ok,'Actual playback must advance time and decoded frames: '+JSON.stringify(result)).toBe(true);
 await expect(video).toHaveJSProperty('paused',false);await expect(video).toHaveJSProperty('seeking',false);await expect(video).toHaveJSProperty('playbackRate',rate);await expect(video).toHaveJSProperty('defaultPlaybackRate',rate);await expect(video).toHaveJSProperty('muted',true);
 return result;
}

export async function sampleRealPlayback(page,{milliseconds=10000,rate=1.75,pauseAfter=true,...identity}={}){
 await expectPlaybackProgress(page,{rate,...identity});
 const sample=await page.locator('video').evaluate(async(v,{milliseconds,pauseAfter})=>{
  const read=()=>({time:v.currentTime,frames:v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount??null,paused:v.paused,seeking:v.seeking,ended:v.ended,error:v.error?.code||null,ready:v.readyState,rate:v.playbackRate,defaultRate:v.defaultPlaybackRate,muted:v.muted,connected:v.isConnected});
  const events={waiting:0,pause:0,seeking:0,error:0,ended:0},listeners=Object.keys(events).map(name=>[name,()=>events[name]++]);for(const[name,fn]of listeners)v.addEventListener(name,fn);
  let callbacks=0,id=null;const states=new Set([v.readyState]);const frame=()=>{callbacks++;states.add(v.readyState);id=v.requestVideoFrameCallback(frame);};if(v.requestVideoFrameCallback)id=v.requestVideoFrameCallback(frame);
  const start=read(),stamp=performance.now();let after,elapsed;
  try{do{await new Promise(resolve=>setTimeout(resolve,Math.max(1,milliseconds-(performance.now()-stamp))));}while(performance.now()-stamp<milliseconds);elapsed=performance.now()-stamp;after=read();}
  finally{for(const[name,fn]of listeners)v.removeEventListener(name,fn);if(id!==null)v.cancelVideoFrameCallback?.(id);}
  if(pauseAfter)v.pause();
  return{...after,startTime:start.time,elapsedMs:elapsed,ratio:(after.time-start.time)/(elapsed/1000),decodedFrames:Math.max(callbacks,(after.frames??0)-(start.frames??0)),readyStates:[...states],events};
 },{milliseconds,pauseAfter});
 if(identity.episode!==undefined)expect(await page.evaluate(()=>window.LivePlayback?.current()?.episode)).toBe(identity.episode);
 if(identity.episodeKey!==undefined)expect(await page.evaluate(()=>window.LivePlayback?.current()?.episodeKey)).toBe(identity.episodeKey);
 if(identity.lineKey!==undefined)expect(await page.evaluate(()=>window.LivePlayback?.current()?.lineKey)).toBe(identity.lineKey);
 if(Math.abs(sample.ratio-rate)>=.1)console.log('Playback-rate mismatch:',JSON.stringify(sample));
 expect(sample.elapsedMs).toBeGreaterThanOrEqual(milliseconds);expect(sample.ratio).toBeGreaterThan(rate-.1);expect(sample.ratio).toBeLessThan(rate+.1);expect(sample.decodedFrames).toBeGreaterThanOrEqual(Math.max(1,Math.floor(milliseconds/1000)));expect(sample.events).toEqual({waiting:0,pause:0,seeking:0,error:0,ended:0});expect(sample.paused).toBe(false);expect(sample.seeking).toBe(false);expect(sample.ended).toBe(false);expect(sample.error).toBe(null);expect(sample.connected).toBe(true);expect(sample.rate).toBe(rate);expect(sample.defaultRate).toBe(rate);expect(sample.muted).toBe(true);
 return sample;
}

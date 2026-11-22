import {test,expect,devices} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';

const preferred=1.35;
test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844},
 userAgent:async({browserName},use)=>use(devices[browserName==='webkit'?'iPhone 13':'Pixel 7'].userAgent),
});

test.beforeEach(async({page})=>{
 await page.addInitScript(rate=>{
  const p='openstream_live_',episodes=[1,2,3].map(n=>({name:'第'+n+'集',url:'/media/sample.mp4?ep='+n}));
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-touch',name:'长按播放测试',type:'电视剧',episodes:3,seasons:1,lines:[{key:'qa:1',sourceKey:'qa',name:'测试线路',episodes}],candidatesComplete:true}]));
  localStorage.setItem(p+'playbackRate',String(rate));localStorage.setItem(p+'muted','true');localStorage.setItem(p+'volume','0');
 },preferred);
 await page.goto('/#player/film-touch');
 const video=await expectMediaFrame(page);
 await video.evaluate(v=>v.play());
 await expectPlaybackProgress(page,{rate:preferred});
});

// Chromium injects native touch; macOS WebKit exercises the same TouchEvent
// path and real decoder, but cannot expose the iOS system magnifier.
async function gesture(page,browserName,target=page.locator('video')){
 await target.scrollIntoViewIfNeeded();
 const {x,y,width,height}=await target.boundingBox();
 const origin={x:Math.round(x+width*.5),y:Math.round(y+height*.47)};
 const session=browserName==='chromium'?await page.context().newCDPSession(page):null;
 let position={dx:0,dy:0};
 const dispatch=async(type,dx=0,dy=0,second=false)=>{
  const point={x:origin.x+dx,y:origin.y+dy,id:1};
  const ended=/End|Cancel/.test(type),extra={x:point.x+24,y:point.y,id:2};
  if(session)return session.send('Input.dispatchTouchEvent',{type,touchPoints:ended?[]:second?[point,extra]:[point]});
  return target.evaluate((node,{type,point,extra,ended,second})=>{
   const touch=p=>({identifier:p.id,clientX:p.x,pageX:p.x+scrollX,clientY:p.y,pageY:p.y+scrollY,target:node});
   const event=new Event(type.toLowerCase(),{bubbles:true,cancelable:true});
   Object.defineProperties(event,{touches:{value:ended?[]:second?[touch(point),touch(extra)]:[touch(point)]},changedTouches:{value:second?[touch(extra)]:[touch(point)]}});
   return node.dispatchEvent(event);
  },{type,point,extra,ended,second});
 };
 const down=(dx=0,dy=0)=>{position={dx,dy};return dispatch('touchStart',dx,dy);};
 const up=()=>dispatch('touchEnd',position.dx,position.dy);
 return {origin,down,second:()=>dispatch('touchStart',position.dx,position.dy,true),move:(dx,dy=0)=>{position={dx,dy};return dispatch('touchMove',dx,dy);},up,tap:async dx=>{await down(dx);await up();},cancel:()=>dispatch('touchCancel',position.dx,position.dy),detach:()=>session?.detach()};
}

async function baseSpeed(page){
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',preferred);
 await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',preferred);
 expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe(String(preferred));
}

test('holding the picture accelerates decoded video, release does not also trigger a tap',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 expect(await video.evaluate((v,{x,y})=>document.elementFromPoint(x,y)===v,touch.origin)).toBe(true);
 await video.evaluate(v=>{window.__surfaceTaps=0;Artplayer.instances[0].on('click',()=>window.__surfaceTaps++);window.__surfaceStarts=[];window.addEventListener('touchstart',e=>{if(e.target===v)window.__surfaceStarts.push(e);},{capture:true,passive:true});});
 await touch.down();await touch.up();await baseSpeed(page);
 await expect.poll(()=>page.evaluate(()=>window.__surfaceTaps)).toBe(1);
 const taps=await page.evaluate(()=>window.__surfaceTaps);
 await expect(video).toHaveJSProperty('paused',false);
 const notice=page.locator('.art-notice-inner');const initialNotice=await notice.textContent();
 await touch.down();
 expect(await page.evaluate(()=>window.__surfaceStarts.at(-1)?.defaultPrevented)).toBe(true);
 expect(await video.evaluate(v=>getComputedStyle(v).userSelect)).toBe('none');
 await expect(video).toHaveJSProperty('playbackRate',2);
 await expect(video).toHaveJSProperty('defaultPlaybackRate',preferred);
 expect(await notice.textContent()).toBe(initialNotice);
 await video.evaluate(v=>{window.__holdSeeks=0;v.addEventListener('seeking',()=>window.__holdSeeks++);});
 const progress=page.locator('.art-progress');
 await page.evaluate(()=>Artplayer.instances[0].controls.show=true);
 const track=await progress.boundingBox();
 // Cross the scrubber with the same finger, then move back across the picture.
 await touch.move(75,track.y+track.height/2-touch.origin.y);await touch.move(-60,0);
 await expect(video).toHaveJSProperty('playbackRate',2);
 expect(await page.evaluate(()=>window.__holdSeeks)).toBe(0);
 const sample=await video.evaluate(async v=>{
  let frames=0,frame;const tick=()=>{frames++;frame=v.requestVideoFrameCallback(tick);};frame=v.requestVideoFrameCallback(tick);
  const time=v.currentTime,wall=performance.now();await new Promise(r=>setTimeout(r,1300));v.cancelVideoFrameCallback(frame);
  return {rate:(v.currentTime-time)*1000/(performance.now()-wall),frames,muted:v.muted,paused:v.paused};
 });
 console.log(JSON.stringify({browserName,...sample}));expect(sample.rate).toBeGreaterThan(1.9);expect(sample.rate).toBeLessThan(2.1);expect(sample.frames).toBeGreaterThan(5);expect(sample.muted).toBe(true);expect(sample.paused).toBe(false);
 await touch.move(60,track.y+track.height/2-touch.origin.y);await touch.up();
 if(browserName==='webkit')expect(await video.evaluate(v=>v.dispatchEvent(new PointerEvent('click',{bubbles:true,cancelable:true,pointerType:'touch',detail:1})))).toBe(false);
 await baseSpeed(page);await expect(video).toHaveJSProperty('paused',false);expect([initialNotice,'']).toContain(await notice.textContent());
 expect(await page.evaluate(()=>window.__surfaceTaps)).toBe(taps);
 expect(await page.evaluate(()=>window.__holdSeeks)).toBe(0);
 await touch.detach();
 await sampleRealPlayback(page,{milliseconds:1300,rate:preferred});
});

test('controls, swipes, multiple fingers, cancel and paused video do not latch a boost',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 await video.evaluate(v=>{window.__pictureSeeks=0;v.addEventListener('seeking',()=>window.__pictureSeeks++);});
 await touch.down();await touch.move(90,0);
 await page.waitForTimeout(500);await baseSpeed(page);await touch.up();
 expect(await page.evaluate(()=>window.__pictureSeeks)).toBe(0);
 await touch.down();await touch.second();await page.waitForTimeout(500);await baseSpeed(page);await touch.cancel();
 await touch.down();await expect(page.locator('video')).toHaveJSProperty('playbackRate',2);await touch.cancel();await baseSpeed(page);
 await touch.down();await expect(video).toHaveJSProperty('playbackRate',2);await video.evaluate(v=>v.pause());await baseSpeed(page);await touch.up();
 await touch.down();await page.waitForTimeout(500);await baseSpeed(page);await touch.cancel();await touch.detach();
 await video.evaluate(v=>v.play());await expectPlaybackProgress(page,{rate:preferred});
 const controls=page.locator('.fine-speed summary');await page.locator('video').dispatchEvent('click');
 const controlTouch=await gesture(page,browserName,controls);
 await controlTouch.down();await page.waitForTimeout(500);await baseSpeed(page);await controlTouch.cancel();await controlTouch.detach();
});

test('web fullscreen supports hold and an episode switch clears the old gesture',async({page,browserName})=>{
 await page.locator('.art-control-fullscreenWeb').dispatchEvent('click');
 await expect(page.locator('.art-video-player')).toHaveClass(/art-fullscreen-web/);
 const touch=await gesture(page,browserName);
 await touch.down();await expect(page.locator('video')).toHaveJSProperty('playbackRate',2);
 await page.locator('.player-next-episode').dispatchEvent('click');
 await expectPlaybackProgress(page,{episode:2,rate:preferred});
 await touch.up();await touch.detach();await baseSpeed(page);
 await expect(page.locator('.art-video-player')).toHaveClass(/art-fullscreen-web/);
 const next=await gesture(page,browserName);await next.down();await expect(page.locator('video')).toHaveJSProperty('playbackRate',2);await next.up();await baseSpeed(page);await next.detach();
});

test('left and right double taps seek 15 seconds, clamp to the video, and do not pause',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 const jump=(side)=>touch.tap(side).then(()=>touch.tap(side));
 const seekTo=async time=>{
  await video.evaluate((v,time)=>v.currentTime=time,time);
  await expect.poll(()=>video.evaluate(v=>v.seeking)).toBe(false);
 };
 await seekTo(25);
 await video.evaluate(v=>{window.__seekDelta=null;let before=v.currentTime;window.addEventListener('touchend',e=>{if(e.target===v)before=v.currentTime;},true);v.addEventListener('seeking',()=>window.__seekDelta=v.currentTime-before);});
 await jump(-92);
 await expect.poll(()=>page.evaluate(()=>window.__seekDelta)).toBeCloseTo(-15,1);
 await expect(video).toHaveJSProperty('paused',false);
 await expect.poll(()=>video.evaluate(v=>v.seeking)).toBe(false);
 await jump(92);
 await expect.poll(()=>page.evaluate(()=>window.__seekDelta)).toBeCloseTo(15,1);
 await expect(video).toHaveJSProperty('paused',false);
 await video.evaluate(v=>v.pause());
 await seekTo(2);await jump(-92);
 await expect(video).toHaveJSProperty('currentTime',0);
 await expect.poll(()=>video.evaluate(v=>v.seeking)).toBe(false);
 await seekTo(55);await jump(92);
 const end=await video.evaluate(v=>v.duration);
 await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeCloseTo(end-.25,1);
 await expect(video).toHaveJSProperty('paused',true);
 expect(await page.evaluate(()=>LivePlayback.current()?.episode)).toBe(1);
 await baseSpeed(page);await touch.detach();
});

test('slow or opposite-side taps are not seek gestures',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 await video.evaluate(v=>{window.__gestureCounts={seek:0,tap:0};v.addEventListener('seeking',()=>window.__gestureCounts.seek++);Artplayer.instances[0].on('click',()=>window.__gestureCounts.tap++);});
 await touch.tap(-90);await expect.poll(()=>page.evaluate(()=>window.__gestureCounts.tap)).toBe(1);
 await touch.tap(-90);await expect.poll(()=>page.evaluate(()=>window.__gestureCounts.tap)).toBe(2);
 await touch.tap(-90);await touch.tap(90);
 await expect.poll(()=>page.evaluate(()=>window.__gestureCounts.tap)).toBe(3);
 expect(await page.evaluate(()=>window.__gestureCounts.seek)).toBe(0);await expect(video).toHaveJSProperty('paused',false);await touch.detach();
});

async function pausedAt(page,time){
 const video=page.locator('video');
 await video.evaluate((v,time)=>{v.pause();v.currentTime=time;Artplayer.instances[0].controls.show=true;},time);
 await expect.poll(()=>video.evaluate(v=>v.seeking)).toBe(false);
 await expect(video).toHaveJSProperty('currentTime',time);
 return video;
}

test('dragging the current-position thumb still seeks immediately across the full timeline',async({page,browserName})=>{
 const video=await pausedAt(page,20);
 const track=page.locator('.art-progress'),thumb=track.locator('.art-progress-indicator');
 const touch=await gesture(page,browserName,track),box=await thumb.boundingBox();
 const start=box.x+box.width/2-touch.origin.x;
 await touch.down(start);await touch.move(start+85);
 await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(29);
 await touch.up();await baseSpeed(page);await touch.detach();
});

test('holding the track away from the thumb previews fine shifts and commits a single seek',async({page,browserName})=>{
 const video=await pausedAt(page,20),track=page.locator('.art-progress');
 const touch=await gesture(page,browserName,track),played=track.locator('.art-progress-played');
 const marker=()=>played.evaluate(el=>parseFloat(el.style.width));
 await video.evaluate(v=>{window.__trackSeeks=0;v.addEventListener('seeking',()=>window.__trackSeeks++);});
 await touch.down();await page.waitForTimeout(450);await touch.move(-30);
 await expect.poll(marker).toBeCloseTo(100*17/60,2);
 await expect(video).toHaveJSProperty('currentTime',20);
 await touch.move(60);
 await expect.poll(marker).toBeCloseTo(100*26/60,2);
 expect(await page.evaluate(()=>window.__trackSeeks)).toBe(0);
 await touch.up();await expect(video).toHaveJSProperty('currentTime',26);
 await expect.poll(()=>video.evaluate(v=>v.seeking)).toBe(false);
 expect(await page.evaluate(()=>window.__trackSeeks)).toBe(1);
 // Releasing a stationary hold and cancelling a moved one must not seek.
 await touch.down(-60);await page.waitForTimeout(450);await touch.up();
 await expect(video).toHaveJSProperty('currentTime',26);
 await touch.down(70);await page.waitForTimeout(450);await touch.move(20);await touch.cancel();
 await expect.poll(marker).toBeCloseTo(100*26/60,2);
 await expect(video).toHaveJSProperty('currentTime',26);
 expect(await page.evaluate(()=>window.__trackSeeks)).toBe(1);
 await baseSpeed(page);await touch.detach();
});

test('short tapping the progress track still jumps to the tapped position',async({page,browserName})=>{
 const video=await pausedAt(page,20),track=page.locator('.art-progress');
 const touch=await gesture(page,browserName,track);
 const target=await track.evaluate((t,x)=>{const r=t.getBoundingClientRect();return (x-r.left)/r.width*60;},touch.origin.x+60);
 await touch.tap(60);
 await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeCloseTo(target,1);
 await baseSpeed(page);await touch.detach();
});

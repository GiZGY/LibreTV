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

// Chromium exercises browser touch input. WebKit has no CDP touch injection;
// use pointer events with a real decoder there, and label the evidence accordingly.
async function gesture(page,browserName,target=page.locator('video')){
 await target.scrollIntoViewIfNeeded();
 const {x,y,width,height}=await target.boundingBox();
 const origin={x:Math.round(x+width*.5),y:Math.round(y+height*.47)};
 const session=browserName==='chromium'?await page.context().newCDPSession(page):null;
 const dispatch=async(type,dx=0,second=false)=>{
  const point={x:origin.x+dx,y:origin.y,id:1};
  if(session)return session.send('Input.dispatchTouchEvent',{type,touchPoints:/End|Cancel/.test(type)?[]:second?[point,{x:point.x+24,y:point.y,id:2}]:[point]});
  const pointerType={touchStart:'pointerdown',touchMove:'pointermove',touchEnd:'pointerup',touchCancel:'pointercancel'}[type];
  await target.dispatchEvent(pointerType,{pointerType:'touch',pointerId:second?2:1,isPrimary:!second,clientX:point.x,clientY:point.y,bubbles:true,cancelable:true});
 };
 return {origin,down:()=>dispatch('touchStart'),second:()=>dispatch('touchStart',0,true),move:dx=>dispatch('touchMove',dx),up:()=>dispatch('touchEnd'),cancel:()=>dispatch('touchCancel'),detach:()=>session?.detach()};
}

async function baseSpeed(page){
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',preferred);
 await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',preferred);
 expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe(String(preferred));
}

test('holding the picture accelerates decoded video, release does not also trigger a tap',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 expect(await video.evaluate((v,{x,y})=>document.elementFromPoint(x,y)===v,touch.origin)).toBe(true);
 await video.evaluate(v=>{window.__surfaceTaps=0;v.addEventListener('click',()=>window.__surfaceTaps++);});
 await touch.down();await touch.up();await baseSpeed(page);
 if(browserName==='chromium')await expect.poll(()=>page.evaluate(()=>window.__surfaceTaps)).toBe(1);
 const taps=await page.evaluate(()=>window.__surfaceTaps);
 await expect(video).toHaveJSProperty('paused',false);
 const notice=page.locator('.art-notice-inner');const initialNotice=await notice.textContent();
 await touch.down();
 await expect(video).toHaveJSProperty('playbackRate',2);
 await expect(video).toHaveJSProperty('defaultPlaybackRate',preferred);
 expect(await notice.textContent()).toBe(initialNotice);
 const sample=await video.evaluate(async v=>{
  let frames=0,frame;const tick=()=>{frames++;frame=v.requestVideoFrameCallback(tick);};frame=v.requestVideoFrameCallback(tick);
  const time=v.currentTime,wall=performance.now();await new Promise(r=>setTimeout(r,1300));v.cancelVideoFrameCallback(frame);
  return {rate:(v.currentTime-time)*1000/(performance.now()-wall),frames,muted:v.muted,paused:v.paused};
 });
 console.log(JSON.stringify({browserName,...sample}));expect(sample.rate).toBeGreaterThan(1.9);expect(sample.rate).toBeLessThan(2.1);expect(sample.frames).toBeGreaterThan(5);expect(sample.muted).toBe(true);expect(sample.paused).toBe(false);
 await touch.up();
 if(browserName==='webkit')expect(await video.evaluate(v=>v.dispatchEvent(new PointerEvent('click',{bubbles:true,cancelable:true,pointerType:'touch',detail:1})))).toBe(false);
 await baseSpeed(page);await expect(video).toHaveJSProperty('paused',false);expect([initialNotice,'']).toContain(await notice.textContent());
 expect(await page.evaluate(()=>window.__surfaceTaps)).toBe(taps);
 await touch.detach();
 await sampleRealPlayback(page,{milliseconds:1300,rate:preferred});
});

test('controls, swipes, multiple fingers, cancel and paused video do not latch a boost',async({page,browserName})=>{
 const video=page.locator('video'),touch=await gesture(page,browserName);
 await touch.down();await touch.move(28);await page.waitForTimeout(500);await baseSpeed(page);await touch.cancel();
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

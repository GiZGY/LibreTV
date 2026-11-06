import {test,expect} from '@playwright/test';
async function openPlayer(page,mode='mp4'){
 await page.addInitScript(mode=>{
  const p='openstream_live_';
  const line=n=>({key:'qa:'+n,sourceKey:'qa',name:'测试线路 '+n,health:'fast',episodes:Array.from({length:8},(_,i)=>({name:'第'+(i+1)+'集',url:'/media/sample.'+(mode==='hls'?'m3u8':'mp4')+'?line='+n+'&ep='+i}))});
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-qa1',name:'回归测试剧集',type:'电视剧',episodes:8,seasons:1,year:2024,genre:'剧情',rating:8,lines:[line(1),line(2)],candidatesComplete:true,cover:''}]));
  localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','true');
  const mute=()=>document.querySelectorAll('video').forEach(v=>{v.muted=true;v.volume=0;});
  addEventListener('DOMContentLoaded',()=>{mute();new MutationObserver(mute).observe(document.body,{childList:true,subtree:true});});
 },mode);
 await page.goto('/#player/film-qa1');
 await expect(page.locator('video')).toHaveJSProperty('readyState',4,{timeout:15000});
 await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
async function speed(page){
 await page.locator('video').evaluate(v=>v.play());
 const reading=await page.locator('video').evaluate(async v=>{
  let stalls=0;const onWait=()=>stalls++;v.addEventListener('waiting',onWait);
  const start=v.currentTime,t=performance.now();await new Promise(r=>setTimeout(r,10000));
  const ratio=(v.currentTime-start)/((performance.now()-t)/1000);v.removeEventListener('waiting',onWait);v.pause();
  return{ratio,stalls,rate:v.playbackRate,defaultRate:v.defaultPlaybackRate,muted:v.muted};
 });
 console.log(JSON.stringify({test:test.info().title,project:test.info().project.name,sampleSeconds:10,...reading}));
 expect(reading.stalls).toBe(0);expect(reading.ratio).toBeGreaterThan(1.65);expect(reading.ratio).toBeLessThan(1.85);expect(reading.rate).toBe(1.75);expect(reading.defaultRate).toBe(1.75);expect(reading.muted).toBe(true);
 await expect(page.locator('.fine-speed summary')).toHaveText('1.75×');
}
async function nextReady(page,episode){
 await expect(page.locator('.episodes .active')).toHaveText(String(episode));
 const video=page.locator('video');
 try{
  await expect(video).toHaveJSProperty('paused',false);
  const start=await video.evaluate(v=>v.currentTime);await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:10000}).toBeGreaterThan(start+.15);
  await expect(video).toHaveJSProperty('readyState',4);
 }catch(error){console.log(JSON.stringify({episode,media:await video.evaluate(v=>({time:v.currentTime,duration:v.duration,paused:v.paused,seeking:v.seeking,ended:v.ended,ready:v.readyState,network:v.networkState,rate:v.playbackRate,muted:v.muted,error:v.error?.code,buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)])}))}));throw error;}
}
test('full UI: manual, natural-ended, outro and line switch inherit real speed',async({page})=>{
 await openPlayer(page);
 await page.getByRole('checkbox',{name:'自动连播',exact:true}).uncheck();
 await page.locator('.art-control-fullscreen').click();
 await page.locator('#watch-player .player-next-episode').click();await nextReady(page,2);await speed(page);
 expect(await page.evaluate(()=>document.fullscreenElement?.id)).toBe('watch-player');
 await page.locator('.art-control-fullscreen').click();await page.getByRole('checkbox',{name:'自动连播',exact:true}).check();
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.4;return v.play();});await nextReady(page,3);await speed(page);
 await page.evaluate(()=>localStorage.setItem('openstream_live_skip_film-qa1',JSON.stringify({intro:2,outro:5})));
 await page.locator('.episodes .active').click();await expect(page.locator('video')).toHaveJSProperty('readyState',4);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-4.8;v.play().catch(()=>{});});await nextReady(page,4);await speed(page);
 await page.getByText('播放线路',{exact:false}).first().click();await page.locator('[data-live-line="1"]').click();await expect(page.locator('[data-live-line="1"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('video')).toHaveJSProperty('readyState',4);await speed(page);
});
test('media reload after position restoration keeps actual speed',async({page})=>{
 await openPlayer(page);await page.locator('video').evaluate(v=>v.load());await expect(page.locator('video')).toHaveJSProperty('readyState',4);await speed(page);
});
test('real HLS error recovery keeps selected speed',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'Hls',{configurable:true,get(){return this.__Hls;},set(Base){this.__Hls=class extends Base{constructor(...args){super(...args);window.__qaHls=this;}};}});});
 await openPlayer(page,'hls');
 await page.evaluate(()=>window.__qaHls.recoverMediaError());await expect(page.locator('video')).toHaveJSProperty('readyState',4);await speed(page);
});
test('temporary keyboard acceleration and blur preserve the selected default',async({page})=>{
 await openPlayer(page);await page.keyboard.down('ArrowRight');await expect(page.locator('video')).toHaveJSProperty('playbackRate',2);await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',1.75);await expect(page.locator('.fine-speed summary')).toHaveText('2×');await page.keyboard.up('ArrowRight');await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);
 expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe('1.75');await page.locator('.art-control-fine-speed summary').click();await page.locator('.fine-speed').press('Escape');await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');
});
test('rapid next requests and detached media events cannot advance or overwrite the new episode',async({page})=>{
 await openPlayer(page);await page.evaluate(()=>window.__oldVideo=document.querySelector('video'));
 await page.locator('#watch-player .player-next-episode').dblclick();await nextReady(page,2);
 await page.locator('video').evaluate(v=>v.pause());
 await page.evaluate(()=>{const v=window.__oldVideo;for(const name of ['pause','timeupdate','ended','ratechange','error'])v.dispatchEvent(new Event(name));});
 await expect(page.locator('.episodes .active')).toHaveText('2');
 const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_historyMetadataV2'))['film-qa1']);expect(record.episode).toBe(2);expect(record.position).toBeLessThan(10);
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);
 await page.locator('#watch-player .player-next-episode').click();await nextReady(page,3);await page.locator('#watch-player .player-next-episode').click();await nextReady(page,4);
});

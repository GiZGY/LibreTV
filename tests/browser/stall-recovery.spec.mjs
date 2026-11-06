import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';
async function open(page,{mode='mp4',sparse=false,missing=false,extra=false,skip=false}={}){
 await page.addInitScript(({mode,sparse,missing,extra,skip})=>{
  const p='openstream_live_',line=(n,episodes=[1,2,3],options={})=>({key:'stall:'+n,sourceKey:'qa',name:'测试线路 '+n,health:'fast',episodes:episodes.map(e=>({name:'第'+e+'集',url:'/media/sample.'+(mode==='hls'?'m3u8':'mp4')+'?line='+n+'&ep='+e})),...options});
  const lines=sparse?[line(1,[1,3]),line(2,missing?[3,1]:[3,2,1])]:[line(1),line(2),line(3),line(4)];
  if(extra)lines.splice(1,0,line('missing',[2,3]),line('html',[1,2,3],{episodes:[{name:'第1集',url:'/media/not-video.m3u8'}]}),line('cut',[1,2,3],{name:'导演剪辑版'}));
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-stall',name:'受控卡顿测试',type:'电视剧',episodes:3,seasons:1,lines,candidatesComplete:true,year:2026,genre:'剧情',rating:8}]));localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'muted','true');localStorage.setItem(p+'volume','0');localStorage.setItem(p+'autoplay','true');if(skip)localStorage.setItem(p+'skip_film-stall',JSON.stringify({intro:0,outro:5}));
  window.__probeSounds=[];document.addEventListener('play',event=>{if(event.target.matches?.('[data-playback-probe]'))window.__probeSounds.push({muted:event.target.muted,volume:event.target.volume});},true);
 },{mode,sparse,missing,extra,skip});
 await page.goto('/#player/film-stall');await expectMediaFrame(page);await page.locator('#watch-player .art-video').evaluate(v=>v.play());await expectPlaybackProgress(page,{episode:1,episodeKey:'s1:e1',lineKey:'stall:1'});
}
const current=page=>page.evaluate(()=>LivePlayback.current()?.lineKey);
async function badManifest(page){await page.route('**/media/not-video.m3u8',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>not media</title>'}));}
async function heldAlternates(page){
 const pending=[];await page.route('**/media/sample.mp4?**',route=>{if(['2','3'].includes(new URL(route.request().url()).searchParams.get('line'))){pending.push(route);return;}return route.continue();});
 return async()=>{for(const route of pending)await route.continue().catch(()=>{});};
}

test('recovery decodes an exact-key candidate instead of trusting fast HTTP 200 or another cut',async({page})=>{
 await badManifest(page);await open(page,{extra:true});
 await page.locator('#watch-player .art-video').evaluate(v=>{v.currentTime=12;});await expect(page.locator('#watch-player .art-video')).toHaveJSProperty('seeking',false);
 const position=await page.locator('#watch-player .art-video').evaluate(v=>v.currentTime);
 await page.evaluate(()=>{void LivePlayback.failed(LivePlayback.current());});await expect.poll(()=>current(page),{timeout:15000}).toBe('stall:2');
 await expectMediaFrame(page);expect(await page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(position-.5);
 await sampleRealPlayback(page,{episode:1,episodeKey:'s1:e1',lineKey:'stall:2'});
 const sounds=await page.evaluate(()=>window.__probeSounds);expect(sounds.length).toBeGreaterThan(0);expect(sounds.every(value=>value.muted&&value.volume===0)).toBe(true);await expect(page.locator('[data-playback-probe]')).toHaveCount(0);
});

for(const trigger of ['manual','ended','outro'])test(`a ${trigger} next request chooses the exact missing episode on another line`,async({page})=>{
 await open(page,{sparse:true,skip:trigger==='outro'});
 if(trigger==='manual')await page.locator('.player-next-episode').click();else await page.locator('video').evaluate((v,trigger)=>{v.currentTime=v.duration-(trigger==='outro'?4.8:.3);},trigger);
 await expectPlaybackProgress(page,{episode:2,episodeKey:'s1:e2',lineKey:'stall:2'});expect(await page.locator('video').evaluate(v=>v.currentSrc)).toContain('ep=2');
});
test('missing on every line never borrows the following episode',async({page})=>{
 await open(page,{sparse:true,missing:true});await page.locator('.player-next-episode').click();
 await expect.poll(()=>page.evaluate(()=>LivePlayback.current())).toBe(null);await expect(page.locator('.watch-empty')).toContainText('暂未获取到播放地址');expect(await page.locator('video').evaluate(v=>v.currentSrc)).not.toContain('ep=3');
});

for(const action of ['pause','seek','api-pause','api-seek','manual-line'])test(`a ${action} action cancels a late recovery candidate`,async({page})=>{
 const release=await heldAlternates(page);try{
  await open(page);await page.evaluate(()=>{void LivePlayback.failed(LivePlayback.current());});await expect(page.locator('[data-playback-probe]')).toHaveCount(1);
  if(action==='api-pause')await page.locator('#watch-player .art-video').evaluate(v=>v.pause());
  if(action==='api-seek')await page.locator('#watch-player .art-video').evaluate(v=>{v.currentTime=18;});
  if(action==='pause')await page.locator('.art-control-playAndPause').click();
  if(action==='seek'){const box=await page.locator('.art-progress').boundingBox();await page.mouse.click(box.x+box.width*.3,box.y+box.height/2);}
  if(action==='manual-line'){await page.locator('.player-bottom-trigger[data-player-panel="lines"]').click();await page.locator('[data-player-line="3"]').click();await expectPlaybackProgress(page,{episode:1,lineKey:'stall:4'});}
  await expect(page.locator('[data-playback-probe]')).toHaveCount(0);await release();await page.waitForTimeout(1500);expect(await current(page)).toBe(action==='manual-line'?'stall:4':'stall:1');
  if(action==='api-pause')await page.locator('#watch-player .art-video').evaluate(v=>v.pause());
  if(action==='api-seek')await page.locator('#watch-player .art-video').evaluate(v=>{v.currentTime=18;});
  if(action==='pause'||action==='api-pause')await expect(page.locator('#watch-player .art-video')).toHaveJSProperty('paused',true);
 }finally{await release();}
});
test('eight seconds of genuine current-line recovery cancels late candidate takeover',async({page})=>{
 const release=await heldAlternates(page);try{
  await open(page);await page.evaluate(()=>{void LivePlayback.failed(LivePlayback.current());});await expect(page.locator('[data-playback-probe]')).toHaveCount(1);
  await expect(page.locator('[data-playback-probe]')).toHaveCount(0,{timeout:12000});await release();expect(await current(page)).toBe('stall:1');await sampleRealPlayback(page,{episode:1,lineKey:'stall:1'});
 }finally{await release();}
});

for(const kind of ['continuous','short','bursty'])test(`controlled ${kind} HLS stalls have bounded recovery and retain real speed`,async({page})=>{
 const pending=[],timers=new Set();let released=false;
 await page.route('**/media/sample.m3u8?**',async route=>{const response=await route.fetch(),original=await response.text(),first=new URL(route.request().url()).searchParams.get('line')==='1';await route.fulfill({response,body:first?original.replace(/(sample\d+\.ts)/g,'$1?fault='+kind):original});});
 await page.route('**/media/sample*.ts?fault=*',async route=>{
  const number=Number(route.request().url().match(/sample(\d+)\.ts/)[1]);if(number<2||released)return route.continue();
  if(kind==='continuous'){pending.push(route);return;}
  if(kind==='short'){released=true;const timer=setTimeout(()=>{timers.delete(timer);route.continue().catch(()=>{});},2000);timers.add(timer);return;}
  const timer=setTimeout(()=>{timers.delete(timer);route.continue().catch(()=>{});},8000);timers.add(timer);pending.push(route);
 });
 try{
  await open(page,{mode:'hls'});await page.locator('video').evaluate(v=>{window.__stallEvents=[];for(const name of ['waiting','playing'])v.addEventListener(name,()=>window.__stallEvents.push({name,time:v.currentTime,wall:performance.now()}));});
  if(kind==='short'){await page.waitForTimeout(6000);expect(await current(page)).toBe('stall:1');expect(await page.evaluate(()=>OpenStreamPlayback.diagnostic().current?.recoveryCount||0)).toBe(0);await sampleRealPlayback(page,{episode:1,lineKey:'stall:1'});return;}
  await expect.poll(()=>current(page),{timeout:55000,intervals:[500]}).toBe('stall:2');released=true;
  const before=await page.evaluate(()=>OpenStreamPlayback.diagnostic().recent);expect(before.some(value=>value.recoveryCount>=1)).toBe(true);
  if(kind==='bursty')expect((await page.evaluate(()=>window.__stallEvents)).filter(event=>event.name==='playing').length).toBeGreaterThanOrEqual(2);
  await expectMediaFrame(page);await sampleRealPlayback(page,{episode:1,lineKey:'stall:2'});await expect(page.locator('[data-playback-probe]')).toHaveCount(0);
 }finally{for(const timer of timers)clearTimeout(timer);for(const route of pending)await route.abort().catch(()=>{});}
});

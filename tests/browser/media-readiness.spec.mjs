import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback,mediaState} from './media-assertions.mjs';
async function open(page){
 await page.addInitScript(()=>{const p='openstream_live_',episodes=Array.from({length:4},(_,i)=>({name:'第'+(i+1)+'集',url:'/media/sample.mp4?ep='+(i+1)}));localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-readiness',name:'媒体就绪与真实播放回归',type:'电视剧',episodes:4,seasons:1,lines:[{key:'qa:ready',sourceKey:'qa',name:'测试线路',health:'fast',episodes}],candidatesComplete:true}]));localStorage.setItem(p+'autoplay','true');localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');});
 await page.goto('/#player/film-readiness');await expectMediaFrame(page);
}
test('intro-seek remount renders advancing frames and true speed without relying on enough-data prediction',async({page})=>{
 await open(page);await page.locator('.player-next-episode').click();await expectPlaybackProgress(page,{episode:2,episodeKey:'s1:e2'});
 await page.evaluate(()=>localStorage.setItem('openstream_live_skip_film-readiness',JSON.stringify({intro:2,outro:5})));await page.locator('.episodes .active').click();await expectPlaybackProgress(page,{episode:2,episodeKey:'s1:e2'});
 const before=await page.locator('video').evaluate(mediaState),sample=await sampleRealPlayback(page,{episode:2,episodeKey:'s1:e2',lineKey:'qa:ready'});
 expect(sample.startTime).toBeGreaterThanOrEqual(2);console.log(JSON.stringify({path:'post-seek-real-playback',project:test.info().project.name,before,...sample}));
});
test('an error-free current frame cannot make a paused video pass automatic-playback acceptance',async({page})=>{
 await open(page);await expect(page.locator('video')).toHaveJSProperty('paused',true);
 await expect(expectPlaybackProgress(page,{timeout:350,episode:1})).rejects.toThrow('Actual playback must advance time and decoded frames');
 await expect(page.locator('video')).toHaveJSProperty('paused',true);
});

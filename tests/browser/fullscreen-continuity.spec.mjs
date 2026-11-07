import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';
async function seed(page,format='mp4'){await page.addInitScript(format=>{const p='openstream_live_',line=n=>({key:'qa:'+n,sourceKey:'qa',name:'测试线路 '+n,health:'fast',episodes:Array.from({length:8},(_,i)=>({name:'第'+(i+1)+'集',url:'/media/sample.'+(format==='hls'?'m3u8':'mp4')+'?line='+n+'&ep='+(i+1)}))});localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-fullscreen',name:'全屏连续播放测试',type:'电视剧',episodes:8,seasons:1,year:2024,lines:[line(1),line(2)],candidatesComplete:true}]));localStorage.setItem(p+'autoplay','true');localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');},format);await page.goto('/#player/film-fullscreen');await expectMediaFrame(page);await page.evaluate(()=>window.__fullscreenRoot=document.querySelector('#watch-player'));}
async function retained(page,mode,episode){
 await expectPlaybackProgress(page,{episode});
 expect(await page.evaluate(()=>document.querySelector('#watch-player')===window.__fullscreenRoot)).toBe(true);
 expect(await page.evaluate(mode=>mode==='native'?document.fullscreenElement?.id==='watch-player':document.documentElement.classList.contains('video-web-fullscreen')&&document.querySelector('#watch-player .art-video-player').classList.contains('art-fullscreen-web'),mode)).toBe(true);
 if(mode==='native'){await expect(page.locator('.art-control-fullscreen')).toHaveAttribute('aria-label','退出全屏');await expect(page.locator('#watch-player .art-video-player')).toHaveClass(/(?:^| )art-fullscreen(?: |$)/);}
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',1.75);await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
for(const [mode,format] of [['native','mp4'],['web','mp4'],['native','hls']])test(`${mode}${format==='hls'?' HLS':''} fullscreen survives manual, natural, outro and line transitions in one uninterrupted session`,async({page})=>{
 await seed(page,format);await page.locator(mode==='native'?'.art-control-fullscreen':'.art-control-fullscreenWeb').click();await page.locator('.player-next-episode').click();await retained(page,mode,2);
 if(format==='hls')await sampleRealPlayback(page,{episode:2,pauseAfter:false});
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.35;});await retained(page,mode,3);
 if(format==='hls')await sampleRealPlayback(page,{episode:3,pauseAfter:false});
 await page.evaluate(()=>localStorage.setItem('openstream_live_skip_film-fullscreen',JSON.stringify({intro:2,outro:5})));await page.locator('.player-bottom-trigger[data-player-panel="episodes"]').click();await page.locator('[data-player-episode="3"]').click();await retained(page,mode,3);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-4.8;});await retained(page,mode,4);
 if(format==='hls')await sampleRealPlayback(page,{episode:4,pauseAfter:false});
 await page.locator('.player-bottom-trigger[data-player-panel="lines"]').click();await page.locator('[data-player-line="1"]').click();await expect.poll(()=>page.evaluate(()=>LivePlayback.current()?.lineKey)).toBe('qa:2');await retained(page,mode,4);
 const sample=await sampleRealPlayback(page,{episode:4,lineKey:'qa:2'});
 expect(await page.evaluate(mode=>mode==='native'?document.fullscreenElement?.id==='watch-player':document.documentElement.classList.contains('video-web-fullscreen'),mode)).toBe(true);
 // WebKit reserves Escape for native fullscreen; close settings with its own control.
 if(mode==='native'){await page.locator('.art-control-setting').click();await expect(page.locator('.art-video-player')).toHaveClass(/art-setting-show/);await page.locator('.art-control-setting').click();await expect(page.locator('.art-video-player')).not.toHaveClass(/art-setting-show/);expect(await page.evaluate(()=>document.fullscreenElement?.id)).toBe('watch-player');await page.locator('.art-control-fullscreen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement)).toBe(null);await expect(page.locator('.art-control-fullscreen')).toHaveAttribute('aria-label','全屏');await expect(page.locator('.art-video-player')).not.toHaveClass(/(?:^| )art-fullscreen(?: |$)/);}
 console.log(JSON.stringify({mode,format,project:test.info().project.name,sampleSeconds:10,...sample}));
});

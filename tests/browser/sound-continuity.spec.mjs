import {test,expect} from '@playwright/test';
import {expectMediaFrame} from './media-assertions.mjs';
test('play restores mute intent, while explicit unmute and zero volume survive pause, seek and next episode',async({page})=>{
 await page.addInitScript(()=>{
  const p='openstream_live_';
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-sound',name:'声音状态测试',type:'电视剧',episodes:3,seasons:1,lines:[{key:'qa:1',sourceKey:'qa',name:'线路',episodes:[1,2,3].map(e=>({name:'第'+e+'集',url:'/media/sample.mp4?episode='+e}))}]}]));
  localStorage.setItem(p+'muted','true');localStorage.setItem(p+'volume','0.6');localStorage.setItem(p+'autoplay','true');
 });
 await page.goto('/#player/film-sound');const video=await expectMediaFrame(page);
 await video.evaluate(v=>v.play());await expect(video).toHaveJSProperty('muted',true);await expect(video).toHaveJSProperty('volume',0);
 await page.locator('.art-icon-volumeClose').click();await expect(video).toHaveJSProperty('muted',false);await expect.poll(()=>video.evaluate(v=>v.volume)).toBeCloseTo(.6,5);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_muted')))).toBe(false);
 await video.evaluate(v=>{v.pause();v.volume=0;});await expect.poll(()=>page.evaluate(()=>Number(localStorage.getItem('openstream_live_volume')))).toBe(0);
 await video.evaluate(v=>v.play());await expect(video).toHaveJSProperty('muted',false);await expect(video).toHaveJSProperty('volume',0);
 await video.evaluate(v=>v.currentTime=8);await expectMediaFrame(page);await expect(video).toHaveJSProperty('volume',0);
 await page.locator('.player-next-episode').click();await expect.poll(()=>page.evaluate(()=>LivePlayback.current()?.episode)).toBe(2);await expectMediaFrame(page);
 await expect(video).toHaveJSProperty('paused',false);await expect(video).toHaveJSProperty('muted',false);await expect(video).toHaveJSProperty('volume',0);
});

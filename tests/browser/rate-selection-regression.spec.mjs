import {test,expect} from '@playwright/test';
import {expectMediaFrame} from './media-assertions.mjs';

test('pointer-selected speed reaches real media while popup focus and keyboard dismissal remain correct',async({page})=>{
 await page.addInitScript(()=>{
  const prefix='openstream_live_',film={id:'film-rateselect',name:'倍速选择回归',type:'电视剧',episodes:2,seasons:1,year:2025,genre:'剧情',rating:8,
   lines:[{key:'qa:selection',sourceKey:'qa',name:'验收线路',health:'fast',episodes:[{name:'第1集',url:'/media/sample.mp4'},{name:'第2集',url:'/media/sample.mp4?ep=2'}]}],candidatesComplete:true};
  localStorage.setItem(prefix+'filmRecords',JSON.stringify([film]));localStorage.setItem(prefix+'playbackRate','1');localStorage.setItem(prefix+'autoplay','false');
  const mute=()=>document.querySelectorAll('video').forEach(video=>{video.muted=true;video.volume=0;});
  addEventListener('DOMContentLoaded',()=>{mute();new MutationObserver(mute).observe(document.body,{childList:true,subtree:true});});
 });
 await page.goto('/#player/film-rateselect');await expectMediaFrame(page);
 const track=page.locator('.art-control-progress-inner'),height=()=>track.evaluate(el=>el.getBoundingClientRect().height);
 const nativeHeight=await track.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--art-progress-height')));
 await expect.poll(height).toBe(nativeHeight/2);await track.hover();await expect.poll(height).toBe(nativeHeight);
 const panel=page.locator('.fine-speed'),summary=panel.locator('summary');
 await summary.click();
 const ticks=await panel.locator('[data-rate]').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {top:rect.top,x:rect.left+rect.width/2,rate:Number(node.dataset.rate)};}));
 expect(ticks.length).toBe(7);
 for(const tick of ticks){
  expect(Math.abs(tick.top-ticks[0].top)).toBeLessThan(1);
  const fraction=(tick.rate-ticks[0].rate)/(ticks.at(-1).rate-ticks[0].rate);
  expect(Math.abs(tick.x-(ticks[0].x+fraction*(ticks.at(-1).x-ticks[0].x)))).toBeLessThan(2);
 }
 await panel.locator('[data-rate="1.75"]').click();
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);
 await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',1.75);
 await expect(summary).toHaveText('1.75×');await expect(panel.locator('[data-rate="1.75"]')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe('1.75');
 await summary.focus();await page.keyboard.press('Escape');await expect(panel).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
 await page.keyboard.press('Enter');await expect(panel).toHaveAttribute('open','');
 await page.keyboard.press('Tab');await expect(panel.locator('[data-step="-0.05"]')).toBeFocused();await expect(panel).toHaveAttribute('open','');
 await page.keyboard.press('Shift+Tab');await expect(summary).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(panel).not.toHaveAttribute('open','');
 await page.locator('video').evaluate(video=>video.play());
 const actual=await page.locator('video').evaluate(async video=>{
  let waits=0;const waiting=()=>waits++;video.addEventListener('waiting',waiting);const start=video.currentTime,t=performance.now();
  await new Promise(resolve=>setTimeout(resolve,10000));video.removeEventListener('waiting',waiting);video.pause();
  return {ratio:(video.currentTime-start)/((performance.now()-t)/1000),rate:video.playbackRate,defaultRate:video.defaultPlaybackRate,muted:video.muted,waits};
 });
 expect(actual.waits).toBe(0);expect(actual.ratio).toBeGreaterThan(1.65);expect(actual.ratio).toBeLessThan(1.85);
 expect(actual.rate).toBe(1.75);expect(actual.defaultRate).toBe(1.75);expect(actual.muted).toBe(true);
 console.log(JSON.stringify({path:'pointer-selected-real-speed',...actual}));
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.locator('#watch-player').hover();
  const overflow=await page.locator('#watch-player').evaluate(host=>{
   const bounds=host.getBoundingClientRect();
   return [...host.querySelectorAll('.art-controls .art-control')].filter(el=>el.getClientRects().length).some(el=>{const r=el.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;});
  });
  expect(overflow).toBe(false);
 }
});

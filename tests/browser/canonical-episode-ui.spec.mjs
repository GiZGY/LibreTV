import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress} from './media-assertions.mjs';
async function seed(page,{mixed=false,complete=false,last=false,noLines=false}={}){
 await page.addInitScript(options=>{
  const {mixed,complete,last,noLines}=options,p='openstream_live_',id='film-canonical';
  const labels=mixed?['S01E01','S02E01','S02E02','S02E03预告']:['第1集预告','第1集','第2集','番外'];
  const lines=[{key:'qa',sourceKey:'qa',name:'测试线路',health:'fast',episodes:labels.map((name,index)=>({name,url:'/media/sample.mp4?episode='+encodeURIComponent(name)+'&index='+index}))}];
  Object.defineProperty(window,'LiveData',{configurable:true,get(){return this.__canonicalData;},set(value){value.firstDetail=async()=>{window.__canonicalResolves=(window.__canonicalResolves||0)+1;await new Promise(resolve=>setTimeout(resolve,150));return{item:{vod_remarks:'测试剧集'},lines:structuredClone(lines)};};value.lookupTMDB=async()=>null;this.__canonicalData=value;}});
  if(!localStorage.getItem('canonical-ui-fixture')){
   const film={id,name:mixed?'混合季号测试':'季号测试第二季',type:'电视剧',episodes:4,seasons:1,year:2024,genre:'剧情',rating:8,description:'测试资料',candidatesComplete:true,candidates:[{source_code:'qa',vod_id:1}],linesCheckedAt:Date.now(),...(!noLines?{lines}:{})};
   localStorage.setItem(p+'filmRecords',JSON.stringify([film]));localStorage.setItem(p+'favorites',JSON.stringify([id]));localStorage.setItem(p+'history',JSON.stringify([id]));
   localStorage.setItem(p+'historyMetadataV2',JSON.stringify({[id]:{episode:mixed?(last?3:2):2,season:2,episodeKey:last?'s2:e2':'s2:e1',position:complete?60:18,duration:60,totalEpisodes:4,completed:complete,watchedAt:new Date().toISOString()}}));localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','true');localStorage.setItem('canonical-ui-fixture','true');
  }
  localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');
 },{mixed,complete,last,noLines});
}
async function current(page,key){await expect.poll(()=>page.evaluate(()=>LivePlayback.current()?.episodeKey)).toBe(key);await expectMediaFrame(page);if(!(await page.locator('video').evaluate(v=>v.paused)))await expectPlaybackProgress(page,{episodeKey:key});await expect(page.locator('video')).toHaveJSProperty('muted',true);}
test('mixed seasons use real season and episode labels across history, home, watchlist and the picker',async({page})=>{
 await seed(page,{mixed:true});await page.goto('/#history');await expect(page.locator('.history-item')).toContainText('第 2 季 · 第 1 集');await expect(page.locator('.history-item')).not.toContainText('第 2 季 · 第 2 集');
 await page.goto('/#home');await expect(page.locator('.continue-notice')).toContainText('第 2 季 · 第 1 集');await page.goto('/#library');await expect(page.locator('.watchlist-detail')).toContainText('第 2 季 · 第 1 集 · 看到 0:18');
 await page.locator('[data-action="resume-history"]').click();await current(page,'s2:e1');await expect(page.locator('.episodes .active')).toHaveText('1');await expect(page.locator('.season-tabs [aria-pressed="true"]')).toHaveText('第 2 季');expect(await page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(17.9);
 await page.locator('[data-action="season"][data-value="1"]').click();await current(page,'s1:e1');await expect(page.locator('.episodes .episode')).toHaveCount(1);await expect(page.locator('.episodes .active')).toHaveText('1');
 await page.locator('[data-action="season"][data-value="2"]').click();await current(page,'s2:e1');await expect(page.locator('.episodes .episode')).toHaveCount(2);await expect(page.locator('.episodes .active')).toHaveText('1');await page.locator('.watch-next [data-action="episode"]').last().click();await current(page,'s2:e2');await expect(page.locator('.episodes .active')).toHaveText('2');await expect(page.locator('.watch-next [data-action="episode"]').last()).toBeDisabled();
});
test('completed home continuation resolves a key before choosing next and consumes the intent once',async({page})=>{
 await seed(page,{noLines:true,complete:true});await page.goto('/#home');await expect(page.locator('.continue-notice')).toContainText('第 2 季 · 第 1 集');await expect(page.locator('[data-playback-intent="next"]')).toHaveCount(1);await expect(page.locator('[data-new-episode]')).toHaveCount(0);
 await page.locator('[data-playback-intent="next"]').click();await current(page,'s2:e2');await expect(page.locator('video')).toHaveJSProperty('paused',false);expect(await page.locator('video').evaluate(v=>decodeURIComponent(v.currentSrc))).toContain('第2集');expect(await page.evaluate(()=>window.__canonicalResolves)).toBe(1);
 await page.locator('video').evaluate(v=>v.pause());await page.reload();await current(page,'s2:e2');expect(await page.locator('video').evaluate(v=>decodeURIComponent(v.currentSrc))).toContain('第2集');
});
test('completed cached last episode returns to the resolved picker rather than entering a preview',async({page})=>{
 await seed(page,{noLines:true,complete:true,last:true});await page.goto('/#home');await page.locator('[data-playback-intent="next"]').click();await expect(page).toHaveURL(/#detail\/film-canonical$/);await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('[data-action="season"]').first()).toHaveText('第 2 季');await expect(page.locator('.episodes .episode')).toHaveCount(3);
});

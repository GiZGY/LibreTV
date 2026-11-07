import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';
async function open(page,{sparse=false,skip=false,mode='mp4'}={}){
 await page.addInitScript(({sparse,skip,mode})=>{
  const p='openstream_live_',names=Array.from({length:8},(_,i)=>i+1),line=(n,episodes)=>({key:'qa:'+n,sourceKey:'qa',name:'测试线路 '+n,health:'fast',episodes:episodes.map(number=>({name:'第'+number+'集',url:'/media/sample.'+(mode==='hls'?'m3u8':'mp4')+'?line='+n+'&ep='+number}))});
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-qa1',name:'播放器体验测试',type:'电视剧',episodes:8,seasons:1,year:2024,genre:'剧情',rating:8,lines:[line(1,names),line(2,sparse?[3,1]:names)],candidatesComplete:true,cover:''}]));localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','true');if(skip)localStorage.setItem(p+'skip_film-qa1',JSON.stringify({intro:2,outro:5}));
  localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');
 },{sparse,skip,mode});
 await page.goto('/#player/film-qa1');await expectMediaFrame(page);await expect(page.locator('.art-controls .player-bottom-trigger')).toHaveCount(2);await expect(page.locator('.player-tool-actions')).toHaveCount(0);await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
async function panel(page,name){await page.locator(`.player-bottom-trigger[data-player-panel="${name}"]`).click();await expect(page.locator(`[data-player-view="${name}"]`)).toBeVisible();}
async function settings(page,section){
 const player=page.locator('#watch-player .art-video-player');
 if(!(await player.getAttribute('class')).includes('art-setting-show'))await page.locator('.art-control-setting').click();
 const back=page.locator('.art-setting-panel.art-current .art-setting-item-back');
 while(await back.count())await back.click();
 await expect(page.locator('.art-setting-panel.art-current [data-name="skip-intro"]')).toBeVisible();
 if(section){await page.locator(`.art-setting-panel.art-current [data-name="${section}"]`).click();await expect(back).toBeVisible();}
}
async function closeSettings(page){await page.locator('.art-control-setting').click();await expect(page.locator('#watch-player .art-video-player')).not.toHaveClass(/art-setting-show/);}
async function episode(page,n){await expect(page.locator('.episodes .active')).toHaveText(String(n));await expectPlaybackProgress(page,{episode:n});}
test('fullscreen and inline routes share health order without changing original source identity',async({page})=>{
 await open(page);
 await page.locator('.art-control-fullscreen').click();
 await page.evaluate(()=>{for(const [lineKey,health] of [['qa:1','slow'],['qa:2','fast']])document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:'film-qa1',lineKey,health}}));});
 const inline=await page.locator('[data-live-line]').evaluateAll(items=>items.map(b=>b.dataset.liveLine));
 expect(inline).toEqual(['1','0']);await panel(page,'lines');
 expect(await page.locator('[data-player-line]').evaluateAll(items=>items.map(b=>b.dataset.playerLine))).toEqual(inline);
 await page.locator('[data-player-line]').first().click();
 await expect.poll(()=>page.evaluate(()=>window.LivePlayback.current()?.lineKey)).toBe('qa:2');
 await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);
 expect(await page.evaluate(()=>document.fullscreenElement?.id)).toBe('watch-player');
});
test('native fullscreen episode and route panels retain identity, speed, mute and keyboard focus',async({page})=>{
 await open(page,{sparse:true});await page.locator('.art-control-fullscreen').click();await panel(page,'episodes');await page.locator('[data-player-episode="3"]').click();await episode(page,3);expect(await page.evaluate(()=>document.fullscreenElement?.id)).toBe('watch-player');await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);await expect(page.locator('video')).toHaveJSProperty('muted',true);
 await panel(page,'lines');await page.locator('[data-player-line="1"]').click();await episode(page,3);expect(await page.locator('video').evaluate(v=>v.currentSrc)).toContain('ep=3');expect(await page.evaluate(()=>document.fullscreenElement?.id)).toBe('watch-player');
 await panel(page,'lines');await page.locator('[data-player-line="0"]').click();await panel(page,'episodes');await page.locator('[data-player-episode="2"]').click();await episode(page,2);await panel(page,'lines');await expect(page.locator('[data-player-line="1"]')).toBeDisabled();await expect(page.locator('[data-player-line="1"]')).toHaveAccessibleName(/缺少当前集/);await page.locator('[data-player-view="lines"]').press('Escape');await expect(page.locator('.player-bottom-trigger[data-player-panel="lines"]')).toBeFocused();
});
test('first-level skip controls keep exact seconds, independent toggles, markers and keyboard access',async({page})=>{
 await open(page);const v=page.locator('video');await v.evaluate(v=>{v.pause();v.currentTime=4;});await expect(v).toHaveJSProperty('seeking',false);await settings(page);
 const marker=page.locator('[data-skip-mark="intro"]'),seconds=page.locator('[data-skip-seconds="intro"]'),enabled=page.locator('[data-skip-enabled="intro"]');
 await expect(page.locator('.art-settings .art-setting-item-left-icon:visible')).toHaveCount(0);await expect(page.locator('[data-name="episode-skip"]')).toHaveCount(0);
 for(const key of ['intro','outro']){
  const row=page.locator(`[data-name="skip-${key}"]`);
  await expect(row.locator('[data-skip-mark]')).toHaveAccessibleName(key==='intro'?'当前位置记为片头结束':'当前位置记为片尾开始');
  await expect(row.locator('input[type=range]')).toHaveCount(0);await expect(row.locator('input[type=number]')).toBeVisible();await expect(row.locator('[data-skip-enabled]')).toBeVisible();
 }
 await v.evaluate(v=>{window.__markerSeeks=0;v.addEventListener('seeking',()=>window.__markerSeeks++);});
 await marker.focus();await page.keyboard.press('Enter');await expect(seconds).toHaveValue('4');await expect(enabled).toHaveAttribute('aria-checked','true');
 await seconds.fill('17');await seconds.press('Enter');await expect(seconds).toHaveValue('17');
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_skip_film-qa1')));
 expect(await saved()).toEqual({intro:17,outro:0});await enabled.click();await expect(enabled).toHaveAttribute('aria-checked','false');await expect(seconds).toHaveValue('17');expect(await saved()).toEqual({intro:17,outro:0});
 await enabled.focus();await page.keyboard.press('Space');await expect(enabled).toHaveAttribute('aria-checked','true');await expect(seconds).toHaveValue('17');
 await expect(v).toHaveJSProperty('currentTime',4);await expect(v).toHaveJSProperty('paused',true);expect(await page.evaluate(()=>window.__markerSeeks)).toBe(0);
 await page.keyboard.press('Escape');await expect(page.locator('.art-control-setting')).toBeFocused();await expect(page.locator('#watch-player .art-video-player')).not.toHaveClass(/art-setting-show/);
 await page.keyboard.press('Enter');await expect(seconds).toBeVisible();await expect(seconds).toHaveValue('17');
});
test('ratio is inline, custom sleep accepts minutes, submenus visibly go back and reopen at root',async({page})=>{
 await open(page);await settings(page);
 const gear=page.locator('.art-control-setting'),ratio=v=>page.locator(`button[data-aspect-ratio="${v}"]`);
 for(const val of ['4:3','16:9']){await ratio(val).click();await expect(ratio(val)).toHaveAttribute('aria-pressed','true');await expect(ratio(val==='4:3'?'16:9':'4:3')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>Artplayer.instances[0].aspectRatio)).toBe(val);await expect(page.locator('[data-skip-seconds="intro"]')).toBeVisible();}
 await settings(page,'sleep-timer');const back=()=>page.locator('.art-setting-panel.art-current [data-settings-back]');await expect(back()).toBeVisible();await expect(back()).toHaveAccessibleName('返回上一级');
 const minutes=page.locator('[data-sleep-custom]'),start=page.locator('[data-sleep-start]');await minutes.fill('7');await start.click();const left=await page.evaluate(()=>OpenStreamPlayerTools.sleep.snapshot().remaining);expect(left).toBeGreaterThan(410000);expect(left).toBeLessThanOrEqual(420000);
 await expect(page.locator('.player-sleep-pill')).toBeVisible();await page.locator('[data-sleep-extend]').click();expect(await page.evaluate(()=>OpenStreamPlayerTools.sleep.snapshot().remaining)).toBeGreaterThan(1310000);await page.locator('[data-sleep-cancel]').click();await expect(page.locator('.player-sleep-pill')).toBeHidden();
 await back().focus();await page.keyboard.press('Enter');await expect(ratio('4:3')).toBeVisible();
 await page.locator('[data-name="local-subtitle"]').click();await expect(back()).toBeVisible();
 await page.locator('.routes-heading').click();await expect(page.locator('#watch-player .art-video-player')).not.toHaveClass(/art-setting-show/);await gear.click();await expect(ratio('16:9')).toBeVisible();await expect(page.locator('[data-skip-seconds="outro"]')).toBeVisible();
 await ratio('4:3').click();await closeSettings(page);await page.locator('.player-next-episode').click();await episode(page,2);await settings(page);await expect(ratio('4:3')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>Artplayer.instances[0].aspectRatio)).toBe('4:3');
});
test('a disabled intro retains its seconds but cannot suppress an independently enabled outro',async({page})=>{
 await open(page);await settings(page);
 for(const [which,value] of [['intro','58'],['outro','5']]){const input=page.locator(`[data-skip-seconds="${which}"]`);await input.fill(value);await input.press('Enter');}
 await page.locator('[data-skip-enabled="intro"]').click();await expect(page.locator('[data-skip-enabled="outro"]')).toHaveAttribute('aria-checked','true');await closeSettings(page);
 await page.locator('video').evaluate(async v=>{v.currentTime=55.4;await v.play();});
 await expect.poll(()=>page.evaluate(()=>({ep:LivePlayback.current()?.episode,trigger:OpenStreamPlayback.diagnostic().current?.trigger})),{timeout:8000}).toEqual({ep:2,trigger:'outro'});
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_skip_film-qa1')))).toEqual({intro:58,outro:5});
});
test('outside dismissal never reopens a stale settings subpage',async({page})=>{
 await open(page);await settings(page,'local-subtitle');await expect(page.locator('.art-setting-panel.art-current [data-name="subtitle-file"]')).toBeVisible();
 await page.locator('.routes-heading').click();
 await expect(page.locator('#watch-player .art-video-player')).not.toHaveClass(/art-setting-show/);
 await page.locator('.art-control-setting').click();
 await expect(page.locator('.art-setting-panel.art-current [data-name="skip-intro"]')).toBeVisible();
});
test('one-click skip marks apply next episode and per-episode outro override survives retry only for that episode',async({page})=>{
 await open(page);await page.locator('video').evaluate(v=>{v.currentTime=4;});await settings(page);await page.locator('[data-skip-mark="intro"]').click();await page.locator('video').evaluate(v=>{v.currentTime=55;});await page.locator('[data-skip-mark="outro"]').click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_skip_film-qa1')))).toEqual({intro:4,outro:5});await closeSettings(page);await page.locator('.player-next-episode').click();await episode(page,2);expect(await page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(3.9);
 await settings(page);await page.locator('[data-skip-enabled="outro"]').click();await closeSettings(page);await page.locator('video').evaluate(v=>{v.currentTime=56;v.play();});await page.waitForTimeout(700);await episode(page,2);await page.locator('video').evaluate(v=>v.pause());await page.evaluate(()=>LivePlayback.retry(LivePlayback.current()));await episode(page,2);await settings(page);await expect(page.locator('[data-skip-enabled="outro"]')).toHaveAttribute('aria-checked','false');await closeSettings(page);await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.3;v.play();});await episode(page,3);await settings(page);await expect(page.locator('[data-skip-enabled="outro"]')).toHaveAttribute('aria-checked','true');await settings(page);await expect(page.locator('[data-skip-seconds="intro"]')).toHaveValue('4');
});
test('stop at end retains the outro and prevents autoplay or recovery from restarting playback',async({page})=>{
 await open(page,{skip:true});await settings(page,'sleep-timer');await page.locator('[data-sleep-end]').click();await closeSettings(page);await page.locator('video').evaluate(v=>{v.currentTime=56;v.play();});await page.waitForTimeout(700);await episode(page,1);await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.3;v.play();});await expect(page.locator('video')).toHaveJSProperty('ended',true);await expect(page.locator('.player-sleep-pill')).toHaveText('定时已结束，播放已停止');await expect(page.locator('video')).toHaveJSProperty('paused',true);expect(await page.evaluate(()=>LivePlayback.current().episode)).toBe(1);await page.evaluate(()=>{LivePlayback.failed(LivePlayback.current());document.querySelector('video').play().catch(()=>{});});await expect(page.locator('video')).toHaveJSProperty('paused',true);expect(await page.evaluate(()=>LivePlayback.current().episode)).toBe(1);await settings(page,'sleep-timer');await page.locator('[data-sleep-resume]').click();expect(await page.evaluate(()=>OpenStreamPlayerTools.sleep.blocked())).toBe(false);
});
test('local subtitles are text-only, adjustable, reject malformed files and clear on next episode',async({page})=>{
 await open(page);await settings(page,'local-subtitle');await page.locator('[data-subtitle-file]').setInputFiles({name:'本集.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n第一行\n\n2\n00:00:03,000 --> 00:00:06,000\n第二行<img src=x onerror="window.__subtitleExecuted=true">')});await expect(page.locator('[data-subtitle-summary]')).toHaveText('本集.srt');await page.locator('video').evaluate(v=>{v.currentTime=4;});await expect(page.locator('.player-local-subtitle')).toHaveText('第二行');await page.locator('[data-subtitle-size]').fill('32');await page.locator('[data-subtitle-size]').press('Enter');await expect(page.locator('.player-local-subtitle')).toHaveCSS('font-size','32px');await page.locator('[data-subtitle-offset]').fill('+2');await page.locator('[data-subtitle-offset]').press('Enter');await expect(page.locator('.player-local-subtitle')).toHaveText('第一行');expect(await page.evaluate(()=>window.__subtitleExecuted)).toBeUndefined();await page.locator('[data-subtitle-file]').setInputFiles({name:'损坏.vtt',mimeType:'text/plain',buffer:Buffer.from('not a caption')});await expect(page.locator('[data-player-message]')).toContainText('没有识别到字幕');await expect(page.locator('[data-subtitle-summary]')).toHaveText('本集.srt');await closeSettings(page);await page.locator('.player-next-episode').click();await episode(page,2);await expect(page.locator('.player-local-subtitle')).toHaveText('');await settings(page,'local-subtitle');await expect(page.locator('[data-subtitle-summary]')).toHaveText('尚未选择字幕');
});
test('bounded source failure stops with retry and a later manual retry recovers real playback',async({page})=>{
 await open(page);await page.evaluate(()=>{window.__qaSwitches=0;document.addEventListener('playback-ready',()=>window.__qaSwitches++);});let requests=0;await page.route('**/media/sample.mp4?**',route=>{requests++;return route.abort('failed');});await page.locator('video').evaluate(v=>v.load());await expect(page.locator('.player-inline-status')).toContainText('播放暂未恢复',{timeout:15000});expect(await page.evaluate(()=>window.__qaSwitches)).toBe(0);const stoppedRequests=requests;await page.waitForTimeout(1500);expect(requests).toBe(stoppedRequests);await page.unroute('**/media/sample.mp4?**');await page.locator('[data-player-retry]').click();await expectMediaFrame(page);await expect(page.locator('video')).toHaveJSProperty('muted',true);await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);await sampleRealPlayback(page,{episode:1});
});
test.describe('touchscreen player',()=>{
 test.use({hasTouch:true,isMobile:true});
test('narrow touch layout keeps panels scrollable, touch targets usable and reduced motion still interactive',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});await open(page,{skip:true});await settings(page,'local-subtitle');const panelBox=await page.locator('.art-settings').boundingBox();expect(panelBox.x).toBeGreaterThanOrEqual(0);expect(panelBox.x+panelBox.width).toBeLessThanOrEqual(390);expect(panelBox.y).toBeGreaterThanOrEqual(0);expect(panelBox.y+panelBox.height).toBeLessThanOrEqual(844);await expect(page.locator('[data-player-view="options"]')).toHaveCount(0);await expect(page.locator('.player-mobile-sheet[open]')).toHaveCount(0);await page.locator('[data-name="subtitle-file"]').scrollIntoViewIfNeeded();const buttonBox=await page.locator('[data-name="subtitle-file"]').boundingBox();expect(buttonBox.height).toBeGreaterThanOrEqual(44);await closeSettings(page);await panel(page,'episodes');await page.locator('[data-player-episode="3"]').click();await episode(page,3);
});
});

test('real HLS non-progress performs one bounded recovery then changes to a working source',async({page})=>{
 const pending=[];
 await page.route('**/media/sample.m3u8?**',async route=>{const response=await route.fetch(),original=await response.text(),first=new URL(route.request().url()).searchParams.get('line')==='1';await route.fulfill({response,body:first?original.replace(/(sample\d+\.ts)/g,'$1?stalled=1'):original});});
 await page.route('**/media/sample*.ts?stalled=1',async route=>{const n=Number(route.request().url().match(/sample(\d+)\.ts/)[1]);if(n>=2){pending.push(route);return;}await route.continue();});
 try{
  await open(page,{mode:'hls'});await page.locator('video').evaluate(v=>v.play());await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime),{timeout:8000}).toBeGreaterThan(1);
  await expect.poll(()=>page.evaluate(()=>LivePlayback.current()?.lineKey),{timeout:55000,intervals:[1000]}).toBe('qa:2');await expectMediaFrame(page);
  const diagnostic=await page.evaluate(()=>OpenStreamPlayback.diagnostic());expect(diagnostic.recent.some(session=>session.recoveryCount>=1)).toBe(true);
  await sampleRealPlayback(page,{episode:1,lineKey:'qa:2'});
 }finally{for(const route of pending)await route.abort().catch(()=>{});}
});

test('manual, ended and outro transitions retain play intent through intro seeks without test-triggered playback',async({page})=>{
 await open(page,{skip:true});await page.locator('.player-next-episode').click();await episode(page,2);await expect(page.locator('video')).toHaveJSProperty('paused',false);
 await settings(page);await page.locator('[data-skip-enabled="outro"]').click();await closeSettings(page);await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.3;});await episode(page,3);await expect(page.locator('video')).toHaveJSProperty('paused',false);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-4.8;});await episode(page,4);await expect(page.locator('video')).toHaveJSProperty('paused',false);await expect(page.locator('video')).toHaveJSProperty('seeking',false);
 await sampleRealPlayback(page,{episode:4});
});

test('canonical season display and legacy resume stay correct, and autoplay never enters special material',async({page})=>{
 await page.addInitScript(()=>{const p='openstream_live_',episodes=[['第1集预告','preview'],['第1集','1'],['第2集','2'],['番外','special']].map(([name,ep])=>({name,url:'/media/sample.mp4?ep='+ep}));localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-season',name:'季度测试第二季',type:'电视剧',episodes:4,lines:[{key:'qa',sourceKey:'qa',name:'测试线路',health:'fast',episodes}],candidatesComplete:true}]));localStorage.setItem(p+'history',JSON.stringify(['film-season']));localStorage.setItem(p+'historyMetadataV2',JSON.stringify({'film-season':{episode:2,source:'qa',position:12,duration:60,watchedAt:new Date().toISOString()}}));localStorage.setItem(p+'autoplay','true');localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');});
 await page.goto('/#player/film-season');await expectMediaFrame(page);await expect(page.locator('[data-player-target]')).toHaveText('第 2 季 · 第 1 集');expect(await page.locator('video').evaluate(v=>v.currentSrc)).toContain('ep=1');expect(await page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(11.9);
 await page.locator('.player-next-episode').click();await expect(page.locator('[data-player-target]')).toHaveText('第 2 季 · 第 2 集');await expect(page.locator('.player-next-episode')).toBeDisabled();
 // Selection labels commit before the replacement media necessarily has metadata.
 await expectPlaybackProgress(page,{episode:2,episodeKey:'s2:e2',rate:1});expect(await page.locator('video').evaluate(v=>v.currentSrc)).toContain('ep=2');
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.3;});await expect(page.locator('video')).toHaveJSProperty('ended',true);expect(await page.evaluate(()=>LivePlayback.current().episodeKey)).toBe('s2:e2');
 await panel(page,'episodes');await expect(page.locator('.player-episode-grid')).not.toContainText('预告');await page.locator('[data-player-episode="3"]').click();await expectMediaFrame(page);await expect(page.locator('[data-player-target]')).toHaveText('番外');
});

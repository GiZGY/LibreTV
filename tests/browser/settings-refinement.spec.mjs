import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress} from './media-assertions.mjs';

async function open(page){
 await page.addInitScript(()=>{
  const p='openstream_live_',episodes=Array.from({length:8},(_,i)=>({name:'第'+(i+1)+'集',url:'/media/sample.mp4?ep='+i}));
  localStorage.setItem(p+'filmRecords',JSON.stringify([{id:'film-settings',name:'设置回归',type:'电视剧',episodes:8,seasons:1,year:2024,genre:'剧情',rating:8,length:'60秒',description:'',director:'—',cast:'—',cover:'',candidatesComplete:true,lines:[{key:'settings:1',sourceKey:'settings',name:'测试线路',health:'fast',episodes}]}]));
  localStorage.setItem(p+'muted','true');localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','true');
 });
 await page.goto('/#player/film-settings');await expectMediaFrame(page);await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
const current=page=>page.locator('.art-setting-panel.art-current');
async function settings(page,section){
 if(!await page.locator('#watch-player .art-video-player').evaluate(n=>n.classList.contains('art-setting-show')))await page.locator('.art-control-setting').click();
 if(section)await current(page).locator(`[data-name="${section}"]`).click();
}
async function set(page,key,value){const input=page.locator(`[data-subtitle-${key}]`);await input.fill(value);await input.press('Enter');return input;}
async function subtitles(page){await page.locator('[data-subtitle-file]').setInputFiles({name:'本集"&.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n第一行\n\n2\n00:00:04,000 --> 00:00:08,000\n第二行\n\n3\n00:00:09,000 --> 00:00:12,000\n第三行')});await page.locator('video').evaluate(v=>{v.pause();v.currentTime=5;});await expect(page.locator('video')).toHaveJSProperty('seeking',false);await expect(page.locator('.player-local-subtitle')).toHaveText('第二行');}

test('default and explicit aspect ratios apply to the real video, persist across reload and survive episode remount',async({page})=>{
 await open(page);await settings(page);const ratio=value=>current(page).locator(`button[data-aspect-ratio="${value}"]`);
 await expect(current(page).locator('[data-name="local-subtitle"]')).toContainText('外挂字幕');
 await expect(ratio('default')).toHaveText('默认');await expect(ratio('default')).toHaveAttribute('aria-pressed','true');await expect(current(page).locator('button[data-aspect-ratio]')).toHaveCount(3);
 await page.locator('.art-settings').screenshot({path:test.info().outputPath('settings-root.png')});
 await ratio('4:3').click();expect(await page.evaluate(()=>Artplayer.instances[0].aspectRatio)).toBe('4:3');expect(await page.locator('video').evaluate(v=>Math.abs(v.clientWidth/v.clientHeight-4/3))).toBeLessThan(.01);
 await page.reload();await expectMediaFrame(page);await settings(page);await expect(ratio('4:3')).toHaveAttribute('aria-pressed','true');await page.locator('.art-control-setting').click();await page.locator('.player-next-episode').click();await expectPlaybackProgress(page,{episode:2});await settings(page);await expect(ratio('4:3')).toHaveAttribute('aria-pressed','true');
 await ratio('16:9').click();expect(await page.locator('video').evaluate(v=>Math.abs(v.clientWidth/v.clientHeight-16/9))).toBeLessThan(.01);await ratio('default').click();
 expect(await page.evaluate(()=>({ratio:Artplayer.instances[0].aspectRatio,saved:JSON.parse(localStorage.getItem('openstream_live_aspectRatio')),width:document.querySelector('video').style.width,height:document.querySelector('video').style.height}))).toEqual({ratio:'default',saved:'default',width:'',height:''});
 await page.reload();await expectMediaFrame(page);await settings(page);await expect(ratio('default')).toHaveAttribute('aria-pressed','true');await expect(current(page).locator('button[data-aspect-ratio][aria-pressed=true]')).toHaveCount(1);
});

test('real chevron buttons return to the actual parent with focus and do not leave stale subpages',async({page})=>{
 await open(page);await settings(page);
 for(const section of ['local-subtitle','sleep-timer']){await current(page).locator(`[data-name="${section}"]`).click();const back=current(page).locator('button[data-settings-back]');await expect(back).toHaveAccessibleName('返回上一级');await expect(back.locator('svg path')).toHaveCount(1);expect(await back.innerText()).not.toContain('←');await back.locator('svg').click();await expect(current(page).locator(`[data-name="${section}"]`)).toBeFocused();await expect(current(page).locator('[data-settings-back]')).toHaveCount(0);}
 await current(page).locator('[data-name="local-subtitle"]').click();await current(page).locator('[data-settings-back]').focus();await page.keyboard.press('Space');await expect(current(page).locator('[data-name="local-subtitle"]')).toBeFocused();
 await current(page).locator('[data-name="sleep-timer"]').click();await page.keyboard.press('Escape');await expect(page.locator('.art-control-setting')).toBeFocused();await page.keyboard.press('Enter');await expect(current(page).locator('button[data-aspect-ratio="default"]')).toBeVisible();
});

test('subtitle steppers edit actual font size and signed timing without sliders or unintended media seeks',async({page})=>{
 await open(page);await settings(page,'local-subtitle');await expect(current(page).locator('input[type=range]')).toHaveCount(0);await subtitles(page);
 await set(page,'size','31');await expect(page.locator('.player-local-subtitle')).toHaveCSS('font-size','31px');await page.locator('[data-subtitle-step=size][data-delta="1"]').click();await expect(page.locator('[data-subtitle-size]')).toHaveValue('32');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_subtitleSize')))).toBe(32);
 const offset=await set(page,'offset','+3');await expect(offset).toHaveValue('+3');await expect(offset).toHaveAttribute('aria-valuenow','3');await expect(page.locator('.player-local-subtitle')).toHaveText('第一行');await page.locator('[data-subtitle-step=offset][data-delta="-0.5"]').click();await expect(offset).toHaveValue('+2.5');
 await page.locator('.art-settings').screenshot({path:test.info().outputPath('settings-subtitle.png')});
 await set(page,'offset','-4');await expect(page.locator('.player-local-subtitle')).toHaveText('第三行');await offset.press('ArrowUp');await expect(offset).toHaveValue('-3.5');await offset.press('ArrowDown');await expect(offset).toHaveValue('-4');await set(page,'offset','−2.5');await expect(offset).toHaveValue('-2.5');await expect(page.locator('.player-local-subtitle')).toHaveText('第二行');
 await expect(page.locator('video')).toHaveJSProperty('currentTime',5);await expect(page.locator('video')).toHaveJSProperty('paused',true);await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);
});

test('invalid drafts keep committed settings, bounds disable steppers, and only global font size survives the next episode',async({page})=>{
 await open(page);await settings(page,'local-subtitle');await subtitles(page);await set(page,'size','32');await set(page,'offset','+3');
 const size=await set(page,'size','41');await expect(size).toHaveAttribute('aria-invalid','true');await expect(page.locator('.player-local-subtitle')).toHaveCSS('font-size','32px');const offset=await set(page,'offset','2.25');await expect(offset).toHaveAttribute('aria-invalid','true');await expect(page.locator('.player-local-subtitle')).toHaveText('第一行');
 await page.evaluate(()=>OpenStreamPlayerTools.sleep.setMinutes(1));await page.waitForTimeout(1100);await expect(size).toHaveValue('41');await expect(offset).toHaveValue('2.25');await page.evaluate(()=>OpenStreamPlayerTools.sleep.cancel());
 await set(page,'size','32');await size.press('Home');await expect(size).toHaveValue('16');await expect(page.locator('[data-subtitle-step=size][data-delta="-1"]')).toBeDisabled();await size.press('End');await expect(size).toHaveValue('40');await expect(page.locator('[data-subtitle-step=size][data-delta="1"]')).toBeDisabled();await set(page,'size','32');
 await set(page,'offset','-120');await expect(page.locator('[data-subtitle-step=offset][data-delta="-0.5"]')).toBeDisabled();await set(page,'offset','+120');await expect(page.locator('[data-subtitle-step=offset][data-delta="0.5"]')).toBeDisabled();
 await page.locator('.art-control-setting').click();await page.locator('.player-next-episode').click();await expectPlaybackProgress(page,{episode:2});await settings(page,'local-subtitle');await expect(page.locator('[data-subtitle-size]')).toHaveValue('32');await expect(page.locator('[data-subtitle-offset]')).toHaveValue('0');await expect(page.locator('[data-subtitle-summary]')).toHaveText('尚未选择字幕');await expect(page.locator('.player-local-subtitle')).toHaveText('');
 await page.reload();await expectMediaFrame(page);await settings(page,'local-subtitle');await expect(page.locator('[data-subtitle-size]')).toHaveValue('32');
});

for(const mode of ['native','web'])test(mode+' fullscreen supports editable subtitle settings, chevron return and aspect inheritance',async({page})=>{
 await open(page);await page.locator(mode==='native'?'.art-control-fullscreen':'.art-control-fullscreenWeb').click();const fullscreen=()=>page.evaluate(mode=>mode==='native'?document.fullscreenElement?.id==='watch-player':Artplayer.instances[0].fullscreenWeb,mode);await expect.poll(fullscreen).toBe(true);
 await settings(page,'local-subtitle');await subtitles(page);await set(page,'offset','+3');await expect(page.locator('.player-local-subtitle')).toHaveText('第一行');await set(page,'size','30');await expect(page.locator('.player-local-subtitle')).toHaveCSS('font-size','30px');await current(page).locator('button[data-settings-back]').click();await expect(current(page).locator('[data-name="local-subtitle"]')).toBeFocused();
 await current(page).locator('button[data-aspect-ratio="4:3"]').click();await page.locator('.art-control-setting').click();await page.locator('.player-next-episode').click();await expectPlaybackProgress(page,{episode:2});expect(await fullscreen()).toBe(true);expect(await page.evaluate(()=>Artplayer.instances[0].aspectRatio)).toBe('4:3');
});

for(const width of [320,390])test('touch '+width+' settings retain compact bounds, real chevron and 44px editable stepper targets',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 try{await open(page);await settings(page,'local-subtitle');const inputs=page.locator('[data-subtitle-size],[data-subtitle-offset]');for(const input of await inputs.all()){await input.scrollIntoViewIfNeeded();expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);}await set(page,'offset','-1.5');await page.locator('[data-subtitle-step=offset][data-delta="0.5"]').tap();await expect(page.locator('[data-subtitle-offset]')).toHaveValue('-1');
  for(const button of await current(page).locator('[data-subtitle-step]').all()){await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}const panel=await page.locator('.art-settings').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);expect(await current(page).evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  const back=current(page).locator('button[data-settings-back]');await back.scrollIntoViewIfNeeded();const b=await back.boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);await back.tap();await expect(current(page).locator('[data-name="local-subtitle"]')).toBeFocused();await current(page).locator('button[data-aspect-ratio="default"]').scrollIntoViewIfNeeded();await expect(current(page).locator('button[data-aspect-ratio="default"]')).toHaveAttribute('aria-pressed','true');
 }finally{await context.close();}
});

test('series ratio notice fits the free space between control groups, without covering the controls or title',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await open(page);await settings(page);
 const ratio=value=>current(page).locator('[data-aspect-ratio="'+value+'"]');
 for(const value of ['4:3','16:9','default']){
   await ratio(value).click();const notice=page.locator('#watch-player .art-notice-inner');
   await expect(notice).toBeVisible();await expect(ratio(value)).toHaveAttribute('aria-pressed','true');
   const [n,left,right,bar]=await Promise.all([notice,...['.art-controls-left','.art-controls-right','.art-controls'].map(s=>page.locator('#watch-player '+s))].map(l=>l.boundingBox()));
   expect(n.x).toBeGreaterThanOrEqual(left.x+left.width-1);expect(n.x+n.width).toBeLessThanOrEqual(right.x+1);
   expect(n.y).toBeGreaterThanOrEqual(bar.y);expect(n.y+n.height).toBeLessThanOrEqual(bar.y+bar.height+1);
 }
});

for(const width of [1440,390])test('expanded synopsis uses natural height and its own collapse row at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>{const film={id:'film-plot',type:'电影',name:'简介测试',description:'在城市的另一端，新的旅程开始了。'.repeat(48)+'结尾可见。',director:'导演甲',cast:'主演乙',episodes:1,candidatesComplete:true,lines:[{key:'qa',sourceKey:'qa',name:'线路',episodes:[{name:'正片',url:'/media/sample.mp4'}]}]};localStorage.setItem('openstream_live_filmRecords',JSON.stringify([film]));localStorage.setItem('openstream_live_muted','true');});
 await page.goto('/#player/film-plot');const plot=page.locator('.watch-plot'),preview=page.locator('.plot-preview'),toggle=plot.locator('summary');
 await expect(preview).toBeVisible();expect(await plot.evaluate(e=>e.open)).toBe(false);const screen=page.locator('.watch-screen'),before=await screen.boundingBox();await toggle.click();await expect(preview).toBeHidden();const body=plot.locator('p');await expect(body).toContainText('结尾可见');
 expect(await body.evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);
 const [para,btn,credits]=await Promise.all([body,toggle,page.locator('.watch-credits')].map(e=>e.boundingBox()));expect(para.height).toBeGreaterThan(200);expect(btn.y).toBeGreaterThanOrEqual(para.y+para.height-1);expect(credits.y).toBeGreaterThanOrEqual(btn.y+btn.height-1);
 expect(await page.locator('.watch-aside').evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);const after=await screen.boundingBox();expect(after.height).toBe(before.height);await toggle.click();await expect(preview).toBeVisible();expect(await preview.evaluate(e=>e.clientHeight)).toBeLessThan(80);
});

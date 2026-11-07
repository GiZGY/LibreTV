import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';

async function open(page,{theme='dark',series=true}={}){
 await page.addInitScript(({theme,series})=>{
  const p='openstream_live_',film={id:'film-coarse',name:'等风停下的时候，我们一起走过漫长的星河',type:series?'电视剧':'电影',episodes:series?8:1,seasons:1,year:2025,genre:'剧情',rating:8,length:'每集45分钟',description:'长街熄灯以后，一封迟到的信让旧日的故事再次展开。人们在相遇与告别之间，寻找属于自己的方向。',director:'林远',cast:'陈予 / 许宁',lines:[1,2].map(n=>({key:'qa:'+n,sourceKey:'qa',name:'线路 '+n,health:'fast',episodes:Array.from({length:series?8:1},(_,i)=>({name:series?'第'+(i+1)+'集':'正片',url:'/media/sample.mp4?line='+n+'&ep='+(i+1)}))})),candidatesComplete:true};
  localStorage.setItem(p+'filmRecords',JSON.stringify([film]));localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','false');localStorage.setItem(p+'volume','0');localStorage.setItem(p+'muted','true');localStorage.setItem(p+'mobileAutoTheme','false');localStorage.setItem(p+'darkMode',JSON.stringify(theme==='dark'));
  localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');
 },{theme,series});
 await page.goto('/#player/film-coarse');await expectMediaFrame(page);await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
async function geometry(page){return page.locator('#watch-player').evaluate(host=>{
 const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
 const controls=[...host.querySelectorAll('.art-controls .art-control')].filter(n=>n.getClientRects().length&&getComputedStyle(n).display!=='none'&&!n.classList.contains('art-control-time'));
 return{coarse:matchMedia('(pointer:coarse)').matches,host:box(host),bar:box(host.querySelector('.art-controls')),controls:controls.map(n=>({name:n.className.split(' ').find(c=>c.startsWith('art-control-')),box:box(n),child:n.querySelector('button,summary')?box(n.querySelector('button,summary')):null})),time:box(host.querySelector('.art-control-time')),track:box(host.querySelector('.art-control-progress-inner')),video:box(host.querySelector('video')),objectFit:getComputedStyle(host.querySelector('video')).objectFit};
 });}
const box=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};});
function inside(inner,outer,label){expect(inner.x,label+' left').toBeGreaterThanOrEqual(outer.x-.5);expect(inner.y,label+' top').toBeGreaterThanOrEqual(outer.y-.5);expect(inner.right,label+' right').toBeLessThanOrEqual(outer.right+.5);expect(inner.bottom,label+' bottom').toBeLessThanOrEqual(outer.bottom+.5);}
function separate(a,b,label){expect(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=.5||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=.5,label).toBe(true);}
function targets(state,{rows=2}={}){
 expect(state.bar.h).toBe(rows*44);
 for(const control of state.controls){inside(control.box,state.host,control.name);expect(control.box.w,control.name+' outer width').toBeGreaterThanOrEqual(43.99);expect(control.box.h,control.name+' outer height').toBeGreaterThanOrEqual(43.99);if(control.child){expect(control.child.w,control.name+' button width').toBeGreaterThanOrEqual(43.99);expect(control.child.h,control.name+' button height').toBeGreaterThanOrEqual(43.99);inside(control.child,control.box,control.name+' child');}}
 const visual=[...state.controls].sort((a,b)=>Math.abs(a.box.y-b.box.y)>.5?a.box.y-b.box.y:a.box.x-b.box.x);expect(visual.map(c=>c.name)).toEqual(state.controls.map(c=>c.name));
 for(let i=0;i<state.controls.length;i++)for(let j=i+1;j<state.controls.length;j++)separate(state.controls[i].box,state.controls[j].box,'distinct control hit areas');
 if(rows>1){separate(state.time,state.track,'clock does not cover seek track');separate(state.time,state.bar,'clock does not cover controls');separate(state.track,state.bar,'track does not cover controls');}
}
async function visiblePopup(page,selector){
 const popup=page.locator(selector);await expect(popup).toBeVisible();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const host=await box(page.locator('#watch-player')),bounds=await box(popup);inside(bounds,host,selector);separate(bounds,(await geometry(page)).bar,selector+' does not cover controls');return bounds;
}
async function touchPanel(page,name){await page.locator(`.player-bottom-trigger[data-player-panel="${name}"]`).tap();const panel=page.locator(`[data-player-view="${name}"]`);await expect(panel).toBeVisible();const b=await box(panel);inside(b,{x:0,y:0,right:page.viewportSize().width,bottom:page.viewportSize().height},name+' sheet');return panel;}
async function gear(page){await page.locator('.art-control-setting').tap();await expect(page.locator('#watch-player .art-video-player')).toHaveClass(/art-setting-show/);await visiblePopup(page,'.art-settings');}
async function keyboardFocus(page,locator){await expect(locator).toBeFocused();expect(await locator.evaluate(el=>el.matches(':focus-visible'))).toBe(true);}

test.describe('coarse narrow player controls',()=>{
 test.use({hasTouch:true,isMobile:true});
 for(const width of [320,390])for(const theme of ['light','dark'])test('all entries remain touchable without overlap at '+width+'px '+theme,async({page},info)=>{
  const reduced=theme==='dark';await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference',colorScheme:theme});await open(page,{theme});
  let state=await geometry(page);expect(state.coarse).toBe(true);expect(state.host.w).toBe(width-32);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);targets(state);
  expect(state.objectFit).toBe('contain');expect(state.video.bottom).toBeLessThanOrEqual(state.bar.y+.5);expect(state.host.h).toBeGreaterThanOrEqual(260);expect(await page.locator('html').getAttribute('data-theme')).toBe(theme);
  const names=state.controls.map(c=>c.name);expect(names).toEqual(['art-control-playAndPause','art-control-next-episode','art-control-volume','art-control-episode-picker','art-control-route-picker','art-control-fine-speed','art-control-setting',...(names.includes('art-control-airplay')?['art-control-airplay']:[]),'art-control-fullscreen']);
  await page.mouse.move(1,1);await expect.poll(async()=>(await geometry(page)).track.h).toBe(3);
  await touchPanel(page,'episodes');expect(await page.evaluate(()=>!!document.activeElement.closest('[data-player-view=episodes]'))).toBe(true);await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('[data-player-view=episodes]')&&document.activeElement.matches(':focus-visible'))).toBe(true);await page.keyboard.press('Escape');await expect(page.locator('.player-bottom-trigger[data-player-panel="episodes"]')).toBeFocused();
  await touchPanel(page,'episodes');await page.locator('[data-player-episode="3"]').tap();await expectPlaybackProgress(page,{episode:3});
  await touchPanel(page,'lines');await page.locator('[data-player-line="1"]').tap();await expectPlaybackProgress(page,{episode:3,lineKey:'qa:2'});
  await page.locator('.player-next-episode').tap();await expectPlaybackProgress(page,{episode:4,lineKey:'qa:2'});await page.locator('video').evaluate(v=>v.pause());
  const speed=page.locator('.fine-speed'),summary=speed.locator('summary');await summary.tap();await expect.poll(()=>page.locator('.fine-speed-panel').evaluate(el=>!!el.style.maxHeight)).toBe(true);const speedBounds=await visiblePopup(page,'.fine-speed-panel');if(width===320&&theme==='dark')await page.locator('#watch-player').screenshot({path:info.outputPath('coarse-speed.png')});
  for(const step of [-.05,.05]){const control=speed.locator(`[data-step="${step}"]`);const b=await box(control);expect(b.w).toBe(44);expect(b.h).toBe(44);await control.tap();}
  await expect(page.locator('video')).toHaveJSProperty('playbackRate',1.75);await expect(summary).toHaveText('1.75×');await page.keyboard.press('Tab');await keyboardFocus(page,speed.locator('[data-step="-0.05"]'));await page.keyboard.press('Escape');await keyboardFocus(page,summary);
  await gear(page);if(width===320&&theme==='dark')await page.locator('#watch-player').screenshot({path:info.outputPath('coarse-gear.png')});await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('.art-settings'))).toBe(true);await page.keyboard.press('Escape');await keyboardFocus(page,page.locator('.art-control-setting'));
  await gear(page);await page.locator('[data-name="sleep-timer"]').tap();await page.locator('[data-sleep-custom]').fill('15');await page.locator('[data-sleep-start]').tap();await page.keyboard.press('Escape');await expect(page.locator('.player-sleep-pill')).toContainText('后停止');
  await page.locator('[data-subtitle-file]').setInputFiles({name:'两行.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:10,000\n山海之间再次相逢\n灯火照亮回家长路')});await page.locator('video').evaluate(v=>{v.pause();v.currentTime=4;});await expectMediaFrame(page);await expect(page.locator('.player-local-subtitle')).toHaveText('山海之间再次相逢\n灯火照亮回家长路');
  state=await geometry(page);const caption=await box(page.locator('.player-local-subtitle')),head=await box(page.locator('.player-tool-title')),pill=await box(page.locator('.player-sleep-pill'));inside(caption,state.host,'caption');for(const[name,b]of [['title',head],['clock',state.time],['track',state.track],['controls',state.bar],['timer',pill]])separate(caption,b,'caption and '+name);separate(pill,state.time,'timer and clock');separate(pill,state.bar,'timer and controls');
  await page.mouse.move(1,1);await expect(page.locator('.art-notice')).toBeHidden();await page.screenshot({path:info.outputPath('coarse-'+width+'-'+theme+'.png')});
  if(width===320&&theme==='dark'){await page.locator('.art-control-playAndPause').tap();const actual=await sampleRealPlayback(page,{episode:4,lineKey:'qa:2'});console.log(JSON.stringify({path:'coarse-touch-real-playback',project:info.project.name,...actual}));}
  console.log(JSON.stringify({path:'coarse-controls-layout',project:info.project.name,width,theme,reduced,host:state.host,targets:state.controls.map(c=>({name:c.name,w:c.box.w,h:c.box.h})),caption,pill,speedBounds,trackHeight:state.track.h}));
 });
 test('only the overflowing platform folds and wider touch playback stays single row',async({page},info)=>{
  await page.setViewportSize({width:430,height:900});await open(page);let state=await geometry(page);const rows=state.controls.length*44>state.host.w-20?2:1;targets(state,{rows});expect(state.host.w).toBe(398);expect(state.host.h).toBeCloseTo(state.host.w*9/16+(rows===2?88:0),1);
  await page.setViewportSize({width:600,height:900});state=await geometry(page);expect(state.bar.h).toBe(46);expect(state.host.h).toBeCloseTo(state.host.w*9/16,1);
  await page.setViewportSize({width:320,height:900});state=await geometry(page);targets(state);expect(state.host.w).toBe(288);
 });
 test('movie touch layout counts its six or seven original actions independently',async({page},info)=>{await page.setViewportSize({width:320,height:900});await open(page,{series:false});const state=await geometry(page);expect(state.controls.some(c=>c.name==='art-control-next-episode'||c.name==='art-control-episode-picker')).toBe(false);targets(state,{rows:state.controls.length*44>state.host.w-20?2:1});expect(state.host.w).toBe(288);});
});

test('fine-pointer desktop and narrow windows keep their existing single row and media ratio',async({page})=>{
 await open(page);expect((await geometry(page)).coarse).toBe(false);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});const state=await geometry(page);expect(state.bar.h).toBe(46);expect(state.host.h).toBeCloseTo(state.host.w*9/16,1);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);}
 await page.setViewportSize({width:1440,height:900});await page.locator('.art-control-fullscreen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.id||document.webkitFullscreenElement?.id)).toBe('watch-player');await expect.poll(async()=>{const state=await geometry(page);return [state.bar.h,state.video.h===state.host.h];},{message:'fullscreenchange has reached the native controls and video'}).toEqual([60,true]);await page.evaluate(()=>document.exitFullscreen?.()||document.webkitExitFullscreen?.());
});

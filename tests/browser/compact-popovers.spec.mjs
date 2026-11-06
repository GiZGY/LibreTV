import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';

async function open(page){
 await page.addInitScript(()=>{
  const episodes=[...Array.from({length:8},(_,i)=>'第1季第'+(i+1)+'集'),...Array.from({length:8},(_,i)=>'第2季第'+(i+1)+'集'),'番外篇：重逢之后的故事与特别访谈'];
  const line=(i,health,name,sparse=false)=>({key:'compact:'+i,sourceKey:'compact-'+i,name,health,episodes:episodes.filter((_,n)=>!sparse||n!==0).map((name,n)=>({name,url:'/media/sample.mp4?line='+i+'&ep='+n}))});
  const film={id:'film-compact',name:'弹层回归',type:'电视剧',episodes:17,seasons:2,year:2024,genre:'剧情',rating:8,length:'60秒',description:'',director:'—',cast:'—',candidatesComplete:true,cover:'',lines:[line(0,'fast','线路甲'),line(1,'slow','线路乙'),line(2,'fair','线路丙：包含很长名称的备用播放线路'),line(3,'unknown','线路丁'),line(4,'fair','线路戊',true)]};
  const p='openstream_live_';localStorage.setItem(p+'filmRecords',JSON.stringify([film]));localStorage.setItem(p+'playbackRate','1.75');localStorage.setItem(p+'autoplay','true');localStorage.setItem(p+'muted','true');
 });
 await page.goto('/#player/film-compact');await expectMediaFrame(page);await expect(page.locator('video')).toHaveJSProperty('muted',true);
}
const trigger=(page,name)=>page.locator(name==='speed'?'.fine-speed summary':`.player-bottom-trigger[data-player-panel="${name}"]`);
const popup=(page,name)=>page.locator(name==='speed'?'.fine-speed-panel':`[data-player-view="${name}"]`);
async function show(page,name){await trigger(page,name).click();await expect(popup(page,name)).toBeVisible();}
async function closed(page,name){await expect(popup(page,name)).toBeHidden();await expect(trigger(page,name)).toBeFocused();}
async function rate(page,n){await expect(page.locator('video')).toHaveJSProperty('playbackRate',n);await expect(page.locator('video')).toHaveJSProperty('defaultPlaybackRate',n);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_playbackRate')))).toBe(n);}
async function point(locator){const b=await locator.boundingBox();expect(b).toBeTruthy();return{x:b.x+b.width/2,y:b.y+b.height/2};}

// A real range gesture must continue to target the same unmoving surface.
async function drag(page,target){
 const slider=page.locator('.fine-speed input[type=range]');await slider.scrollIntoViewIfNeeded();const b=await slider.boundingBox(),value=Number(await slider.inputValue()),x=n=>b.x+9+(b.width-18)*(n-.5)/1.5,y=b.y+b.height/2;
 const before=await popup(page,'speed').boundingBox();await page.mouse.move(x(value),y);await page.mouse.down();
 try{for(let i=1;i<=8;i++){await page.mouse.move(x(value+(target-value)*i/8),y);await expect(popup(page,'speed')).toBeVisible();const after=await popup(page,'speed').boundingBox();for(const key of ['x','y','width','height'])expect(Math.abs(after[key]-before[key]),key).toBeLessThanOrEqual(1);}}
 finally{await page.mouse.up();}
 await rate(page,target);
}

test('compact episodes and traffic-light line tiles keep canonical labels, shared order and accessibility',async({page})=>{
 await open(page);await show(page,'episodes');
 await expect(popup(page,'episodes').locator('h3,[data-player-close],p')).toHaveCount(0);await expect(page.locator('[data-player-episode="1"]')).toHaveText('1季·1');await expect(page.locator('[data-player-episode="9"]')).toHaveAccessibleName('第 2 季 · 第 1 集');
 const special=page.locator('[data-player-episode="17"]');await expect(special).toHaveText('番外篇:重逢之后的故事与特别访谈');expect(await special.evaluate(b=>b.scrollWidth<=b.clientWidth+1)).toBe(true);
 await page.locator('#watch-player').screenshot({path:test.info().outputPath('compact-episodes.png')});
 await page.keyboard.press('Escape');await closed(page,'episodes');await show(page,'lines');
 const lines=popup(page,'lines');await expect(lines.locator('h3,small,p,[data-player-close]')).toHaveCount(0);expect(await lines.locator('.player-tool-lines').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length)).toBeGreaterThanOrEqual(2);
 const inline=await page.locator('[data-live-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.liveLine));expect(await lines.locator('[data-player-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.playerLine))).toEqual(inline);
 expect(new Set(await lines.locator('.source-dot').evaluateAll(nodes=>nodes.map(n=>n.dataset.health)))).toEqual(new Set(['fast','fair','slow','unknown']));
 await expect(page.locator('[data-player-line="4"]')).toBeDisabled();await expect(page.locator('[data-player-line="4"]')).toHaveAccessibleName(/缺少当前集/);await expect(page.locator('[data-player-line="0"]')).toHaveAccessibleName(/当前线路/);
 await expect(page.locator('[data-player-line="2"]')).toHaveAttribute('title',/包含很长名称/);expect(await page.locator('[data-player-line="2"] .player-line-name').evaluate(n=>getComputedStyle(n).textOverflow)).toBe('ellipsis');
 expect(await lines.innerText()).not.toMatch(/当前线路|缺少当前集|流畅|缓慢|尚未核实/);
 await page.locator('#watch-player').screenshot({path:test.info().outputPath('compact-lines.png')});
 await page.locator('video').evaluate(v=>v.play());
 await page.locator('[data-player-line="2"]').click();await expectPlaybackProgress(page,{episodeKey:'s1:e1',lineKey:'compact:2'});await expect(trigger(page,'lines')).toBeFocused();
});

test('open line tiles update health in place, append incoming sources and reorder only when reopened',async({page})=>{
 await open(page);await show(page,'lines');await page.locator('[data-player-line="0"]').focus();const order=await page.locator('[data-player-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.playerLine));
 await page.evaluate(()=>{const f=films.find(f=>f.id==='film-compact');document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:f.id,lineKey:'compact:0',health:'slow'}}));f.lines.push({...f.lines[0],key:'compact:5',sourceKey:'compact-5',name:'新到线路',health:'fast'});const old=document.querySelector('.watch-routes'),next=old.cloneNode(true),button=document.createElement('button');button.dataset.liveLine='5';next.querySelector('.watch-source-list').append(button);old.replaceWith(next);document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:f.id,lineKey:'compact:5',health:'fast'}}));});
 await expect(page.locator('[data-player-line="5"]')).toBeVisible();expect(await page.locator('[data-player-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.playerLine))).toEqual([...order,'5']);await expect(page.locator('[data-player-line="0"]')).toBeFocused();await expect(page.locator('[data-player-line="0"] .source-dot')).toHaveAttribute('data-health','slow');await expect(page.locator('[data-player-line="0"]')).toHaveAccessibleName(/缓慢/);
 expect(await page.evaluate(()=>LivePlayback.current().lineKey)).toBe('compact:0');await page.keyboard.press('Escape');await show(page,'lines');expect(await page.locator('[data-player-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.playerLine))).toEqual(await page.locator('[data-live-line]').evaluateAll(nodes=>nodes.map(n=>n.dataset.liveLine)));
});

test('all compact popovers toggle, escape or dismiss outside the player and return focus without closing internal gestures',async({page})=>{
 await open(page);
 for(const name of ['episodes','lines','speed']){await show(page,name);await trigger(page,name).click();await closed(page,name);await show(page,name);await page.keyboard.press('Escape');await closed(page,name);await show(page,name);await page.locator('.routes-heading').click();await closed(page,name);}
 await show(page,'speed');await page.locator('[data-rate="1.5"]').click();await rate(page,1.5);await page.locator('[data-rate="1.75"]').click();await rate(page,1.75);await page.locator('#watch-player').screenshot({path:test.info().outputPath('compact-speed.png')});await drag(page,1.25);
 const slider=page.locator('.fine-speed input');await slider.focus();await page.keyboard.press('ArrowRight');await rate(page,1.3);await page.locator('[data-step="0.05"]').click();await rate(page,1.35);await expect(popup(page,'speed')).toBeVisible();
 await page.keyboard.press('Escape');await closed(page,'speed');
});

test('539px fine-pointer speed popover stays anchored as values and labels change',async({page})=>{
 await page.setViewportSize({width:539,height:844});await open(page);await show(page,'speed');await drag(page,1.25);await drag(page,2);await drag(page,.5);await page.keyboard.press('Escape');await closed(page,'speed');
});

for(const mode of ['native','web'])test(mode+' fullscreen keeps compact selection, source switching, speed and dismissal in the same host',async({page})=>{
 await open(page);await page.locator(mode==='native'?'.art-control-fullscreen':'.art-control-fullscreenWeb').click();
 const fullscreen=()=>page.evaluate(mode=>mode==='native'?document.fullscreenElement?.id==='watch-player':Artplayer.instances[0].fullscreenWeb,mode);await expect.poll(fullscreen).toBe(true);
 await show(page,'episodes');await page.keyboard.press('Escape');await closed(page,'episodes');
 // Browser-native Escape can also leave native fullscreen, unlike web fullscreen.
 if(mode==='native'&&!await fullscreen()){await page.locator('.art-control-fullscreen').click();await expect.poll(fullscreen).toBe(true);}else expect(await fullscreen()).toBe(true);
 await show(page,'episodes');await page.locator('[data-player-episode="2"]').click();await expectPlaybackProgress(page,{episodeKey:'s1:e2'});expect(await fullscreen()).toBe(true);
 await show(page,'lines');await page.locator('[data-player-line="2"]').click();await expectPlaybackProgress(page,{episodeKey:'s1:e2',lineKey:'compact:2'});expect(await fullscreen()).toBe(true);
 await show(page,'speed');await page.locator('[data-rate="1.75"]').click();await sampleRealPlayback(page,{episodeKey:'s1:e2',lineKey:'compact:2'});expect(await fullscreen()).toBe(true);await page.keyboard.press('Escape');await closed(page,'speed');if(mode==='web')expect(await fullscreen()).toBe(true);
});

for(const width of [320,390])test('touch '+width+' keeps one-line aligned speed ticks, native range hit layer and compact sheet dismissal',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width,height:844},hasTouch:true});const page=await context.newPage();
 try{
  await open(page);expect(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)).toBe(true);
  for(const name of ['episodes','lines']){await show(page,name);const sheet=page.locator('.player-mobile-sheet[open]');await expect(sheet).toBeVisible();const b=await sheet.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);for(const box of await popup(page,name).locator('button').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height};}))){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}await page.touchscreen.tap(width/2,Math.max(4,b.y-20));await closed(page,name);}
  await show(page,'speed');const slider=page.locator('.fine-speed input');await slider.scrollIntoViewIfNeeded();expect((await slider.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const tick=page.locator('[data-rate="1.75"]');await expect(tick).toHaveAttribute('aria-hidden','true');const target=await point(tick);await page.touchscreen.tap(target.x,target.y);await rate(page,1.75);await expect(popup(page,'speed')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('compact-touch-speed.png')});
  const labels=await page.locator('[data-rate]').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,x:n.getBoundingClientRect().x+n.getBoundingClientRect().width/2})));expect(Math.max(...labels.map(n=>n.y))-Math.min(...labels.map(n=>n.y))).toBeLessThanOrEqual(1);for(let i=1;i<labels.length;i++)expect(labels[i].x).toBeGreaterThan(labels[i-1].x);
  await drag(page,1.25);const b=await popup(page,'speed').boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);await slider.focus();await page.keyboard.press('Tab');await closed(page,'speed');await show(page,'speed');await page.locator('.routes-heading').click();await closed(page,'speed');
 }finally{await context.close();}
});

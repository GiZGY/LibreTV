import {test,expect} from '@playwright/test';
import {PNG} from 'playwright-core/lib/utilsBundle';

async function openRibbon(page,count=8){
 await page.addInitScript(()=>{localStorage.setItem('openstream_live_muted','true');localStorage.setItem('openstream_live_volume','0');});
 await page.route('**/api/catalog/tmdb?**',route=>{
  const url=new URL(route.request().url());
  const items=url.searchParams.get('type')==='电影'?Array.from({length:count},(_,i)=>({provider:'tmdb',id:i+1,title:`合成影片${i+1}`,type_name:'电影',rate:'8.2',year:'2026',genre:'剧情',cover:`https://image.tmdb.org/t/p/w500/qa-ribbon-${i+1}.svg`})) : [];
  return route.fulfill({json:{items,filtered:true,total:items.length,hasNext:false}});
 });
 await page.route('https://image.tmdb.org/**/qa-ribbon-*.svg',route=>{
  const n=Number(route.request().url().match(/qa-ribbon-(\d+)/)[1]);
  const colors=['#df3b44','#27b46b','#2e76db','#d4a821','#ae4ed0','#22a5b6','#f77834','#6754be'];
  return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><rect width="500" height="750" fill="${colors[(n-1)%8]}"/><rect x="60" y="90" width="380" height="570" fill="none" stroke="white" stroke-width="12"/><text x="250" y="420" text-anchor="middle" font-size="220" font-family="sans-serif" fill="white">${n}</text></svg>`});
 });
 await page.goto('/#home');
 await expect(page.locator('.film-ribbon-group').first().locator('.poster-card').first()).toBeVisible();
 // Warm both foreground and ambient copies so a network/decode race cannot masquerade as a loop seam.
 await page.locator('.film-ribbon').evaluate(async ribbon=>{
  await document.fonts.ready;
  await Promise.all([...ribbon.querySelectorAll('img')].map(async img=>{img.loading='eager';await img.decode();}));
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 });
 await page.mouse.move(5,5);
}
async function period(page){return page.locator('.film-ribbon-track').evaluate(track=>Number(track.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel')[0].effect.getTiming().duration));}
async function phase(page,time,play=false){
 await page.locator('.film-ribbon-track').evaluate(async(track,{time,play})=>{
  [...track.children].forEach(group=>{group.style.animationPlayState=play?'':'paused';});
  track.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel').forEach(animation=>{animation.currentTime=time;});
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 },{time,play});
}
async function coverage(page){
 return page.locator('.film-ribbon').evaluate(ribbon=>{
  const box=ribbon.getBoundingClientRect(),gap=parseFloat(getComputedStyle(ribbon.firstElementChild.firstElementChild).columnGap);
  const cards=[...ribbon.querySelectorAll('.poster-card')].map(card=>card.getBoundingClientRect()).filter(rect=>rect.right>box.left&&rect.left<box.right).sort((a,b)=>a.left-b.left);
  let edge=box.left,largestGap=0;
  for(const card of cards){largestGap=Math.max(largestGap,card.left-edge);edge=Math.max(edge,card.right);}
  return {largestGap:Math.max(largestGap,box.right-edge),gap,width:box.width,groupWidth:ribbon.firstElementChild.firstElementChild.getBoundingClientRect().width};
 });
}
function frameError(first,second){
 const a=PNG.sync.read(first),b=PNG.sync.read(second);expect([a.width,a.height]).toEqual([b.width,b.height]);
 let sum=0;for(let i=0;i<a.data.length;i+=4)for(let channel=0;channel<3;channel++)sum+=Math.abs(a.data[i+channel]-b.data[i+channel]);
 return sum/(a.width*a.height*3);
}

for(const {count,width} of [{count:8,width:1365},{count:2,width:1365},{count:1,width:1365},{count:2,width:2560},{count:8,width:390}]){
 test(`ribbon paints a continuous loop with ${count} titles at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await openRibbon(page,count);
  const duration=await period(page),ribbon=page.locator('.film-ribbon');
  const copies=await ribbon.locator('.film-ribbon-group').first().locator('.poster-card').count()/count;
  // Check the last-to-first title seam and both physical group resets.
  for(const boundary of [duration/(2*copies),duration/2,duration]){
   await phase(page,boundary-.001);const before=await ribbon.screenshot();
   const node=await ribbon.evaluate(r=>{const box=r.getBoundingClientRect();return [...r.querySelectorAll('.poster-card')].findIndex(card=>{const rect=card.getBoundingClientRect();return rect.left<=box.left+80&&rect.right>=box.left+80;});});
   await phase(page,boundary+.001);const after=await ribbon.screenshot();
   const afterNode=await ribbon.evaluate(r=>{const box=r.getBoundingClientRect();return [...r.querySelectorAll('.poster-card')].findIndex(card=>{const rect=card.getBoundingClientRect();return rect.left<=box.left+80&&rect.right>=box.left+80;});});
   expect(afterNode,'the visible physical poster must not be replaced at a reset').toBe(node);expect(node).toBeGreaterThanOrEqual(0);
   expect(frameError(before,after),'actual painted pixels at the reset').toBeLessThan(1);
   const fit=await coverage(page);expect(fit.groupWidth).toBeGreaterThanOrEqual(fit.width);expect(fit.largestGap).toBeLessThanOrEqual(fit.gap+1);
  }
  // Run the real CSS timeline through its boundary and inspect every presented frame for a jump.
  await phase(page,duration-80,true);
  const samples=await ribbon.evaluate(async r=>{
   const box=r.getBoundingClientRect(),cards=[...r.querySelectorAll('.poster-card')];
   const anchor=cards.find(card=>{const rect=card.getBoundingClientRect();return rect.left<=box.left+80&&rect.right>=box.left+80;});
   const positions=[],start=performance.now();while(performance.now()-start<2100){await new Promise(requestAnimationFrame);positions.push({x:anchor.getBoundingClientRect().left,wall:performance.now()});}
   const animation=r.firstElementChild.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel')[0];
   return {positions,time:animation.currentTime,velocity:2*r.firstElementChild.firstElementChild.getBoundingClientRect().width/animation.effect.getTiming().duration};
  });
  expect(samples.time).toBeGreaterThan(duration+100);
  expect(samples.positions.at(-1).x).toBeLessThan(samples.positions[0].x);
  expect(Math.max(...samples.positions.slice(1).map((frame,i)=>Math.abs(frame.x-samples.positions[i].x+samples.velocity*(frame.wall-samples.positions[i].wall))))).toBeLessThan(2);
 });
}

test('dragging across either end keeps 1:1 motion and resumes from the released frame',async({page})=>{
 await openRibbon(page);const duration=await period(page);await phase(page,duration-.001,true);
 const ribbon=page.locator('.film-ribbon'),box=await ribbon.boundingBox(),anchor=ribbon.locator('.film-ribbon-group').first().locator('.poster-card').first();
 await page.mouse.move(box.x+120,box.y+100);await page.mouse.down();await page.evaluate(()=>new Promise(requestAnimationFrame));const start=(await anchor.boundingBox()).x;
 await page.mouse.move(box.x+210,box.y+100,{steps:6});expect((await anchor.boundingBox()).x-start).toBeCloseTo(90,0);
 await page.mouse.move(box.x+20,box.y+100,{steps:8});expect((await anchor.boundingBox()).x-start).toBeCloseTo(-100,0);
 const released=(await anchor.boundingBox()).x;await page.mouse.up();await page.mouse.move(5,5);
 await expect(ribbon).not.toHaveClass(/is-dragging|is-held/);await expect.poll(async()=>(await anchor.boundingBox()).x).toBeLessThan(released-2);
 // Several fast alternating gestures must not navigate or reset the phase.
 for(const delta of [80,-110,70,-90]){await page.mouse.move(box.x+160,box.y+100);await page.mouse.down();await page.evaluate(()=>new Promise(requestAnimationFrame));const x=(await anchor.boundingBox()).x;await page.mouse.move(box.x+160+delta,box.y+100,{steps:3});expect(Math.abs((await anchor.boundingBox()).x-x-delta)).toBeLessThan(1.5);await page.mouse.up();}
 await page.mouse.move(5,5);expect(new URL(page.url()).hash).toBe('#home');
 const fit=await coverage(page);expect(fit.largestGap).toBeLessThanOrEqual(fit.gap+1);
});

test('visible posters and repeated favorite clicks remain usable after a loop',async({page})=>{
 await openRibbon(page);await phase(page,(await period(page))+.001,true);
 const card=page.locator('.film-ribbon-group').first().locator('.poster-card').first(),favorite=card.locator('button'),link=card.locator('a');
 const id=await favorite.getAttribute('data-id'),href=await link.getAttribute('href');
 const box=await card.boundingBox();await page.mouse.move(box.x+80,box.y+100);
 // Pause through real hover, then use pointer clicks rather than waiting for an animated control to be stable.
 await expect.poll(()=>card.evaluate(c=>c.parentElement.getAnimations()[0].playState)).toBe('paused');
 const button=await favorite.boundingBox();await page.mouse.click(button.x+button.width/2,button.y+button.height/2,{clickCount:2});await expect(favorite).toHaveAttribute('aria-pressed','false');
 const nextButton=await favorite.boundingBox();await page.mouse.click(nextButton.x+nextButton.width/2,nextButton.y+nextButton.height/2);await expect(favorite).toHaveAttribute('aria-pressed','true');
 for(const button of await page.locator(`.film-ribbon [data-action="favorite"][data-id="${id}"]`).all())await expect(button).toHaveAttribute('aria-pressed','true');
 const poster=await card.locator('.poster-art').boundingBox();await page.mouse.click(poster.x+80,poster.y+100);await expect.poll(()=>new URL(page.url()).hash).toBe(href);
});

test('ribbon stays static and has no duplicate focus stops with reduced motion',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.emulateMedia({reducedMotion:'reduce'});await openRibbon(page);
 const ribbon=page.locator('.film-ribbon');
 expect(await ribbon.evaluate(r=>r.firstElementChild.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel').length)).toBe(0);
 await expect(ribbon.locator('.poster-card:visible')).toHaveCount(8);
 await expect(ribbon.locator('a:not([tabindex="-1"])')).toHaveCount(8);
 const box=await ribbon.boundingBox();await page.mouse.move(box.x+300,box.y+100);await page.mouse.down();await page.mouse.move(box.x+80,box.y+100,{steps:8});await page.mouse.up();
 expect(await ribbon.evaluate(r=>r.scrollLeft)).toBeGreaterThan(180);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(5,5);
 await expect.poll(()=>ribbon.evaluate(r=>r.firstElementChild.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel').length)).toBe(2);
 expect(await ribbon.evaluate(r=>r.scrollLeft)).toBe(0);
 // The in-product preference follows the same reduced-motion path.
 await page.locator('[data-action="settings"]').first().click();await page.locator('#motion').check();
 await expect.poll(()=>ribbon.evaluate(r=>r.firstElementChild.getAnimations({subtree:true}).filter(animation=>animation.animationName==='ribbon-travel').length)).toBe(0);
 await expect(ribbon.locator('.poster-card:visible')).toHaveCount(8);
});

test('resizing a short list keeps both animated groups wide enough',async({page})=>{
 await page.setViewportSize({width:390,height:900});await openRibbon(page,1);await phase(page,(await period(page))*.73,true);
 await page.setViewportSize({width:2560,height:1000});
 await expect.poll(async()=>{const fit=await coverage(page);return fit.groupWidth>=fit.width&&fit.largestGap<=fit.gap+1;}).toBe(true);
 const duration=await period(page);await phase(page,duration-.001);const first=await page.locator('.film-ribbon').screenshot();await phase(page,duration+.001);const second=await page.locator('.film-ribbon').screenshot();
 expect(frameError(first,second)).toBeLessThan(1);
});

test('real touch swipes cross the boundary in both directions without opening a film',async({browser,browserName})=>{
 test.skip(browserName!=='chromium','Native touch injection is exposed by Chromium CDP; WebKit shares the pointer logic covered by unit and mouse regressions.');
 const context=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();await openRibbon(page);const duration=await period(page);await phase(page,duration-.001,true);
  const session=await context.newCDPSession(page),ribbon=page.locator('.film-ribbon'),box=await ribbon.boundingBox(),anchor=ribbon.locator('.film-ribbon-group').first().locator('.poster-card').first();
  const touch=async(type,x)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y:box.y+100}]});
  for(const delta of [-80,80]){
   await touch('touchStart',200);await page.evaluate(()=>new Promise(requestAnimationFrame));const x=(await anchor.boundingBox()).x;
   for(let step=1;step<=5;step++)await touch('touchMove',200+delta*step/5);
   await page.evaluate(()=>new Promise(requestAnimationFrame));
   expect((await anchor.boundingBox()).x-x).toBeCloseTo(delta,0);await touch('touchEnd');
   await expect(ribbon).not.toHaveClass(/is-dragging|is-held/);
  }
  expect(new URL(page.url()).hash).toBe('#home');const fit=await coverage(page);expect(fit.largestGap).toBeLessThanOrEqual(fit.gap+1);
 }finally{await context.close();}
});

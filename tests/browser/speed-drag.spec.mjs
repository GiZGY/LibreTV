import {test,expect} from '@playwright/test';
import {expectMediaFrame,expectPlaybackProgress,sampleRealPlayback} from './media-assertions.mjs';

const dragRates=[.5,.6,.75,.9,1,1.05,1.25,1.5,1.75,1.9,2,1.95,1.75,1.5,1.25,1,.75,.5,1.25,1.75];
async function open(page,{touch=false}={}){
 await page.addInitScript(()=>{
  const p='openstream_live_',film={id:'film-speed-drag',name:'星河深处',type:'电视剧',episodes:2,seasons:1,year:2025,genre:'剧情',rating:8,length:'每集45分钟',description:'一封迟到的信让旧日的故事再次展开。',director:'林远',cast:'陈予 / 许宁',lines:[{key:'qa:drag',sourceKey:'qa',name:'线路一',health:'fast',episodes:[1,2].map(n=>({name:'第'+n+'集',url:'/media/sample.mp4?ep='+n}))}],candidatesComplete:true};
  localStorage.setItem(p+'filmRecords',JSON.stringify([film]));localStorage.setItem(p+'playbackRate','1.25');localStorage.setItem(p+'autoplay','false');localStorage.setItem(p+'volume','0');localStorage.setItem(p+'muted','true');
  const mute=()=>document.querySelectorAll('video').forEach(v=>{v.muted=true;v.volume=0;});addEventListener('DOMContentLoaded',()=>{mute();new MutationObserver(mute).observe(document.body,{childList:true,subtree:true});});
 });
 await page.goto('/#player/film-speed-drag');await expectMediaFrame(page);await page.locator('.art-control-playAndPause')[touch?'tap':'click']();await expectPlaybackProgress(page,{episode:1,episodeKey:'s1:e1',rate:1.25});
 await page.evaluate(()=>{
  window.__speedDragEvents=[];const label=el=>el?.tagName+(el?.getAttribute?.('aria-label')?':'+el.getAttribute('aria-label'):'');
  for(const name of ['focusin','focusout','pointerdown','pointerup','pointercancel','mousedown','mouseup','click','input','change'])document.addEventListener(name,event=>{const panel=document.querySelector('.fine-speed');if(!panel?.contains(event.target)&&!['pointerup','mouseup','click'].includes(name))return;window.__speedDragEvents.push({name,target:label(event.target),related:label(event.relatedTarget),trusted:event.isTrusted,pointerType:event.pointerType||null,x:event.clientX??null,y:event.clientY??null,value:panel?.querySelector('input')?.value,open:panel?.open});if(window.__speedDragEvents.length>200)window.__speedDragEvents.shift();},true);
  document.querySelector('.fine-speed').addEventListener('toggle',event=>window.__speedDragEvents.push({name:'toggle',open:event.target.open,trusted:event.isTrusted}));
 });
 await page.locator('.fine-speed summary')[touch?'tap':'click']();await expect(page.locator('.fine-speed')).toHaveAttribute('open','');await expect(page.locator('.fine-speed-panel')).toBeVisible();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function state(page,label){return page.evaluate(label=>{
 const details=document.querySelector('.fine-speed'),popup=details.querySelector('.fine-speed-panel'),slider=details.querySelector('input'),video=document.querySelector('video'),rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
 let visible=true;for(let el=popup;el;el=el.parentElement){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.02)visible=false;}
 return {label,open:details.open,visible,popup:rect(popup),slider:rect(slider),trigger:rect(details.querySelector('summary')),value:Number(slider.value),actual:video.playbackRate,defaultRate:video.defaultPlaybackRate,saved:Number(localStorage.getItem('openstream_live_playbackRate')),aria:slider.getAttribute('aria-valuetext'),summary:details.querySelector('summary').textContent,output:details.querySelector('output').textContent,focused:document.activeElement===slider,active:document.activeElement?.tagName,controls:document.querySelector('.art-video-player').className,muted:video.muted,coarse:matchMedia('(pointer:coarse)').matches};
 },label);}
function point(snapshot,value){return{x:snapshot.slider.x+9+(snapshot.slider.w-18)*(value-.5)/1.5,y:snapshot.slider.y+snapshot.slider.h/2};}
async function report(page,samples,info,path){
 const events=await page.evaluate(()=>window.__speedDragEvents),initial=samples[0],delta={};for(const part of ['popup','slider','trigger'])delta[part]=Object.fromEntries(['x','y','w','h'].map(key=>[key,Math.max(...samples.map(s=>Math.abs(s[part][key]-initial[part][key])))]));
 console.log(JSON.stringify({path,project:info.project.name,coarse:initial.coarse,initial:{popup:initial.popup,slider:initial.slider,trigger:initial.trigger},maxDelta:delta,steps:samples.map(s=>({label:s.label,open:s.open,visible:s.visible,value:s.value,expected:s.expected,actual:s.actual,defaultRate:s.defaultRate,saved:s.saved})),inputEvents:events.filter(e=>e.name==='input').length,closeEvents:events.filter(e=>e.name==='toggle'&&!e.open).length,allInputsTrusted:events.filter(e=>e.name==='input').every(e=>e.trusted),events:events.filter(e=>['focusin','focusout','toggle','pointerdown','pointerup','pointercancel'].includes(e.name))}));return events;
}
function assertSteps(samples,initial){
 for(const s of samples){expect(s.open,s.label+' stays open').toBe(true);expect(s.visible,s.label+' remains visible').toBe(true);
  for(const part of ['popup','slider','trigger'])for(const key of ['x','y','w','h'])expect(Math.abs(s[part][key]-initial[part][key]),s.label+' stable '+part+'.'+key).toBeLessThanOrEqual(1);
  expect(s.actual,s.label+' actual media rate').toBe(s.value);expect(s.defaultRate,s.label+' media default rate').toBe(s.value);expect(s.saved,s.label+' persisted rate').toBe(s.value);for(const key of ['aria','summary','output'])expect(s[key],s.label+' '+key).toBe(s.value+'×');expect(s.muted).toBe(true);
  if(s.expected!==undefined)expect(s.value,s.label+' native range position').toBeCloseTo(s.expected,2);
 }
}
async function mouseDrag(page,info,{idle=true}={}){
 const initial=await state(page,'initial'),samples=[initial],start=point(initial,initial.value);await page.mouse.move(start.x,start.y);await page.mouse.down();
 try{
  samples.push(await state(page,'pointerdown'));
  if(samples.at(-1).open)for(const value of dragRates){const p=point(initial,value);await page.mouse.move(p.x,p.y,{steps:2});samples.push({...await state(page,'move-'+value),expected:value});if(!samples.at(-1).open)break;}
  if(idle&&samples.at(-1).open){await page.waitForTimeout(3200);samples.push({...await state(page,'held-beyond-control-idle'),expected:1.75});}
 }finally{await page.mouse.up();samples.push(await state(page,'released'));}
 const events=await report(page,samples,info,'mouse-native-speed-drag');assertSteps(samples,initial);expect(samples.filter(s=>s.expected!==undefined)).toHaveLength(dragRates.length+(idle?1:0));expect(events.filter(e=>e.name==='input').length).toBeGreaterThan(5);expect(events.filter(e=>e.name==='input').every(e=>e.trusted)).toBe(true);expect(events.some(e=>e.name==='toggle'&&!e.open)).toBe(false);return initial;
}
async function boundaryAndKeyboard(page,info,initial){
 const samples=[],start=point(initial,1.75);await page.mouse.move(start.x,start.y);await page.mouse.down();
 try{await page.mouse.move(initial.popup.x+initial.popup.w+120,start.y,{steps:8});samples.push({...await state(page,'beyond-right'),expected:2});await page.mouse.move(initial.popup.x-100,start.y,{steps:8});samples.push({...await state(page,'beyond-left'),expected:.5});await page.mouse.move(initial.popup.x+initial.popup.w+120,start.y,{steps:8});samples.push({...await state(page,'beyond-right-again'),expected:2});}finally{await page.mouse.up();samples.push({...await state(page,'released-outside'),expected:2});}
 await report(page,samples,info,'mouse-speed-drag-boundary-release');assertSteps(samples,initial);
 await page.keyboard.press('Escape');await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');await expect(page.locator('.fine-speed summary')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('.fine-speed')).toHaveAttribute('open','');
 const slider=page.locator('.fine-speed input');for(let i=0;i<10&&!await slider.evaluate(el=>document.activeElement===el);i++)await page.keyboard.press('Tab');await expect(slider).toBeFocused();expect(await slider.evaluate(el=>el.matches(':focus-visible'))).toBe(true);
 const keyboardInitial=await state(page,'keyboard-initial'),keyboard=[];
 for(const[key,value]of [['Home',.5],['End',2],['ArrowLeft',1.95],['Home',.5]]){await page.keyboard.press(key);keyboard.push({...await state(page,'key-'+key),expected:value});}
 for(let i=0;i<25;i++)await page.keyboard.press('ArrowRight');keyboard.push({...await state(page,'keyboard-1.75'),expected:1.75});await report(page,keyboard,info,'keyboard-speed-range');assertSteps(keyboard,keyboardInitial);
 const sample=await sampleRealPlayback(page,{episode:1,episodeKey:'s1:e1',lineKey:'qa:drag',rate:1.75});console.log(JSON.stringify({path:'drag-and-keyboard-real-speed',project:info.project.name,...sample}));await page.keyboard.press('Escape');await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');await expect(page.locator('.fine-speed summary')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('.fine-speed')).toHaveAttribute('open','');await page.locator('.watch-aside .watch-side-heading h2').click();await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');
}

test('desktop thumb dragging keeps menu geometry and true speed stable through idle, boundary release and keyboard',async({page},info)=>{
 await open(page);const initial=await mouseDrag(page,info);await boundaryAndKeyboard(page,info,initial);
});
test.describe('coarse range drag',()=>{
 test.use({hasTouch:true,isMobile:true});
 for(const width of [320,390])test('native mouse drag in '+width+'px coarse layout retains stable menu and media rate',async({page},info)=>{await page.setViewportSize({width,height:900});await open(page,{touch:true});expect((await state(page,'coarse')).coarse).toBe(true);await mouseDrag(page,info,{idle:width===390});});
 test('real touch track taps update actual media without closing or moving the menu',async({page},info)=>{
  await page.setViewportSize({width:390,height:900});await open(page,{touch:true});const initial=await state(page,'touch-initial'),samples=[];
  for(const value of [.5,.75,1,1.25,1.5,1.75,2,1.75]){const p=point(initial,value);await page.touchscreen.tap(p.x,p.y);samples.push({...await state(page,'touch-tap-'+value),expected:value});if(!samples.at(-1).open)break;}
  await page.waitForTimeout(3200);samples.push({...await state(page,'touch-idle-after-release'),expected:1.75});const events=await report(page,samples,info,'native-touch-tap-speed-range');assertSteps(samples,initial);expect(events.some(e=>e.name==='pointerdown'&&e.pointerType==='touch'&&e.trusted)).toBe(true);expect(events.filter(e=>e.name==='input').length).toBeGreaterThan(5);expect(events.some(e=>e.name==='toggle'&&!e.open)).toBe(false);
  await page.keyboard.press('Escape');await expect(page.locator('.fine-speed summary')).toBeFocused();await page.keyboard.press('Enter');const keyboardInitial=await state(page,'coarse-keyboard-initial'),slider=page.locator('.fine-speed input');
  for(let i=0;i<6&&!await slider.evaluate(el=>document.activeElement===el);i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('[aria-hidden="true"]'))).toBe(false);}await expect(slider).toBeFocused();expect(await slider.evaluate(el=>el.matches(':focus-visible'))).toBe(true);
  const keyboard=[];for(const[key,value]of [['ArrowRight',1.8],['ArrowLeft',1.75]]){await page.keyboard.press(key);keyboard.push({...await state(page,'coarse-'+key),expected:value});}await report(page,keyboard,info,'coarse-keyboard-rate');assertSteps(keyboard,keyboardInitial);
  await page.keyboard.press('Tab');await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');await expect(page.locator('.fine-speed summary')).toBeFocused();
 });
 test('Chromium native touchMove retains the menu through out-of-bounds release and real playback',async({page,browserName},info)=>{
  test.skip(browserName!=='chromium','Continuous native touchMove uses Chromium CDP; WebKit has native tap and coarse mouse-drag coverage');
  await page.setViewportSize({width:390,height:900});await open(page,{touch:true});const initial=await state(page,'native-touch-initial'),samples=[initial],session=await page.context().newCDPSession(page);
  const touch=(type,p)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y,radiusX:1,radiusY:1,force:1,id:0}]:[]});
  try{
   await touch('touchStart',point(initial,initial.value));samples.push(await state(page,'touch-start'));
   try{for(const value of dragRates){await touch('touchMove',point(initial,value));samples.push({...await state(page,'touch-move-'+value),expected:value});if(!samples.at(-1).open)break;}await page.waitForTimeout(3200);samples.push({...await state(page,'touch-held-idle'),expected:1.75});}finally{await touch('touchEnd');samples.push({...await state(page,'touch-released'),expected:1.75});}
   const events=await report(page,samples,info,'native-cdp-touch-speed-drag');assertSteps(samples,initial);expect(events.some(e=>e.name==='pointerdown'&&e.pointerType==='touch'&&e.trusted)).toBe(true);expect(events.filter(e=>e.name==='input').length).toBeGreaterThan(5);expect(events.some(e=>e.name==='toggle'&&!e.open)).toBe(false);
   const boundary=[],y=point(initial,1.75).y;await touch('touchStart',point(initial,1.75));
   try{for(const[x,value]of [[386,2],[4,.5],[386,2]]){await touch('touchMove',{x,y});boundary.push({...await state(page,'touch-outside-'+value),expected:value});}}finally{await touch('touchEnd');boundary.push({...await state(page,'touch-outside-release'),expected:2});}
   await report(page,boundary,info,'native-touch-boundary-release');assertSteps(boundary,initial);
   await touch('touchStart',point(initial,2));await touch('touchMove',point(initial,1.75));await touch('touchEnd');assertSteps([{...await state(page,'touch-selected-1.75'),expected:1.75}],initial);
   const actual=await sampleRealPlayback(page,{episode:1,episodeKey:'s1:e1',lineKey:'qa:drag',rate:1.75});console.log(JSON.stringify({path:'native-touch-drag-real-speed',project:info.project.name,...actual}));
   await page.locator('.watch-aside .watch-side-heading h2').tap();await expect(page.locator('.fine-speed')).not.toHaveAttribute('open','');
  }finally{await session.detach();}
 });
});

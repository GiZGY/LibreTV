import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fixture(animated=true){
 const handlers={},classes=new Set(),animation={animationName:'ribbon-travel',currentTime:1000,effect:{getTiming:()=>({duration:10000})}},copyAnimation={...animation},hoverAnimation={animationName:'poster-hover',currentTime:0};
 const ribbon={scrollLeft:0,querySelector:()=>animated?{children:[{getAnimations:()=>[animation,hoverAnimation]},{getAnimations:()=>[copyAnimation]}],firstElementChild:{getBoundingClientRect:()=>({width:250})}}:null,matches:()=>false,setPointerCapture(){},hasPointerCapture:()=>false,classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}};
 const document={addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(app.slice(app.indexOf('const draggableShelfSelector='),app.indexOf("document.addEventListener('click',event=>{\n const resume=")),{document});
 const event=(x,y=0)=>({pointerId:1,pointerType:'touch',button:0,clientX:x,clientY:y,target:{closest:selector=>selector.includes('.poster-ribbon')?ribbon:null},preventDefault(){},stopImmediatePropagation(){}});
 return {handlers,animation,copyAnimation,hoverAnimation,classes,event};
}
test('touch synchronizes both groups without seeking poster hover transitions',()=>{
 const f=fixture();f.handlers.pointerdown(f.event(100));f.handlers.pointermove(f.event(50));
 assert.equal(f.animation.currentTime,2000);assert.equal(f.copyAnimation.currentTime,2000);assert.equal(f.hoverAnimation.currentTime,0);assert.ok(f.classes.has('is-dragging'));
 f.handlers.pointerup(f.event(50));assert.equal(f.classes.has('is-dragging'),false);
});
test('vertical touch and nonanimated shelves retain native scrolling',()=>{
 for(const animated of [true,false]){
  const f=fixture(animated);f.handlers.pointerdown(f.event(100));f.handlers.pointermove(f.event(99,30));f.handlers.pointermove(f.event(50,30));
  assert.equal(f.animation.currentTime,1000);assert.equal(f.classes.has('is-dragging'),false);
 }
});
test('reverse swipe wraps the ribbon and cancellation releases it',()=>{
 const f=fixture();f.handlers.pointerdown(f.event(100));f.handlers.pointermove(f.event(200));
 assert.equal(f.animation.currentTime,9000);assert.equal(f.copyAnimation.currentTime,9000);
 f.handlers.pointercancel(f.event(200));assert.equal(f.classes.has('is-dragging'),false);
 f.handlers.pointermove(f.event(250));assert.equal(f.animation.currentTime,9000);assert.equal(f.copyAnimation.currentTime,9000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../player-preview.js',import.meta.url),'utf8');
function player(saved=1.75){
 const events={},writes=[],nodes=new Map(),listeners={},timers=new Map();let timerId=0;
 const slider={value:'1',setAttribute(){},style:{setProperty(){}}};
 const panel={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},querySelectorAll:()=>[]};
 const video={playbackRate:1,defaultPlaybackRate:1};
 const instance={video,isDestroy:false,duration:120,currentTime:0,on:(event,fn)=>(events[event]??=[]).push(fn),get playbackRate(){return video.playbackRate;},set playbackRate(value){video.playbackRate=value;}};
 const context={instance,panel,slider,load:()=>saved,save:(...args)=>writes.push(args),document:{querySelector:()=>null,addEventListener:(n,fn)=>listeners[n]=fn,removeEventListener:n=>delete listeners[n]},window:{addEventListener:(n,fn)=>listeners[n]=fn,removeEventListener:n=>delete listeners[n]},clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;}};
 vm.createContext(context);
 const start=source.indexOf('   const format=rate=>');
 vm.runInContext(source.slice(start,source.indexOf("   panel.addEventListener('click'",start)),context);
 const hold=source.indexOf('   function endHold(');
 vm.runInContext(source.slice(hold,source.indexOf('   let advancing=false;',hold)),context);
 context.syncRate();
 return{...context,events,writes,nodes,listeners,timers,emit:name=>events[name]?.forEach(fn=>fn()),label:()=>nodes.get('summary').textContent};
}
test('selected speed is both the actual rate and the media reload default',()=>{
 const p=player();assert.equal(p.instance.video.defaultPlaybackRate,1.75);assert.equal(p.instance.playbackRate,1.75);assert.equal(p.label(),'1.75×');assert.equal(p.writes.length,0);
});
test('each media lifecycle event repairs a late reset without overwriting the preference',()=>{
 const p=player();
 for(const event of ['loadstart','loadedmetadata','canplay','play','playing','ratechange']){
  p.instance.video.playbackRate=1;p.emit('video:'+event);
  assert.equal(p.instance.playbackRate,1.75,event);assert.equal(p.label(),'1.75×',event);
 }
 assert.equal(p.writes.length,0);
});
test('rate continuity is independent of one-shot position restoration',()=>{
 const p=player(1.35);p.instance.video.playbackRate=1;p.emit('video:loadedmetadata');p.instance.video.playbackRate=1;p.emit('video:loadedmetadata');
 assert.equal(p.instance.playbackRate,1.35);assert.equal(p.label(),'1.35×');
});
test('manual, ended, outro and source-switch remounts inherit the last chosen speed',()=>{
 for(const route of ['manual-next','ended-next','outro-next','source-switch']){
  const previous=player();previous.updateRate(1.6);const next=player(previous.writes.at(-1)[1]);
  next.instance.video.playbackRate=1;next.emit('video:playing');
  assert.equal(next.instance.playbackRate,1.6,route);assert.equal(next.instance.video.defaultPlaybackRate,1.6,route);assert.equal(next.label(),'1.6×',route);
 }
});
test('temporary keyboard acceleration never becomes the saved or default speed',()=>{
 const p=player(1.75),key={key:'ArrowRight',target:{tagName:'BODY'},preventDefault(){},stopImmediatePropagation(){}};
 p.listeners.keydown(key);[...p.timers.values()][0]();
 assert.equal(p.instance.playbackRate,2);assert.equal(p.label(),'2×');assert.equal(p.instance.video.defaultPlaybackRate,1.75);assert.equal(p.writes.length,0);
 p.instance.video.playbackRate=1;p.emit('video:ratechange');assert.equal(p.instance.playbackRate,2);
 p.listeners.keyup(key);assert.equal(p.instance.playbackRate,1.75);assert.equal(p.label(),'1.75×');assert.equal(p.writes.length,0);
});
test('blur restores the latest selected preference and disposal removes keyboard listeners',()=>{
 const p=player(),key={key:'ArrowRight',target:{tagName:'BODY'},preventDefault(){},stopImmediatePropagation(){}};
 p.listeners.keydown(key);[...p.timers.values()][0]();p.updateRate(1.4);p.listeners.blur();
 assert.equal(p.instance.playbackRate,1.4);assert.equal(p.instance.video.defaultPlaybackRate,1.4);
 p.instance.isDestroy=true;p.instance.video.playbackRate=1;p.emit('video:playing');assert.equal(p.instance.playbackRate,1);
 p.emit('destroy');assert.deepEqual(Object.keys(p.listeners),[]);
});
test('invalid stored speed uses normal speed and values stay on supported steps',()=>{
 for(const value of [null,0,-1,'bad',Infinity])assert.equal(player(value).instance.playbackRate,1);
 const p=player();p.updateRate(9);assert.equal(p.instance.playbackRate,2);p.updateRate(.1);assert.equal(p.instance.playbackRate,.5);p.updateRate(1.36);assert.equal(p.instance.playbackRate,1.35);
});

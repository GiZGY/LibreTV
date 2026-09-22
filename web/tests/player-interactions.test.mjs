import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../player-preview.js',import.meta.url),'utf8');

test('speed and settings panels are mutually exclusive in both directions',()=>{
  const events={},listeners={};
  const panel={open:false,addEventListener:(name,fn)=>listeners[name]=fn};
  const instance={setting:{show:true},on:(name,fn)=>events[name]=fn};
  const start=source.indexOf("   panel.addEventListener('click'");
  const end=source.indexOf('   const playerElement=',start);
  vm.runInNewContext(source.slice(start,end),{panel,instance});
  listeners.click({stopPropagation(){},target:{closest:()=>null}});
  assert.equal(instance.setting.show,false);
  panel.open=true;events.setting(true);assert.equal(panel.open,false);
  instance.setting.show=true;panel.open=true;listeners.toggle();
  assert.equal(instance.setting.show,false);
});

test('fullscreen transition retains the player node and recovers after rejection',async()=>{
  assert.ok(source.indexOf('Artplayer.FULLSCREEN_WEB_IN_BODY=false')<source.indexOf('art=new Artplayer('));
  const events={},listeners={},classes=new Set();
  let rejectFullscreen;
  const element={
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
    addEventListener:(name,fn)=>listeners[name]=fn,
    removeEventListener:name=>delete listeners[name],
    requestFullscreen:()=>new Promise((resolve,reject)=>{rejectFullscreen=reject;})
  };
  const instance={template:{$player:element},fullscreenWeb:true,setting:{show:true},notice:{},on:(name,fn)=>events[name]=fn};
  const context={instance,panel:{open:true},window:{scrollX:0,scrollY:50,scrollTo(){}},document:{documentElement:{classList:{toggle(){},remove(){}}}},requestAnimationFrame:fn=>fn()};
  const start=source.indexOf('   const playerElement=');
  const end=source.indexOf("   panel.addEventListener('keydown'",start);
  vm.runInNewContext(source.slice(start,end),context);
  const click={target:{closest:()=>true},preventDefault(){},stopImmediatePropagation(){}};
  listeners.click(click);assert.equal(classes.has('fullscreen-transfer'),true);
  events.fullscreen(true);assert.equal(classes.size,0);assert.equal(context.panel.open,false);
  instance.fullscreenWeb=false;events.fullscreen(false);assert.equal(instance.fullscreenWeb,false);
  instance.fullscreenWeb=true;
  listeners.click(click);rejectFullscreen(new Error('not supported'));
  await Promise.resolve();assert.equal(classes.size,0);assert.match(instance.notice.show,/无法进入全屏/);
  events.destroy();assert.equal(listeners.click,undefined);
});

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
  const context={instance,webFullscreen:false,next:{requestFullscreen:element.requestFullscreen},panel:{open:true},window:{scrollX:0,scrollY:50,scrollTo(){}},document:{documentElement:{classList:{toggle(){},remove(){}}}},requestAnimationFrame:fn=>fn()};
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

test('manual next ignores autoplay, saves progress once, and stops at the final episode',()=>{
  const start=source.indexOf('   let advancing=false;');
  const end=source.indexOf('   let restored=false;',start);
  const state={episode:1};let renders=0,saves=0,continues=0;
  const context={document:{addEventListener(){},removeEventListener(){}},film:{id:'series',episodes:3},instance:{currentTime:42,duration:120,on(){},notice:{}},isSeries:()=>true,load:()=>false,episodeFor:()=>state,render:()=>renders++,window:{LivePlayback:{progress:()=>saves++,continue:()=>continues++}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  assert.equal(context.advance(),false);
  assert.equal(context.advance(true),true);
  assert.equal(state.episode,2);assert.equal(renders,1);assert.equal(saves,1);assert.equal(continues,1);
  assert.equal(context.advance(true),false);assert.equal(state.episode,2);
  vm.runInContext('advancing=false',context);state.episode=3;
  assert.equal(context.advance(true),false);assert.equal(renders,1);
});

test('live episode refresh retains the fullscreen host and recovers a resolution failure',async()=>{
  const live=readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
  const block=live.slice(live.indexOf('  render = async function ()'),live.indexOf('  searchAll = function ()'));
  const film={id:'series',episodes:3},state={episode:2},events=[];
  const host={isConnected:true};let mainWrites=0,sideUpdates=0,fail=false;
  const main={set innerHTML(value){mainWrites++;}};
  const document={querySelector:selector=>selector==='#watch-player'?host:{replaceWith(){sideUpdates++;}},createRange:()=>({createContextualFragment:()=>({querySelector:()=>({})})}),dispatchEvent:event=>events.push(event.type)};
  const context={window:{},performance:{now:()=>0},generation:0,request:null,homeFilterController:null,AbortController,location:{hash:'#player/series'},shell(){},authenticated:true,showSources(){},films:[film],activePlayback:{filmId:'series',episode:1},$:()=>main,document,resolveFilm:async()=>{if(fail)throw new Error('resolution failed');},episodeState:{series:state},historyMetadata:{},playback:async()=>({filmId:'series',episode:state.episode}),player:()=>'',routeButtons:()=>'',addOtherLines(){},Event,episodeFor:()=>state,toast(){},status:()=>'',isSeries:()=>true};
  vm.createContext(context);vm.runInContext(block,context);
  await context.render();
  assert.equal(mainWrites,0);assert.equal(sideUpdates,2);assert.equal(context.activePlayback.episode,2);assert.ok(events.includes('playback-ready'));
  fail=true;state.episode=3;await context.render();
  assert.equal(mainWrites,0);assert.equal(state.episode,2);assert.ok(events.includes('playback-error'));
});

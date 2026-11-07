import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../player-preview.js',import.meta.url),'utf8');
function sound(initial={muted:true,volume:0}){
 const events={},saved={...initial},video={muted:false,volume:1};
 const instance={video,on:(event,fn)=>events[event]=fn};
 const ctx=vm.createContext({instance,mountedSound:null,previousSound:null,load:(key,fallback)=>saved[key]??fallback,save:(key,value)=>saved[key]=value});
 vm.runInContext(source.slice(source.indexOf('   const sound='),source.indexOf('   session ||=')),ctx);
 const handler=source.split('\n').find(line=>line.includes("instance.on('video:volumechange'"));
 vm.runInContext(handler,ctx);
 return{instance,video,saved,events,play(){video.muted=false;events['video:play']();events['video:volumechange']();}};
}
test('decoder unmute on play is repaired before it can overwrite the saved sound preference',()=>{
 const p=sound();assert.equal(p.video.volume,0);assert.equal(p.video.defaultMuted,true);
 p.play();assert.equal(p.video.muted,true);assert.equal(p.saved.muted,true);
 p.video.muted=false;p.events['video:volumechange']();assert.equal(p.video.muted,true);assert.equal(p.saved.muted,true);
 p.video.muted=false;p.events['video:ratechange']();p.events['video:volumechange']();assert.equal(p.video.muted,true);assert.equal(p.saved.muted,true);
});
test('user unmute and volume changes survive pause/play and remount; zero is preserved',()=>{
 const p=sound();p.events.muted(false);p.video.volume=.4;p.events['video:volumechange']();
 p.play();assert.equal(p.video.muted,false);assert.equal(p.video.volume,.4);
 const next=sound(p.saved);next.play();assert.equal(next.video.muted,false);assert.equal(next.video.volume,.4);
 next.video.volume=0;next.events['video:volumechange']();next.play();assert.equal(next.video.volume,0);
});
test('destroyed sound handlers never restore or save stale media state',()=>{
 const p=sound();p.instance.isDestroy=true;p.video.muted=false;p.events['video:play']();p.events['video:volumechange']();
 assert.equal(p.video.muted,false);assert.equal(p.saved.muted,true);
});

test('mute suppresses output during native rate resets without losing the chosen volume',()=>{
 const p=sound({muted:true,volume:.6});assert.equal(p.video.volume,0);assert.equal(p.saved.volume,.6);
 p.video.muted=false;assert.equal(p.video.volume,0);p.events['video:volumechange']();assert.equal(p.video.muted,true);assert.equal(p.saved.volume,.6);
 p.events.muted(false);assert.equal(p.video.volume,.6);assert.equal(p.video.muted,false);
 p.events.muted(true);p.events['video:volumechange']();assert.equal(p.video.volume,0);assert.equal(p.saved.volume,.6);
 p.events.muted(false);assert.equal(p.video.volume,.6);
});

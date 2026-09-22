import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const timers=new Map();let timerId=0;
const context={window:{},setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),document:{createElement:()=>({children:[],handlers:{},setAttribute(){},addEventListener(event,fn){this.handlers[event]=fn;},append(...children){this.children.push(...children);},remove(){this.removed=true;}})}};
for(const file of ['native-ad-evidence.js','native-ad-guard.js'])vm.runInNewContext(fs.readFileSync(new URL('../js/'+file,import.meta.url),'utf8'),context);
const hash=char=>char.repeat(64),now=Date.now();
const rules=[{id:'fixture',expiresAt:new Date(now+86400000).toISOString(),segments:[{duration:10,sha256:hash('a')}]}];
const evidence={schema:1,mediaUrlSha256:hash('b'),manifestSha256:hash('c'),reviewedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),timeline:{engine:'webkit-native',duration:120,start:0},ranges:[{ruleId:'fixture',start:20,end:30,segments:[{identity:hash('d')}]}]};
function setup(){
 const video={src:'https://fixture.test/film.m3u8',currentSrc:'',currentTime:21,duration:120,paused:false,seeking:false,ended:false,readyState:4,handlers:{},remote:{state:'disconnected'},seekable:{length:1,start:()=>0,end:()=>120},addEventListener(event,fn){this.handlers[event]=fn;},removeEventListener(event){delete this.handlers[event];}};
 const host={nodes:[],appendChild(node){this.nodes.push(node);}};
 const input={evidence:structuredClone(evidence),rules:structuredClone(rules),mediaUrlSha256:hash('b'),manifestSha256:hash('c'),verifiedSegments:new Map([[hash('d'),hash('a')]])};
 const guard=context.window.OpenStreamNativeAdGuard.attach({video,host,getVerification:()=>input});
 return {video,host,input,guard,tick:()=>video.handlers.timeupdate()};
}
let run=setup();run.tick();assert.equal(run.video.currentTime,30);assert.equal(run.video.duration,120);
run.video.currentTime=30.5;run.tick();assert.equal(run.guard.getStatus().pending,false);
run.host.nodes[0].children[1].handlers.click();assert.equal(run.video.currentTime,21);run.tick();assert.equal(run.video.currentTime,21,'undo does not immediately skip again');run.guard();assert.equal(Object.keys(run.video.handlers).length,0);
run=setup();run.tick();for(const callback of [...timers.values()])callback();assert.equal(run.video.currentTime,21);assert.equal(run.guard.getStatus().suspended,true);assert.equal(run.guard.getStatus().recoveries,1);run.tick();assert.equal(run.video.currentTime,21);run.guard();
run=setup();run.tick();run.video.currentTime=80;run.video.handlers.seeking();for(const callback of [...timers.values()])callback();assert.equal(run.video.currentTime,80,'manual seek is never undone by recovery');run.guard();
for(const mutate of [r=>r.video.duration=60,r=>r.input.manifestSha256=hash('e'),r=>r.input.verifiedSegments.clear(),r=>r.input.rules[0].expiresAt='2000-01-01',r=>r.video.remote.state='connected',r=>r.video.currentSrc='https://fixture.test/other.m3u8',r=>r.video.seekable.end=()=>25]){
 run=setup();mutate(run);run.tick();assert.equal(run.video.currentTime,21);run.guard();
}
run=setup();run.tick();run.video.handlers.pause();assert.equal(run.guard.getStatus().pending,false);run.guard();
run=setup();
run.input.evidence.ranges.push({ruleId:'fixture',start:108,end:118,segments:[{identity:hash('e')}]});
run.input.verifiedSegments.set(hash('e'),hash('a'));
run.tick();assert.equal(run.video.currentTime,30);
run.video.currentTime=31;run.tick();
run.video.currentTime=109;run.tick();assert.equal(run.video.currentTime,118);
run.video.currentTime=118.5;run.tick();
assert.equal(run.guard.getStatus().skips,2,'separate reviewed ranges are independently skipped');
assert.equal(run.guard.getStatus().pending,false);
assert.equal(run.video.duration,120,'tail skip never rewrites duration');
run.host.nodes.at(-1).children[1].handlers.click();
assert.equal(run.video.currentTime,109);run.tick();assert.equal(run.video.currentTime,109);
run.video.currentTime=21;run.tick();assert.equal(run.video.currentTime,21,'revisiting an already skipped range remains watchable');
run.video.currentTime=119.9;run.tick();assert.equal(run.video.currentTime,119.9,'remaining programme at the tail is preserved');
run.video.ended=true;run.video.currentTime=120;run.tick();assert.equal(run.video.currentTime,120);run.guard();
assert.equal(timers.size,0,'destroy clears all recovery and notice timers');
console.log('Native runtime: verified skip, unchanged duration, undo, stalled-seek recovery, manual seek, expiry, source switch, remote exclusion and cleanup passed; simulated video only');

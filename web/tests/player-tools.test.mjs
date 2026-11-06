import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={window:{},setInterval,clearInterval};vm.runInNewContext(readFileSync(new URL('../player-tools.js',import.meta.url),'utf8'),context);const tools=context.window.OpenStreamPlayerTools;
function watch(){let now=0,recovered=0,failed=0,hidden=false;const video={currentTime:0,paused:false,seeking:false,ended:false};const watch=tools.createStallWatch({video,now:()=>now,hidden:()=>hidden,onRecover:()=>recovered++,onFailed:()=>failed++});return{video,watch,advance(ms){now+=ms;watch.poll();},hidden(value){hidden=value;},counts:()=>[recovered,failed]};}
test('startup and sustained non-progress use separate bounds and recover only once',()=>{const a=watch();a.watch.arm();a.advance(24000);assert.deepEqual(a.counts(),[0,0]);a.advance(1000);assert.deepEqual(a.counts(),[1,0]);a.advance(14000);assert.deepEqual(a.counts(),[1,0]);a.advance(1000);assert.deepEqual(a.counts(),[1,1]);a.advance(999999);assert.deepEqual(a.counts(),[1,1]);const b=watch();b.watch.arm();b.video.currentTime=1;b.advance(1000);b.advance(11000);assert.deepEqual(b.counts(),[0,0]);b.advance(1000);assert.deepEqual(b.counts(),[1,0]);});
test('pause, seeking, hidden tabs, short buffering and disposal do not trigger self-heal',()=>{for(const kind of ['paused','seeking','hidden']){const a=watch();a.watch.arm();if(kind==='hidden')a.hidden(true);else a.video[kind]=true;a.advance(60000);if(kind==='hidden')a.hidden(false);else a.video[kind]=false;a.advance(1000);assert.deepEqual(a.counts(),[0,0]);a.watch.dispose();a.advance(999999);assert.deepEqual(a.counts(),[0,0]);}const a=watch();a.watch.arm();for(let i=0;i<10;i++){a.video.currentTime++;a.advance(3000);}assert.deepEqual(a.counts(),[0,0]);});
test('local subtitle parsing supports SRT/VTT timing, text-only output and overlaps',()=>{const cues=tools.parseSubtitles('1\n00:00:01,000 --> 00:00:04,000\n<b>hello</b><script>window.hacked=true</script>\n\n2\n00:00:03,000 --> 00:00:05,000\nworld');assert.equal(cues[0].text,'hellowindow.hacked=true');assert.equal(tools.cuesAt(cues,3.5),'hellowindow.hacked=true\nworld');assert.equal(tools.cuesAt(cues,6),'');const vtt=tools.parseSubtitles('WEBVTT\n\nNOTE ignored\nanything\n\n00:01.000 --> 00:02.000 align:center\n字幕');assert.equal(vtt[0].start,1);assert.equal(vtt[0].text,'字幕');});
test('malformed, unrecognized, oversized and invalid subtitle files fail without state changes',()=>{for(const value of ['nothing','1\n00:61:00,000 --> 00:62:00,000\ntext','1\n00:00:03,000 --> 00:00:02,000\ntext','\uFFFD', 'x'.repeat(2*1024*1024+1)])assert.throws(()=>tools.parseSubtitles(value));});
test('sleep deadline fires once, blocks automatic advance and recovers only on explicit cancel',()=>{let now=0,paused=0,timer=0,cleared=0;const sleep=tools.createSleep({now:()=>now,schedule:()=>++timer,unschedule:()=>cleared++});const media={filmId:'f',episodeKey:'s1:e1'},instance={pause:()=>paused++};sleep.bind(instance);sleep.setMinutes(1);now=59000;sleep.tick();assert.equal(paused,0);sleep.extend();now=60000;sleep.tick();assert.equal(paused,0);now=16*60000;sleep.tick();assert.equal(paused,1);sleep.tick();assert.equal(paused,1);assert.equal(sleep.beforeAdvance(media,false),false);assert.equal(sleep.blocked(),true);sleep.cancel();assert.equal(sleep.blocked(),false);assert.equal(sleep.beforeAdvance(media,false),true);assert.ok(cleared>=1);});
test('stop-at-end takes priority over autoplay and outro, while manual navigation cancels it',()=>{let paused=0;const sleep=tools.createSleep(),media={filmId:'f',episodeKey:'s1:e1'};sleep.bind({pause:()=>paused++});sleep.setEnd(media);assert.equal(sleep.applies(media),true);assert.equal(sleep.beforeAdvance(media,false),false);assert.equal(paused,0);assert.equal(sleep.ended(media),true);assert.equal(paused,1);sleep.cancel();sleep.setEnd(media);assert.equal(sleep.beforeAdvance(media,true),true);assert.equal(sleep.applies(media),false);sleep.dispose();});
test('episode temporary skip choices survive same-episode retry but never change persistent defaults',()=>{const a={filmId:'f',episodeKey:'s1:e1'},b={filmId:'f',episodeKey:'s1:e2'};tools.overrideFor(a).outro=true;assert.equal(tools.overrideFor({...a}).outro,true);assert.equal(tools.overrideFor(b).outro,false);assert.equal(tools.overrideFor(a).intro,false);});

test('direct skip seconds validate atomically and enable a first positive value',()=>{
 const media={filmId:'direct',episodeKey:'s1:e1'},skip={intro:0,outro:30},changes=[],controls=tools.createSkipSettings({media,skip,onChange:change=>changes.push({...change})});
 assert.equal(controls.enabled('intro'),false);assert.equal(controls.setEnabled('intro',true),false);
 for(const value of ['', ' ', '1.5', '1e2', NaN, Infinity, -1, 301, null, true])assert.equal(controls.setSeconds('intro',value),false);
 assert.deepEqual(skip,{intro:0,outro:30});assert.equal(changes.length,0);
 assert.equal(controls.setSeconds('intro','17'),true);assert.equal(controls.enabled('intro'),true);assert.equal(skip.intro,17);assert.deepEqual(changes,[{which:'intro',origin:'input'}]);
 assert.equal(controls.setSeconds('outro',300),true);assert.equal(controls.setSeconds('intro',0),true);assert.equal(controls.enabled('intro'),false);assert.equal(controls.enabled('outro'),true);
});
test('independent skip switches keep saved seconds, survive same-episode source changes and reset for the next episode',()=>{
 const media={filmId:'switches',episodeKey:'s2:e3',lineKey:'a'},skip={intro:12,outro:25},controls=tools.createSkipSettings({media,skip});
 assert.equal(controls.setEnabled('outro',false),true);assert.equal(controls.enabled('outro'),false);assert.equal(controls.enabled('intro'),true);assert.deepEqual(skip,{intro:12,outro:25});
 assert.equal(controls.setSeconds('outro',31),true);assert.equal(controls.enabled('outro'),false);
 const retry=tools.createSkipSettings({media:{...media,lineKey:'b'},skip:{...skip}});assert.equal(retry.enabled('outro'),false);
 const next=tools.createSkipSettings({media:{...media,episodeKey:'s2:e4'},skip:{...skip}});assert.equal(next.enabled('outro'),true);
 assert.equal(controls.setEnabled('outro',true),true);assert.equal(controls.enabled('outro'),true);assert.equal(skip.outro,31);
});
test('markers defer only their own duration through retry and source changes until next episode or an explicit edit',()=>{
 const media={filmId:'markers',episodeKey:'s1:e1'},skip={intro:0,outro:5},changes=[],controls=tools.createSkipSettings({media,skip,onChange:change=>changes.push({...change})});
 assert.equal(controls.setSeconds('intro',4,{origin:'mark'}),true);assert.equal(controls.setSeconds('outro',12,{origin:'mark'}),true);assert.deepEqual(skip,{intro:4,outro:12});
 assert.deepEqual({...tools.effectiveSkip({...media,lineKey:'retry'},skip)},{intro:0,outro:5});
 assert.equal(controls.setSeconds('outro',17),true);assert.deepEqual({...tools.effectiveSkip(media,skip)},{intro:0,outro:17});
 assert.equal(controls.setSeconds('intro',7,{origin:'mark'}),true);assert.deepEqual({...tools.effectiveSkip(media,skip)},{intro:0,outro:17});
 assert.deepEqual({...tools.effectiveSkip({...media,episodeKey:'s1:e2'},skip)},{intro:7,outro:17});
 assert.equal(controls.setEnabled('intro',false),true);assert.deepEqual({...tools.effectiveSkip(media,skip)},{intro:7,outro:17});assert.equal(controls.enabled('intro'),false);
 assert.deepEqual(changes.map(change=>change.origin),['mark','mark','input','mark','toggle']);
});
test('custom sleep accepts whole minutes only and rejects invalid input without changing an active deadline',()=>{
 let now=1000,schedules=0;const sleep=tools.createSleep({now:()=>now,schedule:()=>++schedules,unschedule:()=>{}});assert.equal(sleep.setMinutes('7'),true);assert.equal(sleep.snapshot().deadline,421000);
 for(const value of ['', ' ', 0, 241, '7.5', 1.5, Infinity, '1e2', null, true]){assert.equal(sleep.setMinutes(value),false);assert.equal(sleep.snapshot().deadline,421000);}
 assert.equal(schedules,1);now=2000;assert.equal(sleep.setMinutes(240),true);assert.equal(sleep.snapshot().deadline,14402000);sleep.dispose();
});
test('aspect selection has a natural default and only accepts explicit supported ratios',()=>{
 for(const dimensions of [{videoWidth:1920,videoHeight:1080},{videoWidth:1440,videoHeight:1080},{videoWidth:2560,videoHeight:1080},{videoWidth:0,videoHeight:0}]){
  assert.equal(tools.aspectFor(dimensions,'default'),'default');assert.equal(tools.aspectFor(dimensions,'21:9'),'default');assert.equal(tools.aspectFor(dimensions,'4:3'),'4:3');assert.equal(tools.aspectFor(dimensions,'16:9'),'16:9');
 }
});
test('settings chevron uses the actual current parent options and cannot navigate above root',()=>{
 const root=[],parent={$item:{id:'subtitle'}},children=[{$parents:root,$parent:parent}],renders=[],setting={active:children,render(options){renders.push(options);this.active=options;}};
 assert.equal(tools.backSetting(setting),parent);assert.equal(setting.active,root);assert.deepEqual(renders,[root]);assert.equal(tools.backSetting(setting),null);assert.equal(renders.length,1);
});
test('editable subtitle values validate whole font sizes and signed half-second offsets without coercion',()=>{
 for(const n of [16,25,40])assert.equal(tools.subtitleValue('size',String(n)),n);
 for(const value of ['',0,15,41,24.5,null,true,'2e1'])assert.equal(tools.subtitleValue('size',value),null);
 for(const [value,n] of [['+2.5',2.5],['−2.5',-2.5],['-.5',-.5],['0',0],[-120,-120],[120,120]])assert.equal(tools.subtitleValue('offset',value),n);
 for(const value of ['', '-', '+', '1e1', 'NaN', true, null, -120.5, 120.5, .25, Infinity])assert.equal(tools.subtitleValue('offset',value),null);
});

test('recovery-induced pause cannot disable its deadline, but an explicit pause cancels recovery',()=>{const a=watch();a.watch.arm();a.video.currentTime=1;a.advance(1000);a.advance(12000);a.video.paused=true;a.advance(15000);assert.deepEqual(a.counts(),[1,1]);const b=watch();b.watch.arm();b.advance(25000);b.video.paused=true;b.watch.suspend();b.advance(99999);assert.deepEqual(b.counts(),[1,0]);});

test('third-party reconnects do not compete with application-owned recovery budgets',()=>{const source=readFileSync(new URL('../player-preview.js',import.meta.url),'utf8');assert.ok(source.indexOf('Artplayer.RECONNECT_TIME_MAX=0')<source.indexOf('art=new Artplayer('));});

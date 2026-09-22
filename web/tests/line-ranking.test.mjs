import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
test('health ranking keeps original line identities and does not mutate playback order',()=>{
 const context=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('  function rankedLines('),source.indexOf('  function routeButtons(')),context);
 const film={lines:[{health:'slow'},{},{health:'fast'},{health:'fair'},{health:'fast'}]};
 assert.deepEqual(Array.from(context.rankedLines(film),x=>x.i),[2,4,3,1,0]);
 assert.equal(film.lines[0].health,'slow');
});
test('detail prepares lines in background and page hide saves progress',()=>{
 assert.match(source,/checkAvailability\(film,signal,token\)\.then/);
 assert.match(source,/window.addEventListener\('pagehide',saveVisibleProgress\)/);
 assert.match(source,/film.manualLine/);
});
test('background line expansion deduplicates sources before its cap and stays at two requests',async()=>{
 const calls=[];let active=0,peak=0;
 const context=vm.createContext({probeLines(){},candidateSearches:new Map(),generation:2,data:{detail:async item=>{
   active++;peak=Math.max(peak,active);calls.push(item.source_code);await Promise.resolve();active--;
   return {lines:[{key:item.source_code,sourceKey:item.source_code}]};
 }}});
 vm.runInContext(source.slice(source.indexOf('  async function addOtherLines('),source.indexOf('  let lineTransfer=')),context);
 const film={id:'film',lines:[{key:'existing',sourceKey:'existing'}],candidates:[
   {source_code:'existing'},...Array.from({length:12},()=>({source_code:'repeat'})),
   ...Array.from({length:24},(_,i)=>({source_code:'candidate-'+i}))
 ]};
 await context.addOtherLines(film,{aborted:false},1);
 assert.equal(calls.length,20);
 assert.equal(new Set(calls).size,20);
 assert.ok(calls.includes('candidate-18'));
 assert.ok(!calls.includes('existing'));
 assert.equal(peak,2);
});
test('compact routes show current source without internal flags and preserve line identity',()=>{
 const context=vm.createContext({esc:String});
 vm.runInContext(source.slice(source.indexOf('  function rankedLines('),source.indexOf('  async function addOtherLines(')),context);
 const html=context.routeButtons({lineIndex:1,lines:[{name:'360资源',label:'360ZY',health:'fast'},{name:'电影天堂',label:'dyttm3u8',health:'slow'}]});
 assert.match(html,/当前 电影天堂/);
 assert.match(html,/2 条/);
 assert.doesNotMatch(html,/360ZY|dyttm3u8/);
 assert.match(html,/data-live-line="1" aria-pressed="true"/);
 assert.match(context.routeButtons({lines:[]}),/暂无片源/);
});

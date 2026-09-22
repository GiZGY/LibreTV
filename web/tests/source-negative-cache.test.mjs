import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  async function resolveFilm('),source.indexOf('  function refreshDetailText('));
function fixture(statuses=['no_result']){
 let clock=1000,calls=0;const store={};
 const c=vm.createContext({Date:{now:()=>clock},data:{sources:()=>['a'],text:x=>x,allowed:()=>true},load:(key,fallback)=>store[key]||fallback,save:(key,value)=>store[key]=value,detailTasks:new Map(),candidateSearches:new Map(),searchFilms:async()=>{calls++;return {results:[],statuses}}});
 vm.runInContext(fn,c);return {run:(force=false)=>c.resolveFilm({id:'film-a',name:'中文',year:2024},new AbortController().signal,force),calls:()=>calls,tick:()=>clock+=3600001};
}
test('no-result cache suppresses repeats and expires after one hour',async()=>{
 const h=fixture();await assert.rejects(h.run(),{code:'no_result'});await assert.rejects(h.run(),{code:'no_result'});assert.equal(h.calls(),1);
 h.tick();await assert.rejects(h.run(),{code:'no_result'});assert.equal(h.calls(),2);
});
test('timeouts never become a confirmed no-result cache',async()=>{
 const h=fixture(['timeout']);await assert.rejects(h.run());await assert.rejects(h.run());assert.equal(h.calls(),2);
});

test('explicit retry bypasses an otherwise fresh missing-source cache',async()=>{const h=fixture();await assert.rejects(h.run());await assert.rejects(h.run(true));assert.equal(h.calls(),2);});

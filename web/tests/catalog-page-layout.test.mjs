import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source=fs.readFileSync(new URL('../live-data.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  async function discoverTMDB'),source.indexOf('  async function discover({'));
function fixture(total){
 const context=vm.createContext({crypto:webcrypto,discoveryGenerations:new Map(),allowed:()=>true,catalogRequest:async({page,pageSize,filtered})=>{
  assert.equal(filtered,'1');const size=Number(pageSize),start=(Number(page)-1)*size;
  return {filtered:true,items:Array.from({length:Math.max(0,Math.min(size,total-start))},(_,i)=>({id:start+i})),total,totalPages:Math.ceil(total/size),hasNext:Number(page)<Math.ceil(total/size)};
 }});
 vm.runInContext(fn,context);return context.discoverTMDB;
}
test('40-title pages have no skips or duplicates and only the final page is partial',async()=>{
 for(const pageSize of [40]){
  const discover=fixture(203),seen=[];
  for(let page=1;page<=Math.ceil(203/pageSize);page++){
   const result=await discover({page,pageSize});
   assert.equal(result.items.length,Math.min(pageSize,203-(page-1)*pageSize));
   assert.equal(result.totalPages,Math.ceil(203/pageSize));
   assert.equal(result.hasNext,page<result.totalPages);
   seen.push(...result.items.map(x=>x.id));
  }
  assert.deepEqual(seen,Array.from({length:203},(_,i)=>i));
 }
});
test('catalog fills the available width with fixed gutters and divisors of 40',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/#discovery-cards \.poster-grid\{[^}]*gap:24px 16px;grid-template-columns:repeat\(var\(--catalog-columns\),minmax\(0,1fr\)\)/);
 const columns=[...css.matchAll(/--catalog-columns:(\d+)/g)].map(match=>Number(match[1]));
 assert.deepEqual(columns,[2,4,5,8,10]);
 for(const count of columns)assert.equal(40%count,0);
 assert.doesNotMatch(css,/\.poster-grid\{[^}]*justify-content:space-between/);
});
test('catalog policy changes invalidate browser URLs without clearing user storage',()=>{
 assert.match(source,/new URLSearchParams\(\{\.\.\.params,policy:'2026-09-22-latest-v1'\}\)/);
 assert.doesNotMatch(source,/localStorage\.clear\(/);
});
test('year filter covers exactly the indexed catalogue range from 1990 onward',()=>{
 assert.match(ui,/currentYear-1990\+1/);
 assert.doesNotMatch(ui,/length:40/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilteredCatalog,catalogItemAllowed} from '../server/filtered-catalog.mjs';
const now=()=>360000000;
const normalize=q=>({url:new URL('https://fixture.test/'+(q.genre||'all'))});
const item=id=>({id:'movie:'+id,title:'电影'+id,rate:'7.0',type_name:'电影'});
function make(list,options={}){
 let reads=0;const shared=new Map();
 const args={now,normalize,readPage:async q=>{reads++;const page=Number(q.page);return {items:list.slice((page-1)*20,page*20),total:list.length,hasNext:page*20<list.length};},sharedCache:{get:async k=>shared.get(k),set:async(k,v)=>shared.set(k,structuredClone(v))},...options};
 return {query:createFilteredCatalog(args),args,reads:()=>reads};
}
test('filter first, then immutable 40-item pages with no omissions or overlap',async()=>{
 const list=Array.from({length:100},(_,i)=>({...item(i+1),rate:i%10===0?'4.0':'7.0'}));
 const {query,reads}=make(list);const a=await query({page:1});assert.equal(a.items.length,40);assert.equal(a.totalPages,null);assert.equal(a.hasNext,true);
 const b=await query({page:2});const c=await query({page:3});assert.equal(b.items.length,40);assert.equal(c.items.length,10);assert.equal(c.totalPages,3);assert.equal(c.hasNext,false);
 assert.deepEqual([...a.items,...b.items,...c.items].map(x=>x.id),list.filter(catalogItemAllowed).map(x=>x.id));
 const count=reads();list.reverse();assert.deepEqual(await query({page:1}),a);assert.equal(reads(),count);
});
test('remove duplicate IDs across upstream boundaries, preserve unrated titles',async()=>{
 const list=Array.from({length:80},(_,i)=>item(i+1));list[20]=list[19];list[30].rate='';list[40].title='Foreign title';
 const {query}=make(list);const a=await query({page:1}),b=await query({page:2});assert.equal(a.items.length,40);assert.equal(b.items.length,38);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,78);
});
test('last exact full page has no false next page',async()=>{
 const {query}=make(Array.from({length:40},(_,i)=>item(i)));const p=await query({});assert.equal(p.items.length,40);assert.equal(p.hasNext,false);assert.equal(p.totalPages,1);
});
test('100 same-page callers share one bounded scan and shared cache survives new service',async()=>{
 const {query,args,reads}=make(Array.from({length:100},(_,i)=>item(i)));
 const all=await Promise.all(Array.from({length:100},()=>query({page:1})));assert.ok(all.every(x=>x.items.length===40));assert.equal(reads(),3);
 await createFilteredCatalog(args)({page:1});assert.equal(reads(),3);
});
test('heavy filtering checkpoints work, never returns a fake short intermediate page',async()=>{
 const list=Array.from({length:180},(_,i)=>({...item(i),title:i<130?'Foreign':('电影'+i)}));
 const {query,reads}=make(list);await assert.rejects(query({page:1}),e=>e.status===503);assert.equal(reads(),6);
 const first=await query({page:1});assert.equal(first.items.length,40);assert.equal(reads(),9);const last=await query({page:2});assert.equal(last.items.length,10);
});
test('invalid requests and expired generation fail explicitly',async()=>{
 const {query}=make([]);for(const q of [{page:0},{page:-1},{pageSize:41},{generation:0}])await assert.rejects(query(q));
});
test('upstream error is not cached as end of catalog',async()=>{
 let broken=true;const list=Array.from({length:60},(_,i)=>item(i));const {query}=make(list,{readPage:async q=>{if(broken)throw Error('network');const page=Number(q.page);return {items:list.slice((page-1)*20,page*20),total:60,hasNext:page<3};}});
 await assert.rejects(query({}));broken=false;assert.equal((await query({})).items.length,40);
});
test('forward pagination survives local cache eviction without restarting from page one',async()=>{
 const {query}=make(Array.from({length:2400},(_,i)=>item(i)),{sharedCache:null});
 let page;for(let i=1;i<=55;i++){page=await query({page:i});assert.equal(page.items.length,40);assert.equal(page.items[0].id,'movie:'+((i-1)*40));}
 assert.equal(page.hasNext,true);await assert.rejects(query({page:1}),e=>e.status===410);
});

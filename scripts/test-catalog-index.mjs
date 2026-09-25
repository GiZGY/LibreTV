import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createIndexReader,indexQuery} from '../server/catalog-index.mjs';
import {createSyncStore,syncBatch,initialCursor,splitWindow,indexEntry,tmdbSyncRequest} from '../server/catalog-sync.mjs';
import {createCatalogHandler} from '../api/catalog/tmdb.mjs';

const db=new PGlite();
await db.exec(await readFile(new URL('../server/catalog-schema.sql',import.meta.url),'utf8'));
const query=async(text,values)=>(await db.query(text,values)).rows;
const store=createSyncStore(query);
const raw=(id,year=2005,extra={})=>({id,title:'测试电影'+id,release_date:year+'-01-02',genre_ids:[878],origin_country:['US'],vote_average:7.2,vote_count:100,popularity:100-id,poster_path:'/test.jpg',...extra});
test.after(()=>db.close());

test('default coverage starts in 1990; narrowing preserves progress and rejects stale writers',async()=>{
  assert.equal(initialCursor({to:2026,today:'2026-09-24'}).queue.length,74);
  const local=new PGlite();
  try{
    await local.exec(await readFile(new URL('../server/catalog-schema.sql',import.meta.url),'utf8'));
    const execute=async(sql,values)=>(await local.query(sql,values)).rows;
    const scoped=createSyncStore(execute);
    let state=await scoped.begin({from:1888,to:2026});
    state=await scoped.checkpoint(state,{...state.cursor,pages:42},[indexEntry(raw(500,2025),'movie')]);
    const next=await scoped.narrow(state);
    assert.equal(next.coverage.from,1990);assert.equal(next.cursor.pages,42);
    assert.equal(next.cursor.queue.length,74);
    assert.equal((await execute('SELECT count(*)::int AS n FROM catalog_entries'))[0].n,1);
    await assert.rejects(scoped.checkpoint(state,state.cursor,[]),{status:409});
    await assert.rejects(scoped.narrow(next,2026),{status:409});
    await assert.rejects(scoped.publish(next),{status:409});
  }finally{await local.close();}
});

test('real PostgreSQL: exact counts, filters, final page and stable snapshot',async()=>{
  let state=await store.begin({from:2005,to:2006,today:'2026-09-24'});
  const entries=Array.from({length:85},(_,i)=>indexEntry(raw(i+1,i<41?2005:2006),'movie'));
  entries.push(indexEntry(raw(100,2005,{genre_ids:[99],origin_country:['CN']}),'movie'));
  entries.push(indexEntry(raw(101,2005,{vote_count:0,vote_average:0}),'movie'));
  state=await store.checkpoint(state,{...state.cursor,queue:[],items:[],complete:true},entries);
  await store.publish(state);
  const read=createIndexReader({query});
  const first=await read({year:'2005',pageSize:40});
  assert.equal(first.total,42);assert.equal(first.totalPages,2);assert.equal(first.items.length,40);
  const second=await read({year:'2005',page:2,pageSize:40,revision:first.revision});
  assert.equal(second.items.length,2);assert.equal(second.hasNext,false);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,42);
  assert.equal((await read({year:'2006'})).total,44);
  assert.equal((await read({year:'2005',region:'中国大陆'})).total,0);
  assert.equal((await read({year:'2005',type:'纪录片'})).total,1);
  assert.equal((await read({year:'2005',sort:'最新上映'})).total,41);
  assert.equal((await read({year:'2005',sort:'评分最高'})).total,41);
  await assert.rejects(read({year:'2005',page:3}),{status:404});
  let next=await store.begin({from:2005,to:2006,today:'2026-09-24'});
  next=await store.checkpoint(next,{...next.cursor,queue:[],items:[],complete:true},[indexEntry(raw(999),'movie')]);
  await store.publish(next);
  assert.equal((await createIndexReader({query})({year:'2005',revision:first.revision})).total,42);
  assert.equal((await createIndexReader({query})({year:'2005'})).total,1);
});

test('CAS prevents competing workers writing data; draft cannot publish',async()=>{
  const state=await store.begin({from:2005,to:2005});
  await assert.rejects(store.publish(state),{status:409});
  await store.checkpoint(state,state.cursor,[indexEntry(raw(201),'movie')]);
  await assert.rejects(store.checkpoint(state,state.cursor,[indexEntry(raw(202),'movie')]),{status:409});
  assert.equal((await query('SELECT count(*)::int AS n FROM catalog_entries WHERE revision=$1',[state.id]))[0].n,1);
});

test('100 identical reads coalesce; shared cache reused across instances; outages recover',async()=>{
  let calls=0;const saved=new Map();
  const remote={get:async key=>saved.get(key),set:async(key,value)=>saved.set(key,value)};
  const execute=async()=>{calls++;return [{revision:'1',total:0,items:[]}];};
  const read=createIndexReader({query:execute,sharedCache:remote});
  await Promise.all(Array.from({length:100},()=>read({year:'2005'})));assert.equal(calls,1);
  await createIndexReader({query:execute,sharedCache:remote})({year:'2005'});assert.equal(calls,1);
  await read({year:'2006'});assert.equal(calls,2);
  const retry=createIndexReader({query:async()=>{if(++calls===3)throw Error('offline');return execute();}});
  await assert.rejects(retry({}));assert.equal((await retry({})).total,0);
});

test('validation excludes SQL injection and missing index is never empty success',async()=>{
  for(const params of [{year:'2005 OR 1=1'},{region:'xx'},{revision:'1;DROP TABLE x'},{page:0},{pageSize:100}])assert.throws(()=>indexQuery(params));
  const read=createIndexReader({query:async()=>[]});
  await assert.rejects(read({}),{status:503});await assert.rejects(read({revision:'999'}),{status:410});
});

test('index content policy keeps unrated, rejects low score, foreign-only and adult',()=>{
  assert.equal(indexEntry(raw(1,2005,{vote_average:4.99}),'movie'),null);
  assert.equal(indexEntry(raw(1,2005,{title:'Foreign Film'}),'movie'),null);
  assert.equal(indexEntry(raw(1,2005,{adult:true}),'movie'),null);
  assert.equal(indexEntry(raw(1,2005,{vote_count:0,vote_average:0}),'movie').score,null);
  assert.equal(indexEntry(raw(1,2005,{release_date:'2005-02-31'}),'movie'),null);
  assert.equal(indexEntry(raw(1,2005,{vote_count:Infinity}),'movie'),null);
});

test('parallel metadata work is bounded and checkpoint waits for all requests',async()=>{
  let active=0,peak=0,checkpoint;
  const cursor={queue:[],items:Array.from({length:8},(_,i)=>{const value=raw(i+1);delete value.origin_country;return {raw:value,media:'movie'};}),requests:0,pages:1,complete:false};
  const fake={capacity:async()=>0,checkpoint:async(state,cursor,entries)=>{
    assert.equal(active,0);return checkpoint={...state,cursor,entries};
  }};
  let calls=0;
  await assert.rejects(syncBatch({store:fake,state:{id:'1',version:0,cursor},maxRequests:4,request:async url=>{
    calls++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    const id=Number(url.pathname.split('/').at(-1));
    if(id===2)throw Object.assign(Error('retry'),{status:504});
    return {id,origin_country:['US']};
  }}),{status:504});
  assert.equal(calls,4);assert.equal(peak,4);assert.equal(checkpoint.entries.length,1);
  assert.equal(checkpoint.cursor.items[0].raw.id,2);assert.equal(checkpoint.cursor.items.length,7);
});

test('date partitions are contiguous, leap-day safe and never silently truncate',()=>{
  const parts=splitWindow({media:'movie',start:'2000-01-01',end:'2000-12-31',page:1});
  assert.equal(Date.parse(parts[1].start)-Date.parse(parts[0].end),86400000);
  assert.equal(parts[0].start,'2000-01-01');assert.equal(parts[1].end,'2000-12-31');
  assert.throws(()=>splitWindow({start:'2000-01-01',end:'2000-01-01'}));
});

test('sync resumes after upstream error, budget is bounded and never publishes partial data',async()=>{
  let checkpoint;const fake={capacity:async()=>0,checkpoint:async(state,cursor,entries)=>(checkpoint={...state,cursor,entries,version:state.version+1})};
  let state={id:'1',version:0,cursor:initialCursor({from:2005,to:2005})};
  const result=await syncBatch({store:fake,state,maxRequests:2,request:async()=>({results:[raw(1)],total_pages:1})});
  assert.ok(result.batchRequests<=2);assert.equal(result.cursor.pages,1);assert.equal(result.cursor.complete,false);
  state=checkpoint;
  await assert.rejects(syncBatch({store:fake,state,maxRequests:2,request:async()=>{throw Object.assign(Error('rate limit'),{status:429});}}),{status:429});
  assert.equal(checkpoint.cursor.complete,false);assert.equal(checkpoint.cursor.pages,1);
});

test('country lookup failure retains pending item instead of permanently losing its region',async()=>{
  const r=raw(1);delete r.origin_country;
  let retained;const fake={capacity:async()=>0,checkpoint:async(state,cursor)=>(retained={...state,cursor})};
  const cursor={queue:[],items:[{raw:r,media:'movie'}],requests:0,pages:1,complete:false};
  await assert.rejects(syncBatch({store:fake,state:{id:'1',version:0,cursor},request:async()=>{throw Object.assign(Error('offline'),{status:504});}}),{status:504});
  assert.equal(retained.cursor.items.length,1);assert.equal(retained.cursor.complete,false);
});

test('a confirmed deleted upstream film does not stall the entire import',async()=>{
  const item=raw(1);delete item.origin_country;
  const cursor={queue:[],items:[{raw:item,media:'movie'}],requests:0,pages:1,complete:false};
  const fake={capacity:async()=>0,checkpoint:async(state,cursor,entries)=>({...state,cursor,entries})};
  const result=await syncBatch({store:fake,state:{id:'1',version:0,cursor},request:async()=>{throw Object.assign(Error('deleted'),{status:404});}});
  assert.equal(result.cursor.complete,true);assert.equal(result.entries.length,0);
});

test('request stays on TMDB and does not expose credentials in failures',async()=>{
  const request=tmdbSyncRequest({token:'secret-test-value',fetchImpl:async()=>{throw Error('secret-test-value');}});
  await assert.rejects(request(new URL('https://api.themoviedb.org/3/discover/movie')),error=>error.status===504&&!error.message.includes('secret-test-value'));
  await assert.rejects(request(new URL('https://127.0.0.1')),{status:400});
});

test('indexed API never reads database before human verification',async()=>{
  const values={CATALOG_INDEX_ENABLED:'1',TURNSTILE_ENABLED:'true',TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'x'.repeat(32),TURNSTILE_HOSTNAMES:'example.com'};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
  let calls=0;
  try{
    const handler=createCatalogHandler({indexReader:async()=>{calls++;return {items:[]};}});
    const res={headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'GET',headers:{},query:{kind:'discover'}},res);
    assert.equal(res.code,428);assert.equal(calls,0);assert.equal(res.headers['Cache-Control'],'private, no-store');
  }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createSyncStore,indexEntry} from '../server/catalog-sync.mjs';
import {createRefreshStore,refreshCursor,refreshBatch} from '../server/catalog-refresh.mjs';
import {createIndexReader} from '../server/catalog-index.mjs';
const movie=(id,extra={})=>({id,title:'测试影片'+id,release_date:'2026-01-01',genres:[{id:878}],origin_country:['CN'],vote_average:7,vote_count:100,...extra});

test('bounded change interval, rollover and never skip a missing interval',()=>{
  const base={id:'1',coverage:{from:1990,to:2026,through:'2026-12-31'}};
  const c=refreshCursor(base,'2027-01-02');assert.equal(c.from,'2026-12-31');assert.equal(c.through,'2027-01-01');
  assert.equal(refreshCursor(base,'2026-12-31'),null);
  const daily=refreshCursor({...base,cursor:{mode:'delta'}},'2027-01-02');assert.equal(daily.from,'2027-01-01');
  assert.throws(()=>refreshCursor(base,'2027-02-01'),{status:409});
});

test('refresh capacity guard stops before creating a new revision',async()=>{
  const calls=[];
  const query=async sql=>{
    calls.push(sql);
    if(sql.includes("WHERE status='draft'"))return [];
    if(sql.includes("WHERE status='ready'"))return [{id:'1',coverage:{from:1990,to:2026,through:'2026-09-23'}}];
    if(sql.includes('mod(tmdb_id'))return [];
    if(sql.includes('pg_database_size'))return [{used:340*1024*1024,entries:100*1024*1024,total_rows:1000,base_rows:1000}];
    throw Error('Unexpected write');
  };
  await assert.rejects(createRefreshStore(query).beginRefresh('2026-09-25'),{status:507});
  assert.equal(calls.some(sql=>sql.includes('INSERT')),false);
});

test('real PostgreSQL refresh is atomic, rechecks exclusions, preserves pins and prunes safely',async()=>{
  const db=new PGlite();const q=async(sql,v)=>(await db.query(sql,v)).rows;
  try{
    await db.exec(await readFile(new URL('../server/catalog-schema.sql',import.meta.url),'utf8'));
    const full=createSyncStore(q),store=createRefreshStore(q);
    let base=await full.begin({from:1990,to:2026,today:'2026-09-23'});
    await assert.rejects(store.beginRefresh('2026-09-25'),{status:409});
    base=await full.checkpoint(base,{...base.cursor,queue:[],items:[],complete:true},[1,2,3].map(id=>indexEntry({...movie(id),genre_ids:[878]},'movie')));
    await full.publish(base);
    let state=await store.beginRefresh('2026-09-25');
    assert.equal((await store.beginRefresh('2026-09-25')).id,state.id);
    await assert.rejects(full.begin(),{status:409});
    await assert.rejects(store.publishRefresh(state),{status:409});
    let failed=false;
    const request=async url=>{
      if(url.pathname.endsWith('/changes')||url.pathname.includes('/discover/'))return {total_pages:1,results:url.pathname.includes('movie')?[{id:1},{id:2},{id:3},{id:4},{id:5}]:[]};
      const id=Number(url.pathname.split('/').at(-1));
      if(id===2&&!failed){failed=true;throw Object.assign(Error('transient'),{status:504});}
      if(id===3)throw Object.assign(Error('deleted'),{status:404});
      return movie(id,id===1?{title:'更新片名',vote_average:8}:id===2?{vote_average:4}:id===5?{title:'Foreign',translations:{translations:[{iso_639_1:'zh',iso_3166_1:'CN',data:{title:'新增中文片名'}}]}}:{});
    };
    await assert.rejects(refreshBatch({store,state,request,maxRequests:20}),{status:504});
    state=await store.load(state.id);
    assert.equal((await createIndexReader({query:q})({})).total,3);
    for(let i=0;i<20&&!state.cursor.complete;i++)state=await refreshBatch({store,state,request,maxRequests:20});
    assert.equal(state.cursor.complete,true);await store.publishRefresh(state);
    const current=await createIndexReader({query:q})({});
    assert.deepEqual(current.items.map(x=>x.id).sort(),['movie:1','movie:4','movie:5']);
    assert.equal((await createIndexReader({query:q})({revision:base.id})).total,3);
    assert.equal(await store.beginRefresh('2026-09-24'),null);
    await assert.rejects(store.publishRefresh(state),{status:409});
    // Retain the latest three snapshots, recent readers, and the draft's base.
    for(let i=0;i<4;i++){
      const [r]=await q(`INSERT INTO catalog_revisions(status,coverage,cursor,published_at) VALUES('ready',$1::jsonb,'{}',now()-interval '4 days') RETURNING id::text`,[JSON.stringify(base.coverage)]);
      await q('INSERT INTO catalog_entries SELECT $1::bigint,media,tmdb_id,year,release_date,genres,countries,score,votes,popularity,payload FROM catalog_entries WHERE revision=$2::bigint',[r.id,base.id]);
    }
    const removed=await store.prune();assert.equal(removed.length,1);
    assert.equal((await q('SELECT count(*)::int n FROM catalog_entries WHERE revision=$1',[removed[0].id]))[0].n,0);
    assert.equal((await q('SELECT count(*)::int n FROM catalog_revisions'))[0].n,5);
  }finally{await db.close();}
});

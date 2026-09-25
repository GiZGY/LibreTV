import {CATALOG_START_YEAR,createSyncStore,indexEntry,syncUrl} from './catalog-sync.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const day=86400000;
const date=value=>new Date(value).toISOString().slice(0,10);

export function refreshCursor(base,today=date(Date.now())){
  const watermark=base.coverage.through;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(watermark||'')||Date.parse(watermark)>Date.parse(today))throw fail(409,'目录更新日期无效');
  const start=base.cursor?.mode==='delta'?date(Date.parse(watermark)+day):watermark;
  // Initial scans include an unfinished day; incremental snapshots cover full days.
  const end=date(Date.parse(today)-day);
  if(start>end)return null;
  if(Date.parse(end)-Date.parse(start)>13*day)throw fail(409,'增量窗口已过期，需要恢复目录同步');
  return {mode:'delta',base:base.id,from:start,through:end,queue:['movie','tv'].flatMap(media=>[{media,page:1,kind:'changes'},{media,page:1,kind:'releases'}]),items:[],pages:0,requests:0,complete:false};
}

export function createRefreshStore(query){
  const store=createSyncStore(query);
  return {...store,
    async beginRefresh(today=date(Date.now())){
      const [draft]=await query("SELECT id::text,version,cursor,coverage FROM catalog_revisions WHERE status='draft'");
      if(draft){if(draft.cursor.mode!=='delta')throw fail(409,'首轮目录仍在导入');return draft;}
      const [base]=await query("SELECT id::text,coverage,cursor FROM catalog_revisions WHERE status='ready' ORDER BY id DESC LIMIT 1");
      if(!base)throw fail(503,'完整目录尚未发布');
      const cursor=refreshCursor(base,today);if(!cursor)return null;
      // Scores/popularity need not appear in the change feed. Refresh a daily shard.
      cursor.items=await query('SELECT media,tmdb_id::float8 AS id FROM catalog_entries WHERE revision=$1::bigint AND mod(tmdb_id,30)=$2 ORDER BY media,tmdb_id',[base.id,Math.floor(Date.parse(today)/day)%30]);
      const [size]=await query(`SELECT pg_database_size(current_database())::float8 AS used,
        pg_total_relation_size('catalog_entries')::float8 AS entries,
        (SELECT count(*)::float8 FROM catalog_entries) AS total_rows,
        (SELECT count(*)::float8 FROM catalog_entries WHERE revision=$1::bigint) AS base_rows`,[base.id]);
      const copyEstimate=Number(size.entries)*Number(size.base_rows)/Math.max(1,Number(size.total_rows))*1.25;
      if(Number(size.used)+copyEstimate>350*1024*1024)throw fail(507,'没有足够空间安全创建更新快照');
      const coverage={...base.coverage,to:Number(today.slice(0,4)),through:cursor.through};
      const rows=await query(`WITH draft AS (
        INSERT INTO catalog_revisions(coverage,cursor) VALUES($1::jsonb,$2::jsonb)
        ON CONFLICT(status) WHERE status='draft' DO NOTHING RETURNING id,version,cursor,coverage
      ), copied AS (
        INSERT INTO catalog_entries SELECT draft.id,e.media,e.tmdb_id,e.year,e.release_date,e.genres,e.countries,e.score,e.votes,e.popularity,e.payload
        FROM catalog_entries e,draft WHERE e.revision=$3::bigint
      ) SELECT id::text,version,cursor,coverage FROM draft`,[JSON.stringify(coverage),JSON.stringify(cursor),base.id]);
      if(!rows.length)throw fail(409,'其他更新任务已启动');return rows[0];
    },
    async publishRefresh(state){
      if(state.cursor.mode!=='delta'||state.coverage.through!==state.cursor.through)throw fail(409,'更新快照无效');
      return store.publish(state);
    },
    async prune(){
      // Keep three rollback generations and at least 72h, well beyond browser pins.
      return query(`WITH candidates AS (
        SELECT id FROM catalog_revisions WHERE status='ready' AND published_at<now()-interval '72 hours'
        AND id NOT IN(SELECT id FROM catalog_revisions WHERE status='ready' ORDER BY id DESC LIMIT 3)
        AND id NOT IN(SELECT (cursor->>'base')::bigint FROM catalog_revisions WHERE status='draft' AND cursor ? 'base')
      ), removed AS (
        DELETE FROM catalog_entries WHERE revision IN(SELECT id FROM candidates) RETURNING revision
      ) DELETE FROM catalog_revisions WHERE id IN(SELECT id FROM candidates)
        AND (SELECT count(*) FROM removed)>=0 RETURNING id::text`);
    }
  };
}

export async function refreshBatch({store,state,request,maxRequests=100,maxMs=45000,now=Date.now}){
  if(state.cursor.mode!=='delta'||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>200)throw fail(400,'增量任务参数无效');
  const cursor=structuredClone(state.cursor),changes=new Map(),deadline=now()+maxMs;
  let requests=0,failure;
  const read=async url=>{requests++;cursor.requests++;return request(url);};
  try{
    await store.capacity();
    while(requests<maxRequests&&now()<deadline){
      if(cursor.items.length){
        const group=cursor.items.slice(0,Math.min(4,maxRequests-requests));
        const results=await Promise.allSettled(group.map(async item=>{
          const url=new URL(`https://api.themoviedb.org/3/${item.media}/${item.id}?language=zh-CN&append_to_response=translations`);
          let raw;
          try{raw=await read(url);}catch(error){if(error.status===404)return null;throw error;}
          if(raw.id!==item.id)throw fail(502,'增量影片编号不匹配');
          if(item.media==='movie'&&raw.video===true)return null;
          const release=raw.release_date||raw.first_air_date;
          if(!release||release<`${CATALOG_START_YEAR}-01-01`||release>cursor.through)return null;
          return indexEntry({...raw,genre_ids:(raw.genres||[]).map(g=>g.id),origin_country:raw.origin_country||(raw.production_countries||[]).map(c=>c.iso_3166_1)},item.media);
        }));
        for(const result of results){
          if(result.status==='rejected')throw result.reason;
          const item=cursor.items.shift();changes.set(item.media+':'+item.id,{entry:result.value,media:item.media,tmdb_id:item.id});
        }
        continue;
      }
      const task=cursor.queue[0];if(!task){cursor.complete=true;break;}
      const url=task.kind==='releases'?syncUrl({...task,start:cursor.from,end:cursor.through}):new URL(`https://api.themoviedb.org/3/${task.media}/changes`);
      if(task.kind!=='releases')Object.entries({start_date:cursor.from,end_date:cursor.through,page:task.page}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
      const data=await read(url);
      if(!Array.isArray(data.results)||!Number.isInteger(data.total_pages)||data.total_pages<0||data.results.some(r=>!Number.isSafeInteger(r.id)||r.id<1))throw fail(502,'增量目录格式异常');
      if(task.kind==='releases'&&data.total_pages>500)throw fail(409,'新片窗口超过上游分页限制');
      cursor.items=[...new Set(data.results.map(r=>r.id))].map(id=>({id,media:task.media}));cursor.pages++;
      if(task.page>=data.total_pages)cursor.queue.shift();else task.page++;
    }
    if(!cursor.queue.length&&!cursor.items.length)cursor.complete=true;
  }catch(error){failure=error;}
  const all=[...changes.values()];
  const next=await store.checkpoint(state,cursor,all.filter(x=>x.entry).map(x=>x.entry),all.filter(x=>!x.entry).map(({media,tmdb_id})=>({media,tmdb_id})));
  if(failure)throw failure;
  return {...next,batchRequests:requests,batchEntries:all.length};
}

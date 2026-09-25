import {normalizeCatalog,preferredTitle} from './tmdb-catalog.mjs';
import {catalogItemAllowed} from './filtered-catalog.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const day=86400000;
export const CATALOG_START_YEAR=1990;
export function initialCursor({from=CATALOG_START_YEAR,to=new Date().getUTCFullYear(),today=new Date().toISOString().slice(0,10)}={}){
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1888||to<from||to>Number(today.slice(0,4)))throw fail(400,'同步年份无效');
  const queue=[];
  for(let year=to;year>=from;year--)for(const media of ['movie','tv'])queue.push({media,start:`${year}-01-01`,end:year===Number(today.slice(0,4))?today:`${year}-12-31`,page:1});
  return {queue,items:[],pages:0,requests:0,complete:false};
}

export function splitWindow(task){
  const start=Date.parse(task.start),end=Date.parse(task.end);
  if(start>=end)throw fail(502,'单日目录超出上游分页上限，不能发布不完整目录');
  const middle=start+Math.floor((end-start)/day/2)*day;
  return [{...task,end:new Date(middle).toISOString().slice(0,10),page:1},
    {...task,start:new Date(middle+day).toISOString().slice(0,10),page:1}];
}

export function syncUrl(task,language='zh-CN'){
  const url=new URL('https://api.themoviedb.org/3/discover/'+task.media);
  const date=task.media==='movie'?'primary_release_date':'first_air_date';
  Object.entries({language,include_adult:'false',sort_by:date+'.asc',page:String(task.page),[date+'.gte']:task.start,[date+'.lte']:task.end}).forEach(([key,value])=>url.searchParams.set(key,value));
  if(task.media==='movie')url.searchParams.set('include_video','false');
  return url;
}

export function indexEntry(raw,media){
  if(raw.adult===true||!Number.isSafeInteger(raw.id)||raw.id<=0)return null;
  const score=Number(raw.vote_average),votes=Number(raw.vote_count)||0;
  if(!Number.isSafeInteger(votes)||votes<0)return null;
  if(votes>0&&(!Number.isFinite(score)||score<5))return null;
  const release=raw.release_date||raw.first_air_date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(release||'')||!Number.isFinite(Date.parse(release))||new Date(release).toISOString().slice(0,10)!==release)return null;
  const item=normalizeCatalog({results:[raw],total_pages:1,total_results:1},{media,type:media==='movie'?'电影':'电视剧',page:1}).items[0];
  if(!item||!catalogItemAllowed(item))return null;
  // Descriptions and credits remain on the detail endpoint, not every index row.
  delete item.vod_content;
  return {media,tmdb_id:raw.id,year:Number(release.slice(0,4)),release_date:release,
    genres:(raw.genre_ids||[]).filter(id=>Number.isSafeInteger(id)&&id>0),countries:(raw.origin_country||[]).filter(code=>/^[A-Z]{2}$/.test(code)),score:votes?score:null,
    votes,popularity:Number.isFinite(Number(raw.popularity))?Number(raw.popularity):0,payload:item};
}

export function createSyncStore(query){
  return {
    async load(id){
      const [state]=await query("SELECT id::text,cursor,version,coverage FROM catalog_revisions WHERE id=$1::bigint AND status='draft'",[id]);
      if(!state)throw fail(409,'同步目录状态已变化');
      return state;
    },
    async begin(options){
      const cursor=initialCursor(options),coverage={from:options?.from||CATALOG_START_YEAR,to:options?.to||new Date().getUTCFullYear(),through:options?.today||new Date().toISOString().slice(0,10)};
      const [row]=await query(`INSERT INTO catalog_revisions(coverage,cursor) VALUES($1::jsonb,$2::jsonb)
        ON CONFLICT(status) WHERE status='draft' DO UPDATE SET status='draft'
        RETURNING id::text,cursor,version,coverage`,[JSON.stringify(coverage),JSON.stringify(cursor)]);
      if(row.cursor.mode==='delta')throw fail(409,'增量任务进行中，不能启动全量导入');
      return row;
    },
    async narrow(state,from=CATALOG_START_YEAR){
      if(!Number.isInteger(from)||from<state.coverage.from||from>state.coverage.to)throw fail(400,'目录范围无效');
      const cursor=structuredClone(state.cursor);
      cursor.queue=cursor.queue.filter(task=>Number(task.end.slice(0,4))>=from).map(task=>({...task,start:task.start<`${from}-01-01`?`${from}-01-01`:task.start}));
      cursor.items=cursor.items.filter(({raw})=>Number((raw.release_date||raw.first_air_date||'').slice(0,4))>=from);
      cursor.complete=!cursor.queue.length&&!cursor.items.length;
      const rows=await query(`UPDATE catalog_revisions SET cursor=$3::jsonb,coverage=$4::jsonb,version=version+1
        WHERE id=$1::bigint AND version=$2 AND status='draft'
        AND NOT EXISTS(SELECT 1 FROM catalog_entries WHERE revision=$1::bigint AND year<$5)
        RETURNING id::text,cursor,coverage,version`,[state.id,state.version,JSON.stringify(cursor),JSON.stringify({...state.coverage,from}),from]);
      if(!rows.length)throw fail(409,'目录已变化或包含范围外数据，未修改');
      return rows[0];
    },
    async checkpoint(state,cursor,entries,removed=[]){
      // Version CAS and writes share one statement, so a losing worker writes nothing.
      const rows=await query(`WITH owner AS (
        UPDATE catalog_revisions SET cursor=$3::jsonb,version=version+1
        WHERE id=$1::bigint AND version=$2 AND status='draft' RETURNING id,version
      ), deleted AS (
        DELETE FROM catalog_entries e USING owner,jsonb_to_recordset($5::jsonb) AS x(media text,tmdb_id bigint)
        WHERE e.revision=owner.id AND e.media=x.media AND e.tmdb_id=x.tmdb_id
      ), inserted AS (
        INSERT INTO catalog_entries(revision,media,tmdb_id,year,release_date,genres,countries,score,votes,popularity,payload)
        SELECT owner.id,x.media,x.tmdb_id,x.year,x.release_date,x.genres,x.countries,x.score,x.votes,x.popularity,x.payload
        FROM owner,jsonb_to_recordset($4::jsonb) AS x(media text,tmdb_id bigint,year int,release_date date,genres int[],countries text[],score real,votes int,popularity real,payload jsonb)
        ON CONFLICT(revision,media,tmdb_id) DO UPDATE SET year=excluded.year,release_date=excluded.release_date,
          genres=excluded.genres,countries=excluded.countries,score=excluded.score,votes=excluded.votes,popularity=excluded.popularity,payload=excluded.payload
      ) SELECT version FROM owner`,[state.id,state.version,JSON.stringify(cursor),JSON.stringify(entries),JSON.stringify(removed)]);
      if(!rows.length)throw fail(409,'另一个同步任务已推进目录，请重新运行');
      return {...state,cursor,version:rows[0].version};
    },
    async publish(state){
      const rows=await query(`UPDATE catalog_revisions SET status='ready',published_at=now()
        WHERE id=$1::bigint AND version=$2 AND status='draft'
          AND cursor->>'complete'='true' AND jsonb_array_length(cursor->'queue')=0
          AND jsonb_array_length(cursor->'items')=0
          AND EXISTS(SELECT 1 FROM catalog_entries WHERE revision=$1::bigint)
        RETURNING id::text`,[state.id,state.version]);
      if(!rows.length)throw fail(409,'目录尚未完整，未发布');
      return rows[0];
    },
    async capacity(){
      const [row]=await query('SELECT pg_database_size(current_database())::float8 AS bytes');
      if(Number(row.bytes)>350*1024*1024)throw fail(507,'目录空间接近免费额度，已停止同步，现有目录不受影响');
      return Number(row.bytes);
    }
  };
}

export async function syncBatch({store,request,state,maxRequests=40,maxMs=45000,now=Date.now}){
  if(!Number.isInteger(maxRequests)||maxRequests<2||maxRequests>200)throw fail(400,'同步请求预算无效');
  const cursor=structuredClone(state.cursor),deadline=now()+maxMs;
  const entries=[];let requests=0,failure;
  const fetchJson=async url=>{requests++;cursor.requests++;return request(url);};
  try{
    await store.capacity();
    while(now()<deadline&&requests<maxRequests){
      if(cursor.items.length){
        const group=cursor.items.slice(0,Math.min(4,maxRequests-requests));
        const completed=await Promise.allSettled(group.map(async({raw,media})=>{
          const entry=indexEntry(raw,media);
          if(entry&&!Array.isArray(raw.origin_country)){
            let details;
            try{details=await fetchJson(new URL(`https://api.themoviedb.org/3/${media}/${raw.id}?language=zh-CN`));}
            catch(error){if(error.status===404)return null;throw error;}
            if(details.id!==raw.id)throw fail(502,'影片国家信息不匹配');
            entry.countries=(details.origin_country||(details.production_countries||[]).map(country=>country.iso_3166_1)).filter(code=>/^[A-Z]{2}$/.test(code));
          }
          return entry;
        }));
        // Only advance the contiguous successful prefix; failures remain retryable.
        for(const result of completed){
          if(result.status==='rejected')throw result.reason;
          if(result.value)entries.push(result.value);
          cursor.items.shift();
        }
        continue;
      }
      const task=cursor.queue[0];
      if(!task){cursor.complete=true;break;}
      if(maxRequests-requests<2)break;
      const count=task.totalPages?Math.min(4,task.totalPages-task.page+1,Math.floor((maxRequests-requests)/2)):1;
      const batches=await Promise.allSettled(Array.from({length:count},async(_,offset)=>{
        const pageTask={...task,page:task.page+offset};
        const raw=await fetchJson(syncUrl(pageTask));
        if(!Array.isArray(raw.results)||!Number.isInteger(raw.total_pages)||raw.total_pages<0)throw fail(502,'上游目录格式异常');
        if(raw.total_pages>500)return {overflow:true};
        let results=raw.results;
        if(results.some(item=>!/[\u3400-\u9fff]/.test(preferredTitle(item)))){
          const regional=await fetchJson(syncUrl(pageTask,'zh-TW'));
          if(!Array.isArray(regional.results))throw fail(502,'中文目录返回异常');
          const titles=new Map(regional.results.map(item=>[item.id,preferredTitle(item)]));
          results=results.map(item=>!/[\u3400-\u9fff]/.test(preferredTitle(item))&&titles.has(item.id)?{...item,title:titles.get(item.id)}:item);
        }
        return {results,totalPages:raw.total_pages};
      }));
      for(const batch of batches){
        if(batch.status==='rejected')throw batch.reason;
        const raw=batch.value;
        if(raw.overflow){
          if(task.page!==1)throw fail(409,'同步期间上游目录越界，保留旧目录');
          cursor.queue.splice(0,1,...splitWindow(task));break;
        }
        cursor.items.push(...raw.results.map(raw=>({raw,media:task.media})));cursor.pages++;
        task.totalPages=raw.totalPages;
        if(task.page>=raw.totalPages){cursor.queue.shift();break;}else task.page++;
      }
    }
    if(!cursor.queue.length&&!cursor.items.length)cursor.complete=true;
  }catch(error){failure=error;}
  const unique=[...new Map(entries.map(entry=>[entry.media+':'+entry.tmdb_id,entry])).values()];
  const next=await store.checkpoint(state,cursor,unique);
  if(failure)throw Object.assign(failure,{checkpoint:next.id});
  return {...next,batchRequests:requests,batchEntries:unique.length};
}

export function tmdbSyncRequest({token,fetchImpl=fetch}={}){
  if(!token)throw fail(503,'未配置 TMDB 凭据');
  let nextSlot=0;
  return async url=>{
    if(url.origin!=='https://api.themoviedb.org')throw fail(400,'同步地址无效');
    const slot=Math.max(Date.now(),nextSlot);nextSlot=slot+250;
    const delay=slot-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    let response;
    try{response=await fetchImpl(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw fail(504,'目录同步网络超时');}
    if(!response.ok)throw fail([404,429].includes(response.status)?response.status:502,'上游暂时不可用，进度已保留');
    try{return await response.json();}catch{throw fail(502,'上游目录格式异常');}
  };
}

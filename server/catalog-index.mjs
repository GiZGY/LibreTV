import {neon} from '@neondatabase/serverless';
import {createHash} from 'node:crypto';
import {catalogQuery, catalogRegions} from './tmdb-catalog.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
let connection;
export function catalogDatabase(env=process.env){
  const url=env.CATALOG_DATABASE_URL||env.CATALOG_POSTGRES_URL_NON_POOLING||env.CATALOG_POSTGRES_URL;
  if(!url)throw fail(503,'影片目录暂未就绪');
  if(!connection||connection.url!==url)connection={url,sql:neon(url)};
  const sql=connection.sql;
  // A fresh signal per request; a cached AbortSignal would permanently expire.
  return (text,values=[])=>sql.query(text,values,{fetchOptions:{signal:AbortSignal.timeout(10000)}});
}

export function indexQuery(query){
  const normalized=catalogQuery({...query,kind:'discover',page:'1'});
  const page=Number(query.page??1),size=Number(query.pageSize??40);
  if(!Number.isSafeInteger(page)||page<1||page>100000||![20,40].includes(size))throw fail(400,'分页参数无效');
  const revision=query.revision?String(query.revision):null;
  if(revision&&!/^[1-9]\d{0,15}$/.test(revision))throw fail(400,'目录版本无效');
  const values=[revision,normalized.media];
  const clauses=['e.revision=r.id','e.media=$2'];
  const add=(sql,value)=>{values.push(value);clauses.push(sql.replace('?',`$${values.length}`));};
  const type=query.type||'电影';
  if(type==='电影')clauses.push('NOT (99=ANY(e.genres))');
  if(type==='纪录片')clauses.push('99=ANY(e.genres)');
  if(type==='动漫')clauses.push('16=ANY(e.genres)');
  if(type==='综艺')clauses.push('e.genres && ARRAY[10764,10767]');
  const genre=normalized.url.searchParams.get('with_genres');
  if(genre)for(const group of genre.split(','))add('e.genres && ?::int[]',group.split('|').map(Number));
  if(query.year&&query.year!=='全部')add('e.year=?',Number(query.year));
  if(query.region&&query.region!=='全部')add('?=ANY(e.countries)',catalogRegions[query.region]);
  const sort=query.sort||'精选';
  const minimum=normalized.url.searchParams.get('vote_average.gte');
  if(minimum)add('e.score>=?',Number(minimum));
  if(sort==='最新上映')clauses.push('e.votes>=20');
  if(sort==='评分最高')clauses.push('e.votes>=50');
  const order=sort==='最新上映'?'release_date DESC':sort==='评分最高'?'score DESC NULLS LAST, votes DESC':'popularity DESC';
  values.push(size,(page-1)*size);
  return {page,size,values,text:`WITH r AS (
    SELECT id,published_at,coverage FROM catalog_revisions
    WHERE status='ready' AND ($1::bigint IS NULL OR id=$1::bigint)
    ORDER BY id DESC LIMIT 1
  ), matched AS MATERIALIZED (
    SELECT e.media,e.tmdb_id,e.release_date,e.score,e.votes,e.popularity
    FROM catalog_entries e,r WHERE ${clauses.join(' AND ')}
  ) SELECT r.id::text AS revision,r.published_at,r.coverage,
    (SELECT count(*)::int FROM matched) AS total,
    COALESCE((SELECT jsonb_agg(e.payload ORDER BY selected.ordinal) FROM (
      SELECT media,tmdb_id,row_number() OVER(ORDER BY ${order},media,tmdb_id) AS ordinal
      FROM matched ORDER BY ${order},media,tmdb_id LIMIT $${values.length-1} OFFSET $${values.length}
    ) selected JOIN catalog_entries e ON e.revision=r.id AND e.media=selected.media AND e.tmdb_id=selected.tmdb_id),'[]'::jsonb) AS items FROM r`};
}

export function createIndexReader({query:execute=(...args)=>catalogDatabase()(...args),now=Date.now,sharedCache=null}={}){
  const cache=new Map(),pending=new Map();
  return async params=>{
    const compiled=indexQuery(params),key='index-v1:'+createHash('sha256').update(JSON.stringify(compiled.values)+':'+compiled.text).digest('hex');
    const hit=cache.get(key);if(hit?.expires>now())return hit.value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=12)throw fail(429,'目录繁忙，请稍后重试');
    const task=(async()=>{
      try{const remote=await sharedCache?.get(key);if(remote?.expires>now()){cache.set(key,remote);while(cache.size>60)cache.delete(cache.keys().next().value);return remote.value;}}catch{}
      const [row]=await execute(compiled.text,compiled.values);
      if(!row)throw fail(params.revision?410:503,params.revision?'目录已更新，请重新筛选':'影片目录正在更新，请稍后再试');
      const total=Number(row.total),totalPages=Math.ceil(total/compiled.size);
      if(compiled.page>Math.max(1,totalPages))throw fail(404,'已到最后一页');
      const items=row.items.map(item=>({...item,type_name:params.type||'电影'}));
      const value={provider:'tmdb',indexed:true,filtered:true,revision:row.revision,
        items,page:compiled.page,rawCount:items.length,total,totalPages,
        hasNext:compiled.page<totalPages,updatedAt:row.published_at,coverage:row.coverage};
      const saved={expires:now()+300000,value};cache.set(key,saved);
      while(cache.size>60)cache.delete(cache.keys().next().value);
      try{await sharedCache?.set(key,saved,{ttl:300});}catch{}
      return value;
    })().finally(()=>pending.delete(key));
    pending.set(key,task);return task;
  };
}

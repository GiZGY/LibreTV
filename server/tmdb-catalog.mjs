import {createFilteredCatalog} from './filtered-catalog.mjs';
const movieGenres = {剧情:18,爱情:10749,喜剧:35,动作:28,科幻:878,悬疑:9648,惊悚:53,犯罪:80,冒险:12,动画:16,战争:10752,历史:36,奇幻:14,家庭:10751};
const tvGenres = {剧情:18,喜剧:35,悬疑:9648,犯罪:80,动画:16,家庭:10751};
export const catalogRegions={中国大陆:'CN',中国香港:'HK',中国台湾:'TW',美国:'US',英国:'GB',法国:'FR',德国:'DE',日本:'JP',韩国:'KR',印度:'IN',泰国:'TH'};
const genreNames = Object.fromEntries(Object.entries({...movieGenres,纪录片:99,音乐:10402,电视电影:10770,动作冒险:10759,儿童:10762,新闻:10763,真人秀:10764,科幻奇幻:10765,肥皂剧:10766,脱口秀:10767,战争政治:10768,西部:37}).map(([name,id])=>[id,name]));
export const catalogGenres = {电影:Object.keys(movieGenres),电视剧:Object.keys(tvGenres),动漫:Object.keys(tvGenres),综艺:Object.keys(tvGenres),纪录片:Object.keys(movieGenres)};
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function catalogQuery(query) {
  if(query.kind==='lookup'){
    const title=String(query.title||'').trim(),media=['电影','纪录片'].includes(query.type)?'movie':'tv';
    if(!title||title.length>120)throw fail(400,'影片名称无效');
    const url=new URL('https://api.themoviedb.org/3/search/'+media);
    Object.entries({query:title,language:'zh-CN',include_adult:'false',page:'1'}).forEach(([k,v])=>url.searchParams.set(k,v));
    return {url,media,type:media==='movie'?'电影':'电视剧',page:1};
  }
  if (query.kind === 'related' || query.kind === 'detail') {
    const match = /^(movie|tv):([1-9]\d{0,9})$/.exec(String(query.id || ''));
    if (!match) throw fail(400,'影片编号无效');
    const [,media,id] = match;
    const url = new URL(`https://api.themoviedb.org/3/${media}/${id}${query.kind==='related'?'/recommendations':''}`);
    if(query.kind==='detail')url.searchParams.set('append_to_response','credits,translations,release_dates');
    url.searchParams.set('language','zh-CN');url.searchParams.set('page','1');
    return {url,media,type:media==='movie'?'电影':'电视剧',page:1,kind:query.kind};
  }
  if (query.kind && query.kind !== 'discover') throw fail(400,'请求无效');
  const type=query.type||'电影',genre=query.genre||'全部',year=query.year||'全部',sort=query.sort||'精选',page=String(query.page||'1');
  const region=query.region||'全部';
  if(region!=='全部'&&!Object.hasOwn(catalogRegions,region))throw fail(400,'地区无效');
  if(!Object.hasOwn(catalogGenres,type)||!['精选','最新上映','评分最高'].includes(sort)||!/^[1-9]\d{0,2}$/.test(page)||Number(page)>500)throw fail(400,'筛选条件无效');
  if(year!=='全部'&&(!/^\d{4}$/.test(year)||+year<1888||+year>new Date().getFullYear()+1))throw fail(400,'年份无效');
  const genres=['电影','纪录片'].includes(type)?movieGenres:tvGenres;
  if(genre!=='全部'&&!Object.hasOwn(genres,genre))throw fail(400,'此分类不支持该题材');
  const media=['电影','纪录片'].includes(type)?'movie':'tv';
  const url=new URL('https://api.themoviedb.org/3/discover/'+media);
  const params={language:'zh-CN',include_adult:'false',page,sort_by:sort==='评分最高'?'vote_average.desc':sort==='最新上映'?(media==='movie'?'primary_release_date.desc':'first_air_date.desc'):'popularity.desc'};
  params[media==='movie'?'primary_release_date.lte':'first_air_date.lte']=new Date().toISOString().slice(0,10);
  if(media==='movie')params.include_video='false';
  if(type==='电影')params.without_genres='99';
  if(region!=='全部')params.with_origin_country=catalogRegions[region];
  if(sort==='最新上映'){
    params['vote_count.gte']='20';
    params[media==='movie'?'with_title_translation':'with_name_translation']='zh-CN';
  }
  if(sort==='评分最高'){
    params['vote_count.gte']='50';
    params['vote_average.gte']='6.5';
  }
  if(query.minRating!==undefined){
    if(!['6.5','7'].includes(String(query.minRating)))throw fail(400,'评分门槛无效');
    params['vote_average.gte']=String(Math.max(Number(params['vote_average.gte']||0),Number(query.minRating)));
  }
  if(year!=='全部')params[media==='movie'?'primary_release_year':'first_air_date_year']=year;
  const ids=[];if(type==='纪录片')ids.push('99');if(type==='动漫')ids.push('16');if(type==='综艺')ids.push('10764|10767');if(genre!=='全部')ids.push(String(genres[genre]));
  if(ids.length)params.with_genres=[...new Set(ids)].join(',');
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  return {url,type,media,page:Number(page)};
}
export function normalizeCatalog(raw,{type,media,page}) {
  if(!Array.isArray(raw.results)||!Number.isInteger(raw.total_pages)||raw.total_pages<0||!Number.isInteger(raw.total_results)||raw.total_results<0)throw fail(502,'影片目录返回异常');
  const totalPages=Math.min(500,raw.total_pages);
  const clean=value=>String(value||'').replace(/<[^>]*>/g,'').trim();
  const items=raw.results.filter(item=>item.adult!==true&&Number.isInteger(item.id)&&item.id>0).map(item=>({
    id:media+':'+item.id,provider:'tmdb',title:preferredTitle(item),original_title:clean(item.original_title||item.original_name),
    year:String(item.release_date||item.first_air_date||'').slice(0,4),type_name:type,
    genres:(item.genre_ids||[]).map(id=>genreNames[id]).filter(Boolean),
    rate:item.vote_count>0?Number(item.vote_average||0).toFixed(1):'',rating_source:'TMDB',
    cover:/^\/[\w.-]+$/.test(item.poster_path||'')?'https://image.tmdb.org/t/p/w500'+item.poster_path:'',
    vod_content:clean(item.overview)
  }));
  return {provider:'tmdb',items,page,total:raw.total_results,totalPages,reportedPages:raw.total_pages,capped:raw.total_pages>500,rawCount:raw.results.length,hasNext:page<totalPages};
}
export function preferredTitle(item){
  const clean=value=>String(value||'').replace(/<[^>]*>/g,'').trim();
  const translated=(item.translations?.translations||[]).filter(t=>t.iso_639_1==='zh').sort((a,b)=>Number(b.iso_3166_1==='CN')-Number(a.iso_3166_1==='CN')).map(t=>t.data?.title||t.data?.name);
  const candidates=[item.title||item.name,...translated,item.original_title||item.original_name].map(clean).filter(Boolean);
  return candidates.find(title=>/[\u3400-\u9fff]/.test(title))||candidates[0]||'';
}
export function normalizeDetail(raw,parsed){
  if(!Number.isInteger(raw.id)||raw.id<=0||raw.adult===true)throw fail(404,'影片资料不可用');
  const item=normalizeCatalog({results:[{...raw,genre_ids:(raw.genres||[]).map(g=>g.id)}],total_pages:1,total_results:1},parsed).items[0];
  const names=list=>list.map(person=>String(person.name||'').replace(/<[^>]*>/g,'').trim()).filter(Boolean).join(' / ');
  item.vod_director=names((raw.credits?.crew||[]).filter(person=>person.job==='Director'))||names(raw.created_by||[]);
  item.vod_actor=names((raw.credits?.cast||[]).slice(0,12));
  const releases=parsed.media==='movie'?(raw.release_dates?.results||[]).find(region=>region.iso_3166_1==='US')?.release_dates||[]:[];
  const certificate=releases.filter(entry=>['G','PG','PG-13','R','NC-17'].includes(entry.certification)).sort((a,b)=>Number(b.type===3)-Number(a.type===3))[0]?.certification;
  if(certificate)item.certification={label:certificate,country:'US'};
  item.vod_remarks=raw.runtime>0?`${raw.runtime} 分钟`:'';
  return {provider:'tmdb',item};
}
export function createCatalogService({fetchImpl=globalThis.fetch,env=()=>process.env,now=Date.now,sharedCache=null}={}){
  const cache=new Map(),pending=new Map();let cooldown=0;
  const readCatalog=async query=>{
    const config=env();const token=config.TMDB_READ_ACCESS_TOKEN;
    if(!token)throw fail(503,'TMDB 暂未启用，请选择豆瓣');
    const parsed=catalogQuery(query),key=parsed.url.href;
    const hit=cache.get(key);if(hit&&hit.until>now())return hit.data;
    if(cooldown>now())throw fail(429,'TMDB 请求较多，请稍后再试');
    if(!pending.has(key)){
      if(pending.size>=3)throw fail(429,'目录繁忙，请稍后再试');
      pending.set(key,(async()=>{
        // Share only public catalogue data, after the handler verifies access.
        if(sharedCache){try{const saved=await sharedCache.get('catalog-v3:'+key);if(saved&&saved.until>now()){cache.set(key,saved);while(cache.size>120)cache.delete(cache.keys().next().value);return saved.data;}}catch{}}
        let response;
        try{response=await fetchImpl(parsed.url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(7000)});}catch{throw fail(504,'TMDB 暂时无法连接，请稍后重试');}
        if(response.status===429){cooldown=now()+60000;throw fail(429,'TMDB 请求较多，请稍后再试');}
        if(!response.ok)throw fail(502,'TMDB 暂时不可用，请稍后重试');
        let raw;try{raw=await response.json();}catch{throw fail(502,'影片目录返回异常');}
        if(parsed.kind!=='detail'&&raw.results?.some(item=>!/[\u3400-\u9fff]/.test(preferredTitle(item)))){
          // One regional catalogue request, never one extra request per card.
          const regional=new URL(parsed.url);regional.searchParams.set('language','zh-TW');
          try{
            const fallback=await fetchImpl(regional,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(2500)});
            if(fallback.ok){
              const titles=new Map(((await fallback.json()).results||[]).map(item=>[item.id,preferredTitle(item)]));
              raw.results=raw.results.map(item=>!/[\u3400-\u9fff]/.test(preferredTitle(item))&&/[\u3400-\u9fff]/.test(titles.get(item.id)||'')?{...item,title:titles.get(item.id)}:item);
            }
          }catch{}
        }
        const data=parsed.kind==='detail'?normalizeDetail(raw,parsed):normalizeCatalog(raw,parsed);
        cache.delete(key);cache.set(key,{until:now()+3600000,data});
        while(cache.size>120)cache.delete(cache.keys().next().value);
        if(sharedCache){try{await sharedCache.set('catalog-v3:'+key,{until:now()+3600000,data},{ttl:3600});}catch{}}
        return data;
      })().finally(()=>pending.delete(key)));
    }
    return pending.get(key);
  };
  const filtered=createFilteredCatalog({readPage:readCatalog,normalize:catalogQuery,sharedCache,now});
  return query=>query.kind==='browse'||query.filtered==='1'&&(!query.kind||query.kind==='discover')?filtered(query):readCatalog(query);
}

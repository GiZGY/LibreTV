(() => {
  const cache = new Map();
  const doubanBlockedUntil=new Map();
  const doubanCache=new Map();
  const doubanPending=new Map();
  const cacheKey='openstream_douban_data_v1';
  const catalogMaxAge=7*24*60*60*1000;
  const catalogState=new Map();
  let doubanQueue=Promise.resolve(),lastDoubanRequest=0;
  function persistCatalog(){
    try{
      while(doubanCache.size>80)doubanCache.delete(doubanCache.keys().next().value);
      let value=JSON.stringify([...doubanCache]);
      while(value.length>1500000&&doubanCache.size>1){doubanCache.delete(doubanCache.keys().next().value);value=JSON.stringify([...doubanCache]);}
      localStorage.setItem(cacheKey,value);
    }catch{}
  }
  let catalogCooldown=0;
  try{catalogCooldown=Number(localStorage.getItem('openstream_catalog_cooldown'))||0;}catch{}
  function coolDown(){catalogCooldown=Date.now()+60000;try{localStorage.setItem('openstream_catalog_cooldown',String(catalogCooldown));}catch{}}

  try {
    for(const [key,value] of JSON.parse(localStorage.getItem(cacheKey)||'[]')) {
      if(value&&value.expires+catalogMaxAge>Date.now())doubanCache.set(key,value);
    }
  } catch {}
  function waitFor(promise,signal) {
    if(!signal)return promise;
    if(signal.aborted)return Promise.reject(signal.reason);
    return new Promise((resolve,reject)=>{
      const abort=()=>{cleanup();reject(signal.reason);};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    });
  }
  const adult = /伦理片|伦理剧|色情|情色|成人片|里番|三级片|福利姬|AV女优|无码|有码/iu;
  const text = value => String(value || '').replace(/<[^>]*>/g, '').trim();
  const safeURL = value => {
    try {
      const url = new URL(value),host=url.hostname.toLowerCase();
      if(!/^https?:$/.test(url.protocol)||url.username||url.password)return '';
      if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/\.(local|internal)$/.test(host))return '';
      return url.href;
    } catch { return ''; }
  };
  const allowed = item => {
    const title=String(item.vod_name||item.title||item.name||'').replace(/<[^>]*>/g,'').trim();
    const score=Number(item.rate??item.vod_douban_score??item.rating);
    // CMS commonly uses zero for an unrated title, not an actual zero-star score.
    if(!/[\u3400-\u9fff]/u.test(title)||/[\u3040-\u30ff\uac00-\ud7af]/u.test(title))return false;
    if(Number.isFinite(score)&&score>0&&score<5)return false;
    return !adult.test([item.type_name, item.vod_class, item.vod_name, item.title].join(' '))
    && !/解说/u.test([item.type_name,item.vod_class].join(' '))
    && !/电影解说|影视解说|剧集解说|解说版|\[解说\]|【解说】/u.test([item.vod_name,item.title].join(' '));
  };
  const sources = () => Object.keys(API_SITES).filter(key => !API_SITES[key].adult && !OpenStreamSourceAdapter.isLoginRequiredSource(key));
  async function json(url, signal) {
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (response.status === 401) { window.dispatchEvent(new Event('session-expired')); throw new Error('登录已过期，请重新验证'); }
    if (!response.ok) {
      const error=new Error(response.status === 429 ? '请求较多，请稍后重试' : '数据暂时无法加载，请重试');
      error.status=response.status;throw error;
    }
    return response.json();
  }
  async function proxied(url, signal, refresh=false) {
    const parsed=new URL(url),douban=parsed.hostname==='movie.douban.com';
    const request=async requestSignal=>{
      const target=await ProxyAuth.addAuthToProxyUrl('/proxy/'+encodeURIComponent(url));
      let result;
      try{result=await json(target,requestSignal);}
      catch(error){
        if(douban&&error.status===429){coolDown();doubanBlockedUntil.set(parsed.pathname,Date.now()+60000);throw new Error('豆瓣暂时限制访问，请一分钟后再试');}
        throw error;
      }
      if(douban&&result?.r&&/异常请求|登录|频繁|限制/.test(String(result.msg))){
        coolDown();doubanBlockedUntil.set(parsed.pathname,Date.now()+60000);
        throw new Error('豆瓣暂时限制访问，请一分钟后再试');
      }
      return result;
    };
    if(!douban)return request(signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000));
    const cached=doubanCache.get(url);
    if(cached&&!refresh&&cached.expires+catalogMaxAge>Date.now()){
      catalogState.set(url,{stale:cached.expires<=Date.now(),updated:cached.updated||cached.expires});
      if(cached.expires<=Date.now()&&Date.now()>=catalogCooldown){
        void proxied(url,signal,true).catch(()=>{});
      }
      return waitFor(Promise.resolve(cached.data),signal);
    }
    if(!doubanPending.has(url)){
      // Share upstream work across page changes, but skip requests nobody still needs.
      const entry={listeners:0,promise:null};
      entry.promise=doubanQueue.catch(()=>{}).then(async()=>{
        const delay=Math.max(180,1200-(Date.now()-lastDoubanRequest));
        if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
        if(!entry.listeners)throw new DOMException('Aborted','AbortError');
        if(Date.now()<Math.max(catalogCooldown,doubanBlockedUntil.get(parsed.pathname)||0))throw new Error('豆瓣暂时限制访问，请一分钟后再试');
        lastDoubanRequest=Date.now();
        const result=await request(AbortSignal.timeout(8000));
        if(Array.isArray(result.subjects)||Array.isArray(result.data)){
          const ttl=parsed.pathname.endsWith('/new_search_subjects')?24*60*60*1000:60*60*1000;
          doubanCache.delete(url);doubanCache.set(url,{updated:Date.now(),expires:Date.now()+ttl,data:result});
          catalogState.set(url,{stale:false,updated:Date.now()});persistCatalog();
        }
        return result;
      }).finally(()=>doubanPending.delete(url));
      doubanQueue=entry.promise.catch(()=>{});
      doubanPending.set(url,entry);
    }
    const entry=doubanPending.get(url);entry.listeners++;
    try{return await waitFor(entry.promise,signal);}finally{entry.listeners--;}
  }
  function image(url) {
    const safe = safeURL(url);
    if(!safe)return 'assets/placeholder.svg';
    return /^img\d*\.doubanio\.com$/.test(new URL(safe).hostname)
      ? ProxyAuth.addAuthToProxyUrlSync('/proxy/' + encodeURIComponent(safe)) : safe;
  }
  function parseLines(item, sourceKey) {
    const flags = String(item.vod_play_from || '').split('$$$');
    return String(item.vod_play_url || '').split('$$$').map((line, i) => ({
      key: sourceKey + ':' + i, sourceKey, videoId: String(item.vod_id), flag: flags[i] || '',
      name: API_SITES[sourceKey]?.name || sourceKey,
      label: flags[i] || '线路 ' + (i + 1),
      episodes: line.split('#').map((entry, n) => {
        const delimiter = entry.indexOf('$');
        const url = safeURL(delimiter < 0 ? entry : entry.slice(delimiter + 1));
        return { name: text(delimiter < 0 ? '第 ' + (n + 1) + ' 集' : entry.slice(0, delimiter)), url };
      }).filter(episode => episode.url && !/\.html?(?:[?#]|$)/i.test(episode.url) && !OpenStreamSourceAdapter.isLoginRequiredUrl(episode.url))
    })).filter(line => line.episodes.length);
  }
  async function detail(line, signal) {
    const key = line.source_code + ':' + line.vod_id;
    if (cache.has(key)) return cache.get(key);
    if (OpenStreamSourceAdapter.isBridgeSource(line.source_code)) {
      const result = await OpenStreamSourceAdapter.detail(line.source_code, line.vod_id, {signal});
      if(result.status !== 'ready') throw new Error(({unsupported:'此来源暂未连接',timeout:'此来源响应超时',login_required:'此来源需要登录，暂不支持',no_result:'此来源暂无影片'})[result.status] || '此来源暂不可用');
      const info=result.data?.videoInfo||{};
      const groups=new Map();
      result.episodes.forEach((entry,index)=>{
        const flag=entry.flag||'';
        if(!groups.has(flag))groups.set(flag,{key:line.source_code+':'+flag,sourceKey:line.source_code,videoId:String(line.vod_id),flag,name:API_SITES[line.source_code]?.name||line.source_code,label:flag||'默认',episodes:[]});
        groups.get(flag).episodes.push({name:text(entry.name)||'第 '+(index+1)+' 集',url:'',bridgeEpisode:entry.episode??index});
      });
      return {item:{vod_name:info.title,vod_content:info.desc,vod_director:info.director,vod_actor:info.actor,vod_remarks:info.remarks},lines:[...groups.values()]};
    }
    const site = API_SITES[line.source_code];
    if (!site || site.adult) throw new Error('暂不支持此来源');
    const url = new URL(site.api); url.searchParams.set('ac', 'detail'); url.searchParams.set('ids', line.vod_id);
    const data = await proxied(url.href, signal);
    const item = data.list?.find(item => String(item.vod_id) === String(line.vod_id));
    if (!item || !allowed(item)) throw new Error('影片暂不可用');
    const result = { item, lines: parseLines(item, line.source_code) };
    if (!result.lines.length) throw new Error('此来源暂无可播放线路');
    cache.set(key, result); if (cache.size > 80) cache.delete(cache.keys().next().value);
    return result;
  }
  async function firstDetail(candidates,signal) {
    if(!candidates.length)throw new Error('暂无播放来源');
    const controller=new AbortController();
    const shared=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let next=0;
    const worker=async()=>{
      let lastError;
      while(next<candidates.length&&!shared.aborted){
        const candidate=candidates[next++];
        try{return await detail(candidate,AbortSignal.any([shared,AbortSignal.timeout(4500)]));}
        catch(error){lastError=error;}
      }
      throw lastError||new Error('此来源暂不可用');
    };
    try{return await Promise.any(Array.from({length:Math.min(3,candidates.length)},worker));}
    catch(error){if(signal?.aborted)throw signal.reason;throw new Error('播放来源暂不可用，请稍后重试',{cause:error});}
    finally{controller.abort();}
  }
  async function resolveEpisode(line, index, signal) {
    const episode=line?.episodes[index];
    if(!episode)throw new Error('这条线路没有当前集，请选择其他线路');
    if(!OpenStreamSourceAdapter.isBridgeSource(line.sourceKey))return episode.url;
    const result=await OpenStreamSourceAdapter.play(line.sourceKey,line.videoId,line.flag,episode.bridgeEpisode,{signal});
    if(result.status!=='ready'||!safeURL(result.url))throw new Error('此线路暂时无法播放，请选择其他线路');
    return result.url;
  }
  async function recommend({ type = 'movie', tag = '热门', start = 0, signal } = {}) {
    const url = new URL('https://movie.douban.com/j/search_subjects');
    Object.entries({ type, tag, sort: 'recommend', page_limit: 24, page_start: start }).forEach(([key,value]) => url.searchParams.set(key,value));
    const data = await proxied(url.href, signal);
    if (!Array.isArray(data.subjects)) throw new Error('推荐暂不可用，请稍后重试');
    return data.subjects.filter(allowed);
  }
  const tmdbCache=new Map(),tmdbPending=new Map();
  async function catalogRequest(params,signal){
    if(signal?.aborted)throw signal.reason;
    // Bump when catalogue selection rules change, preserving user data and caching.
    const key=new URLSearchParams({...params,policy:'2026-09-22-latest-v1'}).toString(),hit=tmdbCache.get(key);
    if(hit&&hit.until>Date.now())return hit.data;
    if(!tmdbPending.has(key)){
      const task=json('/api/catalog/tmdb?'+key,AbortSignal.timeout(params.filtered==='1'?22000:9000)).then(result=>{
        if(params.kind==='detail'?!result.item:!Array.isArray(result.items))throw new Error('影片资料暂不可用');
        tmdbCache.delete(key);tmdbCache.set(key,{until:Date.now()+3600000,data:result});
        while(tmdbCache.size>40)tmdbCache.delete(tmdbCache.keys().next().value);
        return result;
      }).finally(()=>tmdbPending.delete(key));
      tmdbPending.set(key,task);
    }
    return waitFor(tmdbPending.get(key),signal);
  }
  async function lookupTMDB(f,signal){
    const result=await catalogRequest({kind:'lookup',title:f.name,type:f.type},signal);
    const clean=s=>text(s).replace(/[\s·:：]/g,'');
    const matches=result.items.filter(allowed).filter(item=>[item.title,item.original_title].some(t=>clean(t)===clean(f.name))&&(!f.year||String(item.year)===String(f.year)));
    return matches.length===1?matches[0]:null;
  }
  async function detailTMDB(id,signal){
    const result=await catalogRequest({kind:'detail',id},signal);
    if(!allowed(result.item))throw new Error('影片资料不可用');
    return result.item;
  }
  async function relatedTMDB(id,signal){
    return (await catalogRequest({kind:'related',id},signal)).items.filter(allowed);
  }
  async function subjectMetadata(id, signal) {
    if(!/^\d+$/.test(String(id)))return null;
    const result=await proxied('https://movie.douban.com/j/subject_abstract?subject_id='+id,signal);
    return result.subject||null;
  }
  const discoveryGenerations=new Map();
  async function discoverTMDB({type,genre,year,sort,page,signal,pageSize=20,region='全部',minRating}){
    const key=JSON.stringify([type,genre,year,sort,region,minRating,pageSize]);
    const hour=Math.floor(Date.now()/3600000);
    let snapshot=discoveryGenerations.get(key);
    if(!snapshot||snapshot.generation<hour-1){snapshot={generation:hour,id:'shared'};discoveryGenerations.set(key,snapshot);}
    while(discoveryGenerations.size>40)discoveryGenerations.delete(discoveryGenerations.keys().next().value);
    const params={type,genre,year,sort,region,...(minRating?{minRating}:{})};
    const result=await catalogRequest({kind:'discover',filtered:'1',...params,
      page:String(page),pageSize:String(pageSize),generation:String(snapshot.generation),snapshot:snapshot.id,
      ...(snapshot.revision?{revision:snapshot.revision}:{})},signal);
    if(result.indexed&&result.revision)snapshot.revision=result.revision;
    if(result.filtered)return result;
    // An already-running preview or older deployment may still serve raw pages.
    const start=(page-1)*pageSize,batches=[];
    for(let sourcePage=Math.floor(start/20)+1;sourcePage<=Math.ceil((start+pageSize)/20);sourcePage++){
      const batch=sourcePage===page?result:await catalogRequest({...params,page:String(sourcePage)},signal);
      batches.push(batch);if(!batch.hasNext)break;
    }
    const head=batches[0],total=Math.min(head.total,10000),totalPages=Math.ceil(total/pageSize);
    return {...head,items:batches.flatMap(batch=>batch.items).slice(start%20,start%20+pageSize).filter(allowed),
      rawCount:batches.reduce((sum,batch)=>sum+batch.rawCount,0),total,totalPages,hasNext:page<totalPages};
  }
  async function discover({ type, genre, year, sort, page, signal }) {
    const url = new URL('https://movie.douban.com/j/new_search_subjects');
    const tags = [type]; if (genre !== '全部') tags.push(genre);
    Object.entries({ tags: tags.join(','), sort: ({精选:'U',最新上映:'R',评分最高:'S'})[sort] || 'U', range:'0,10', start:(page-1)*20 }).forEach(([key,value])=>url.searchParams.set(key,value));
    if (year !== '全部') url.searchParams.set('year_range',year+','+year);
    const data = await proxied(url.href, signal);
    if (!Array.isArray(data.data)) throw new Error('筛选暂不可用，请稍后重试');
    const items=data.data.filter(allowed);
    const state=catalogState.get(url.href)||{};
    return {items,rawCount:data.data.length,hasNext:data.data.length===20,total:null,...state};
  }
  window.LiveData = { json, proxied, image, sources, detail, firstDetail, recommend, discover, discoverTMDB, lookupTMDB, detailTMDB, relatedTMDB, subjectMetadata, resolveEpisode, parseLines, safeURL, text, allowed };
})();

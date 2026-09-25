(() => {
  if (!window.OPENSTREAM_LIVE) return;
  const previewRender = render;
  const data = LiveData;
  const catalogProvider='tmdb';
  const recommendations = new Map();
  const shelfPositions=new Map();
  function restoreShelves(){
    for(const [selector,key] of [['#home-recommendations > .poster-grid','genre:'+homeGenre],['#live-tv > .poster-grid','tv']]){
      const shelf=document.querySelector(selector);if(!shelf)continue;
      shelf.dataset.shelfKey=key;shelf.scrollLeft=shelfPositions.get(key)||0;
    }
  }
  document.addEventListener('scroll',event=>{const shelf=event.target;if(shelf.dataset?.shelfKey)shelfPositions.set(shelf.dataset.shelfKey,shelf.scrollLeft);},true);
  const homeGenreTasks=new Map();
  async function loadHomeGenre(genre){
    const key='home-genre:'+genre,hit=recommendations.get(key);
    if(hit&&Date.now()-hit.time<300000)return hit;
    if(!homeGenreTasks.has(genre)){
      const task=data.discoverTMDB({type:'电影',genre,year:'全部',sort:'精选',minRating:6.5,page:1,pageSize:40,signal:AbortSignal.timeout(10000)})
        .then(result=>{const entry={time:Date.now(),items:result.items.map(item=>register(item,true))};recommendations.set(key,entry);return entry;})
        .finally(()=>homeGenreTasks.delete(genre));
      homeGenreTasks.set(genre,task);
    }
    return homeGenreTasks.get(genre);
  }
  function prefetchHomeGenres(signal){
    const connection=navigator.connection;
    if(connection?.saveData||/^(slow-2g|2g)$/.test(connection?.effectiveType||''))return;
    const run=async()=>{
      for(const genre of ['科幻','悬疑','剧情','历史']){
        if(signal.aborted||!['','#home'].includes(location.hash))return;
        try{await loadHomeGenre(genre);}catch{return;}
        await new Promise(resolve=>setTimeout(resolve,350));
      }
    };
    if(window.requestIdleCallback)window.requestIdleCallback(run,{timeout:2000});
    else setTimeout(run,1000);
  }
  const discoveryLastSuccess=new Map();
  let lastDiscoveryView=null;
  const detailTasks = new Map();
  const candidateSearches = new Map();
  let authenticated = false, generation = 0, request = null;
  let activePlayback = null;
  let continuePlayback = false;
  let homeFilterController = null;
  let homeItems = [], discovered = [], discoveryHasNext = false;
  const discoveryPageSize=40;
  const savedDiscovery=load('discovery',null);
  if(savedDiscovery){Object.assign(filters,savedDiscovery.filters);discoverPage=Math.max(1,Number(savedDiscovery.page)||1);}
  const savedFilms = load('filmRecords', []);
  films.splice(0, films.length, ...(Array.isArray(savedFilms) ? savedFilms.filter(f => f && /^film-[a-z0-9]+$/.test(f.id)) : []));
  favorites = new Set([...favorites].filter(id => films.some(f => f.id === id)));
  history = history.filter(id => films.some(f => f.id === id));
  const status = (message, retry = true) => `<div class="empty" role="status"><p>${esc(message)}</p>${retry?'<button class="secondary" data-live-retry>重试</button>':''}</div>`;
  function persist() {
    const currentId=location.hash.split('/')[1];
    const keep = films.filter(f => favorites.has(f.id) || history.includes(f.id) || f.id===currentId).slice(-300);
    save('filmRecords', keep.map(({lines, ...film}) => film));
  }
  function identity(value) {
    let hash = 2166136261;
    for (const c of value) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return 'film-' + (hash >>> 0).toString(36);
  }
  function register(item, douban = false) {
    const name = data.text(item.vod_name || item.title);
    const id = douban ? identity((item.provider||'douban')+':' + item.id) : identity(OpenStreamResultAggregator.getResultKey?.(item) || name + '|' + item.vod_year + '|' + item.type_name);
    const old = films.find(f => f.id === id);
    const film = Object.assign(old || {}, {
      id, name, certification:item.certification||old?.certification, ratingSource:item.rating_source||old?.ratingSource||'', catalogProvider:item.provider||old?.catalogProvider||'', catalogId:douban?String(item.id):old?.catalogId, en: item.original_title||old?.en||'',
      ...FilmMetadata.merge(item,old), rating: String(item.rate || item.vod_douban_score || old?.rating || ''),
      type: /剧|连续/.test(item.type_name)?'电视剧':/动漫/.test(item.type_name)?'动漫':/综艺/.test(item.type_name)?'综艺':'电影',
      director: data.text(item.vod_director) || old?.director || '暂无资料', cast: data.text(item.vod_actor) || old?.cast || '暂无资料',
      description: data.text(item.vod_content) || old?.description || '暂无简介', length: data.text(item.vod_remarks) || old?.length || '',
      cover: data.safeURL(item.cover || item.vod_pic),
      art: data.image(item.cover || item.vod_pic), seasons: 1, episodes: old?.episodes || 1,
      candidates: item.source_lines || old?.candidates || (item.source_code?[item]:[]), douban
    });
    if (!old) films.push(film);
    return film;
  }
  function migrateHistory() {
    if(load('legacyHistoryMigrated',false))return;
    try{
      const previous=JSON.parse(localStorage.getItem('viewingHistory')||'[]');
      if(!Array.isArray(previous))return;
      for(const record of previous.slice(0,200)){
        if(!record?.title)continue;
        const source=API_SITES[record.sourceCode];
        if(source?.adult)continue;
        const f=register({vod_name:record.title,vod_id:record.vod_id,source_code:source?record.sourceCode:undefined,source_name:record.sourceName});
        f.episodes=Math.max(1,Array.isArray(record.episodes)?record.episodes.length:1);
        const timestamp=Number(record.timestamp);
        if(!historyMetadata[f.id])historyMetadata[f.id]={watchedAt:new Date(Number.isFinite(timestamp)&&timestamp>0?timestamp:Date.now()).toISOString(),position:Math.max(0,Number(record.playbackPosition)||0),duration:Math.max(0,Number(record.duration)||0),episode:Math.max(1,(Number(record.episodeIndex)||0)+1),season:1,source:record.sourceCode};
        if(!history.includes(f.id))history.push(f.id);
      }
      save('history',history);save('historyMetadataV2',historyMetadata);persist();
      save('legacyHistoryMigrated',true);
    }catch{}
  }
  function shell(page) {
    document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===page));
    document.title='OpenStream';
  }
  function showSources() {
    const container = document.querySelector('.settings-sources ul');
    document.querySelector('#source-count').textContent=data.sources().length+' 个';
    container.innerHTML = data.sources().map(key=>`<li><span>${esc(API_SITES[key].name)}</span><small>自动优选</small></li>`).join('');
  }
  async function authorize() {
    await window.HumanAccess?.ensure();
    const session = await data.json('/api/auth/status');
    authenticated = session.authenticated;
    if (authenticated) { ProxyAuth.setSession(session); return true; }
    $('#main').innerHTML = session.configured
      ? '<section class="empty"><h1>欢迎回来</h1><form id="live-login"><label for="instance-password">访问密码</label><input id="instance-password" name="password" type="password" autocomplete="current-password" required><button class="primary" type="submit">进入</button><p role="alert" id="login-error"></p></form></section>'
      : status('当前站点暂未完成访问配置，请联系管理员。');
    return false;
  }
  const featuredFilms=()=>homeItems.filter(f=>Number(f.rating)>=7).slice(0,8);
  const homeRecommendations=()=>{const ids=new Set(featuredFilms().map(f=>f.id));return homeItems.filter(f=>Number(f.rating)>=6.5&&!ids.has(f.id)).slice(0,20);};
  async function fetchHome(signal, token) {
    const cached = recommendations.get('home');
    if (cached && Date.now()-cached.time<300000) homeItems=cached.items;
    else {
      const {items:list}=await data.discoverTMDB({type:'电影',genre:'全部',year:'全部',sort:'精选',minRating:6.5,page:1,pageSize:40,signal});
      if(token!==generation)return;
      homeItems=list.map(item=>register(item,true));
      recommendations.set('home',{items:homeItems,time:Date.now()});
    }
    if(token!==generation)return;
    const featured=featuredFilms(), rest=homeRecommendations();
    // The featured strip and the recommendation grid use disjoint lists.
    const group=copy=>`<div class="film-ribbon-group" ${copy?'aria-hidden="true"':''}>${[...featured,...featured].map((f,i)=>{
      let html=card(f,true);
      if(copy||i>=featured.length)html=html.replace('<a ','<a tabindex="-1" ').replace('<button ','<button tabindex="-1" ');
      if(i>=featured.length)html=html.replace('<article ','<article data-loop-copy="true" ');
      return html;
    }).join('')}</div>`;
    $('#main').innerHTML=`<div id="hero-slot"><section class="film-ribbon poster-ribbon" aria-label="精选影片"><div class="film-ribbon-track">${group(false)}${group(true)}</div></section></div><div class="section-head"><h2>推荐影片</h2><a class="text-button" href="#discover">发现更多 ${icon('arrow')}</a></div><div class="filter-tabs">${['全部','科幻','悬疑','剧情','历史'].map(genre=>`<button class="chip ${homeGenre===genre?'selected':''}" data-live-home-genre="${genre}" aria-pressed="${homeGenre===genre}">${genre}</button>`).join('')}</div><div id="home-recommendations">${homeGenre==='全部'?grid(rest):status('正在加载影片…',false)}</div><div class="section-head"><h2>热门剧集</h2></div><div id="live-tv">${status('正在加载剧集…',false)}</div>`;
    if(homeGenre!=='全部')await updateHomeGenre(homeGenre);
    try {
      const {items:tv}=await data.discoverTMDB({type:'电视剧',genre:'全部',year:'全部',sort:'精选',minRating:6.5,page:1,signal});
      if(token===generation)$('#live-tv').innerHTML=grid(tv.map(item=>{const f=register(item,true);f.type='电视剧';return f;}));
    } catch(error) {if(token===generation)$('#live-tv').innerHTML=status(error.message);}
    if(token===generation&&!signal.aborted){restoreShelves();prefetchHomeGenres(signal);}
  }
  async function updateHomeGenre(genre) {
    const priorGenre=homeGenre,oldShelf=document.querySelector('#home-recommendations > .poster-grid');
    if(oldShelf?.dataset.shelfKey)shelfPositions.set(oldShelf.dataset.shelfKey,oldShelf.scrollLeft);
    homeGenre=genre;homeFilterController?.abort();homeFilterController=new AbortController();
    const {signal}=homeFilterController,container=$('#home-recommendations');
    document.querySelectorAll('[data-live-home-genre]').forEach(button=>{const selected=button.dataset.liveHomeGenre===genre;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    if(genre==='全部'){container.removeAttribute('aria-busy');container.innerHTML=grid(homeRecommendations());restoreShelves();return;}
    try{
      container.setAttribute('aria-busy','true');
      const entry=await loadHomeGenre(genre);
      if(signal.aborted||!container.isConnected)return;
      const featured=new Set(featuredFilms().map(f=>f.id));
      container.innerHTML=grid(entry.items.filter(f=>Number(f.rating)>=6.5&&!featured.has(f.id)).slice(0,20));
    }catch(error){if(!signal.aborted&&container.isConnected){homeGenre=priorGenre;document.querySelectorAll('[data-live-home-genre]').forEach(button=>{const selected=button.dataset.liveHomeGenre===homeGenre;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});toast('暂时无法加载，已保留原内容');}}
    finally{if(!signal.aborted&&container.isConnected){container.removeAttribute('aria-busy');restoreShelves();}}
  }
  function discoveryControls() {
    const currentYear=new Date().getFullYear();
    const years=['全部',...Array.from({length:Math.max(0,currentYear-1990+1)},(_,i)=>String(currentYear-i))];
    return `<div class="discovery-heading"><h1>探索影片</h1><button class="text-button" data-action="reset">重置筛选</button></div><div class="discovery-filters">${filterStrip('分类','type',['电影','电视剧','动漫','综艺','纪录片'])}${filterStrip('题材','genre',!['电影','纪录片'].includes(filters.type)?['全部','剧情','喜剧','悬疑','犯罪','动画','家庭']:['全部','剧情','爱情','喜剧','动作','科幻','悬疑','惊悚','犯罪','冒险','动画','战争','历史','奇幻','家庭'])}${filterStrip('地区','region',['全部','中国大陆','中国香港','中国台湾','美国','英国','法国','德国','日本','韩国','印度','泰国'])}${filterStrip('年份','year',years)}</div><div class="results-head"><span id="discovery-count"></span><div class="sort-options">${chips(['精选','最新上映','评分最高'],filters.sort,'sort','',{'精选':'热门优先','评分最高':'高分佳作'})}</div></div><div id="discovery-cards">${status('正在寻找影片…',false)}</div><div class="pagination"><button data-live-page="-1" ${discoverPage===1?'disabled':''}>上一页</button><span>第 ${discoverPage} 页</span><button data-live-page="1" disabled>下一页</button></div>`;
  }
  async function fetchDiscovery(signal,token) {
    if(!['电影','纪录片'].includes(filters.type)&&!['全部','剧情','喜剧','悬疑','犯罪','动画','家庭'].includes(filters.genre))filters.genre='全部';
    save('discovery',{filters,page:discoverPage});
    const retained=lastDiscoveryView;
    $('#main').innerHTML=discoveryControls();
    if(retained){$('#discovery-cards').innerHTML=retained.html;$('#discovery-cards').setAttribute('aria-busy','true');$('#discovery-count').textContent='正在更新影片…';}
    document.querySelectorAll('[data-live-page]').forEach(button=>button.disabled=true);
    const condition=JSON.stringify([catalogProvider,filters]),page=discoverPage;
    try{
      const result=await data.discoverTMDB({...filters,page,signal,pageSize:discoveryPageSize});
      if(token!==generation||signal.aborted)return;
      if(!result.rawCount&&page>1){const previous=discoveryLastSuccess.get(condition);discoverPage=previous&&previous<page?previous:1;await fetchDiscovery(signal,token);return;}
      if(result.rawCount)discoveryLastSuccess.set(condition,page);
      discovered=result.items.map(item=>{const film=register(item,true);film.type=filters.type;if(!film.year&&filters.year!=='全部')film.year=filters.year;if(!film.genre&&filters.genre!=='全部'){film.genre=filters.genre;film.genres=[filters.genre];}return film;});
      discoveryHasNext=result.hasNext;$('#discovery-cards').removeAttribute('aria-busy');document.querySelector('[data-live-page="-1"]').disabled=page===1;
      $('#discovery-cards').innerHTML=discovered.length?grid(discovered):status(result.rawCount?'本页影片已被内容过滤，可继续浏览下一页。':'没有找到符合条件的影片，试试其他年份或题材。',false);
      $('#discovery-count').textContent=(result.indexed?'共 '+result.total+' 部影片':'本页 '+discovered.length+' 部影片')+(result.stale?' · 已显示上次更新的内容':'');
      lastDiscoveryView={condition,page,html:$('#discovery-cards').innerHTML,count:discovered.length,hasNext:result.hasNext,totalPages:result.totalPages};
      const end=result.totalPages;
      const pagination=document.querySelector('.pagination');
      pagination.querySelector('span').textContent=end?'第 '+page+' / '+end+' 页':'第 '+page+' 页';
      document.querySelector('[data-live-page="1"]').disabled=!result.hasNext||(end&&page>=end);
    }catch(error){
      if(token!==generation||signal.aborted)return;
      const previous=lastDiscoveryView;
      if(previous){
        filters=JSON.parse(previous.condition)[1];
        discoverPage=previous.page;discoveryHasNext=previous.hasNext;
        save('discovery',{filters,page:discoverPage});
        $('#main').innerHTML=discoveryControls();
        $('#discovery-cards').innerHTML=previous.html;
        $('#discovery-count').textContent='本页 '+previous.count+' 部影片 · 暂未加载新页，已保留当前内容';
        document.querySelector('.pagination span').textContent=previous.totalPages?'第 '+previous.page+' / '+previous.totalPages+' 页':'第 '+previous.page+' 页';
        document.querySelector('[data-live-page="-1"]').disabled=previous.page===1;
        document.querySelector('[data-live-page="1"]').disabled=!previous.hasNext;
        toast(error.message);
      }else{discoveryHasNext=false;$('#discovery-cards').innerHTML=status(error.message);}
    }
  }
  async function searchFilms(query,signal,onUpdate) {
    const statuses=[];
    const result=await OpenStreamStreamingSearch.runStreamingSearch({sources:data.sources(),query,filters:{},signal,
      onSourceDone: result=>statuses.push(result.status),
      onUpdate: payload=>onUpdate?.(payload.results.filter(data.allowed)),
      onDone: payload=>onUpdate?.(payload.results.filter(data.allowed))});
    return {...result,statuses};
  }
  const recentSearchViews=new Map();
  async function fetchSearch(query,signal,token) {
    $('#main').innerHTML=`<div class="page-title"><h1>搜索结果</h1><p id="search-progress">正在搜索“${esc(query)}”…</p></div><div id="live-results"></div>`;
    const cacheKey=JSON.stringify([query,data.sources()]),cached=recentSearchViews.get(cacheKey);
    if(cached&&Date.now()-cached.time<300000){$('#live-results').innerHTML=grid(cached.ids.map(id=>films.find(f=>f.id===id)).filter(Boolean));$('#search-progress').textContent='“'+query+'” · '+cached.ids.length+' 部影片';return;}
    const result=await searchFilms(query,signal,items=>{
      if(token!==generation)return;
      const host=$('#live-results');
      // Retain existing cards as slower sources add routes to an existing film.
      const visible=new Set();
      const ordered=items.slice().sort((a,b)=>Number(b.vod_name===query)-Number(a.vod_name===query));
      ordered.forEach((item,index)=>{
        const f=register(item);visible.add(f.id);
        let node=host.querySelector(`[data-film="${f.id}"]`);
        if(!node){const template=document.createElement('template');template.innerHTML=card(f);node=template.content.firstElementChild;if(!node)return;node.dataset.film=f.id;}
        if(host.children[index]!==node)host.insertBefore(node,host.children[index]||null);
      });
      [...host.children].forEach(node=>{if(!visible.has(node.dataset.film))node.remove();});
      host.classList.add('poster-grid');
      $('#search-progress').textContent=`“${query}” · ${items.length} 部影片，正在补充线路…`;
    });
    if(token!==generation)return;
    const accepted=result.results.filter(data.allowed),count=accepted.length;
    if(count){recentSearchViews.set(cacheKey,{time:Date.now(),ids:accepted.map(item=>register(item).id)});if(recentSearchViews.size>8)recentSearchViews.delete(recentSearchViews.keys().next().value);}
    $('#search-progress').textContent=`“${query}” · ${count} 部影片`;
    if(!count)$('#live-results').innerHTML=status(result.statuses.some(value=>value==='no_result')?'暂未找到影片。可以换个片名，或稍后重试。':'当前来源暂时无法响应，请稍后重试。');
  }
  async function resolveFilm(f,signal,force=false) {
    if(f.lines?.length)return f;
    if(f.catalogProvider==='tmdb'&&!/[\u3400-\u9fff]/.test(f.name)){
      try{const item=await data.detailTMDB(f.catalogId,signal);if(/[\u3400-\u9fff]/.test(item.title)){f.name=item.title;persist();}}catch(error){if(signal.aborted)throw error;}
    }
    const missingKey=JSON.stringify([f.catalogId||f.id,f.name,f.year,data.sources()]);
    const missing=load('missingSources',{});
    if(force){delete missing[missingKey];save('missingSources',missing);delete f.candidates;f.candidatesComplete=false;}
    if(Number(missing[missingKey])>Date.now())throw Object.assign(new Error('暂无片源'),{code:'no_result'});
    const existing=detailTasks.get(f.id);
    if(existing&&!existing.signal.aborted)return existing.task;
    const task=(async()=>{
      let candidates=f.candidates,searchCompletion;
      if(!candidates?.length){
        const normalize=s=>data.text(s).replace(/[\s·:：]/g,'');
        candidates=await new Promise((resolve,reject)=>{
          const accept=items=>{
            const match=items.filter(data.allowed).find(item=>normalize(item.vod_name)===normalize(f.name)&&(!f.year||!item.vod_year||String(item.vod_year)===String(f.year)));
            if(match?.source_lines?.length){f.candidates=match.source_lines;resolve(f.candidates);}
          };
          searchCompletion=searchFilms(f.name,signal,accept).then(result=>{
            accept(result.results);if(!signal.aborted)f.candidatesComplete=true;
            if(!f.candidates?.length&&!signal.aborted&&result.statuses.length&&result.statuses.every(status=>['ready','success','no_result'].includes(status))){
              const records=Object.entries(load('missingSources',{})).filter(([,until])=>Number(until)>Date.now()).slice(-199);
              save('missingSources',Object.fromEntries([...records,[missingKey,Date.now()+3600000]]));
              reject(Object.assign(new Error('暂无片源'),{code:'no_result'}));
            }else resolve(f.candidates||[]);
          },error=>{reject(error);return null;});
          candidateSearches.set(f.id,{signal,task:searchCompletion});
          void searchCompletion.finally(()=>{if(candidateSearches.get(f.id)?.task===searchCompletion)candidateSearches.delete(f.id);}).catch(()=>{});
        });
      }
      if(!candidates?.length)throw new Error('暂未找到此影片的播放来源，请稍后重试');
      const preferred=historyMetadata[f.id]?.source;
      const ordered=candidates.slice().sort((a,b)=>Number(b.source_code===preferred)-Number(a.source_code===preferred));
      let result;
      try{result=await data.firstDetail(ordered.slice(0,6),signal);}
      catch(error){
        if(!searchCompletion||signal.aborted)throw error;
        await searchCompletion;
        const tried=new Set(ordered.map(item=>item.source_code+':'+item.vod_id));
        const more=(f.candidates||[]).filter(item=>!tried.has(item.source_code+':'+item.vod_id));
        if(!more.length)throw error;
        result=await data.firstDetail(more.slice(0,6),signal);
      }
      f.lines=result.lines;f.linesCheckedAt=Date.now();f.lineIndex=0;
      if(f.catalogProvider!=='tmdb'){
        f.description=data.text(result.item.vod_content)||f.description;
        Object.assign(f,FilmMetadata.merge(result.item,f));
        f.director=data.text(result.item.vod_director)||f.director;f.cast=data.text(result.item.vod_actor)||f.cast;
      }
      f.episodes=Math.max(...f.lines.map(line=>line.episodes.length));f.length=data.text(result.item.vod_remarks);
      persist();return f;
    })();
    detailTasks.set(f.id,{task,signal});
    try{return await task;}finally{if(detailTasks.get(f.id)?.task===task)detailTasks.delete(f.id);}
  }
  function refreshDetailText(f){
    const root=document.querySelector('.detail-content');if(!root)return;
    root.querySelector('h1').textContent=f.name;
    root.querySelector('.film-certification')?.remove();
    root.querySelector('.score').insertAdjacentHTML('afterend',certificationMarkup(f));
    root.querySelector('.synopsis').textContent=f.description;
    const credits=root.querySelector('.credits');credits.replaceChildren(document.createTextNode('导演　'+f.director),document.createElement('br'),document.createTextNode('主演　'+f.cast));
    root.querySelector('[data-detail-year]').textContent=f.year||'年份未收录';
    root.querySelector('[data-detail-genre]').textContent=f.genre||f.type;
    const score=root.querySelector('.score');score.className='score '+scoreClass(f.rating);score.title=f.ratingSource||'评分';score.textContent=(f.ratingSource==='TMDB'?'TMDB ':'')+'★ '+(f.rating||'暂无');
    root.querySelector('.meta > span:last-child').textContent=f.length||'';
  }
  async function hydrateDetail(f,signal,token){
    try{
      if(f.catalogProvider!=='tmdb'){
        const match=await data.lookupTMDB(f,signal);
        if(signal.aborted||token!==generation)return;if(!match){void updateRelated(f,signal,token);return;}
        // Preserve saved favourite/history identity when upgrading legacy metadata.
        f.catalogProvider='tmdb';f.catalogId=match.id;
      }
      const item=await data.detailTMDB(f.catalogId,signal);
      if(signal.aborted||token!==generation)return;
      Object.assign(f,FilmMetadata.merge(item,f),{name:item.title||f.name,certification:item.certification,description:data.text(item.vod_content)||'暂无简介',director:data.text(item.vod_director)||'暂无资料',cast:data.text(item.vod_actor)||'暂无资料',rating:item.rate,ratingSource:'TMDB',length:item.vod_remarks||f.length});
      persist();refreshDetailText(f);void updateRelated(f,signal,token);
    }catch(error){
      if(signal.aborted||token!==generation)return;
      void updateRelated(f,signal,token);const note=document.createElement('p');note.className='related-empty';note.textContent='完整资料暂时无法加载，可稍后重试。';document.querySelector('.detail-content .credits')?.after(note);
    }
  }
  function sourceRetryDay(){const date=new Date();return [date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');}
  function sourceRetryKey(f){return f.catalogId||f.id||f.name;}
  function sourceRetryUsed(f){return load('sourceRetryDays',{})[sourceRetryKey(f)]===sourceRetryDay();}
  function consumeSourceRetry(f){
    if(sourceRetryUsed(f))return false;
    const day=sourceRetryDay(),records=Object.fromEntries(Object.entries(load('sourceRetryDays',{})).filter(([,value])=>value===day));
    records[sourceRetryKey(f)]=day;save('sourceRetryDays',records);return true;
  }
  async function checkAvailability(f,signal,token,force=false){
    const button=document.querySelector('.detail-content .actions .primary');if(!button)return;
    const href=button.getAttribute('href'),label=button.innerHTML;
    button.removeAttribute('href');button.setAttribute('aria-disabled','true');button.textContent='正在查找来源…';
    const note=document.createElement('p');note.className='availability-note';note.setAttribute('role','status');button.closest('.actions').after(note);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
    try{
      await resolveFilm(f,AbortSignal.any([signal,controller.signal]),force);
      if(signal.aborted||token!==generation)return;
      button.setAttribute('href',href);button.removeAttribute('aria-disabled');button.innerHTML=label;
      note.textContent=`已找到 ${f.lines.length} 条播放线路`;
      if(newEpisode(f)){
        const link=document.createElement('a');link.className='text-button';link.href='#player/'+f.id;link.dataset.newEpisode=newEpisode(f);link.dataset.id=f.id;link.textContent='有新集 · 第 '+newEpisode(f)+' 集';note.append(' ',link);
      }
      if(historyMetadata[f.id])button.innerHTML=icon('play')+historyLabel(f.id);
      if(f.catalogProvider!=='tmdb')refreshDetailText(f);
    }catch(error){
      if(signal.aborted||token!==generation)return;
      button.textContent='暂无片源';
      button.title=error.code==='no_result'?'未找到匹配片源':'本次查询未成功，可稍后再试';
      note.textContent='';
      const retry=document.createElement('button');retry.className='text-button';retry.disabled=sourceRetryUsed(f);retry.textContent=retry.disabled?'今日已重查':'重新查找';retry.title=retry.disabled?'明天可再次检查':'每部影片每天可重新查找一次';note.append(' ',retry);
      const alternatives=document.createElement('button');alternatives.className='text-button';alternatives.textContent='看看其他影片';alternatives.dataset.browseRelated='true';note.append(' ',alternatives);
      retry.addEventListener('click',()=>{
        if(signal.aborted||token!==generation||!consumeSourceRetry(f)){retry.disabled=true;retry.textContent='今日已重查';return;}
        retry.disabled=true;note.remove();button.setAttribute('href',href);button.innerHTML=label;
        void checkAvailability(f,signal,token,true);
      },{once:true});
    }finally{clearTimeout(timer);}
  }
  async function updateRelated(film,signal,token) {
    const host=document.querySelector('#related-films');
    if(!host)return;
    try {
      if(film.douban&&film.catalogProvider!=='tmdb'&&(!film.year||!film.genre)){
        const metadata=await data.subjectMetadata(film.catalogId,signal);
        if(metadata){Object.assign(film,FilmMetadata.merge(metadata,film));persist();}
        if(token!==generation||signal.aborted)return;
        const year=document.querySelector('[data-detail-year]'),genre=document.querySelector('[data-detail-genre]');
        if(year)year.textContent=film.year||'年份未收录';
        if(genre)genre.textContent=film.genre||film.type;
      }
      let related;
      if(film.catalogProvider==='tmdb'&&film.catalogId){
        const items=await data.relatedTMDB(film.catalogId,signal);
        const seen=new Set([film.name]);
        related=items.map(item=>register(item,true)).filter(f=>{if(seen.has(f.name))return false;seen.add(f.name);return f.id!==film.id;}).slice(0,8);
      }else related=FilmMetadata.related(film,films);
      if(token!==generation||signal.aborted||!host.isConnected)return;
      host.innerHTML=related.length?grid(related):'<p class="related-empty">暂时没有相关影片，<a href="#discover">去探索更多</a></p>';
    }catch(error){if(token===generation&&!signal.aborted&&host.isConnected)host.innerHTML='<p class="related-empty">相关推荐暂不可用，<a href="#discover">去探索更多</a></p>';}
  }
  document.addEventListener('playback-health',event=>{
    const {filmId,lineKey,health}=event.detail||{};
    const film=films.find(f=>f.id===filmId),line=film?.lines?.find(l=>l.key===lineKey);
    if(!line||!['fast','fair','slow'].includes(health))return;
    line.health=health;line.estimated=!!event.detail.estimated;
    if(location.hash!=='#player/'+filmId)return;
    const list=document.querySelector('.watch-source-list');
    if(list&&!list.matches(':hover, :focus-within, .is-dragging'))for(const {i} of rankedLines(film)){const button=list.querySelector(`[data-live-line="${i}"]`);if(button)list.append(button);}
    document.querySelectorAll('[data-live-line]').forEach(button=>{
      const item=film.lines[Number(button.dataset.liveLine)],dot=button.querySelector('.source-dot');
      if(dot&&item===line){dot.dataset.health=health;dot.title=(line.estimated?'连接响应预估：':'实际播放：')+{fast:'流畅',fair:'一般',slow:'缓慢'}[health];}
    });
  });
  const lineProbeCache=new Map();
  let probeQueue=Promise.resolve();
  function probeLines(f,signal){
    if(navigator.connection?.saveData)return;
    for(const line of f.lines.slice(0,10)){
      const episode=line.episodes[['电影','纪录片'].includes(f.type)?0:episodeFor(f).episode-1];
      if(!episode)continue;
      const key=line.key+'|'+episode.url;
      const cached=lineProbeCache.get(key);
      if(cached&&cached.expires>Date.now()){if(cached.health&&!line.health){line.health=cached.health;line.estimated=true;}continue;}
      lineProbeCache.set(key,{expires:Date.now()+60000});
      probeQueue=probeQueue.catch(()=>{}).then(async()=>{
        if(signal.aborted||document.hidden){lineProbeCache.delete(key);return;}
        if(line.health)return;
        const controller=new AbortController();
        const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(3500)]);
        try{
          const url=await data.resolveEpisode(line,['电影','纪录片'].includes(f.type)?0:episodeFor(f).episode-1,combined);
          const started=performance.now();
          // Headers-only sample: never download another movie alongside playback.
          const response=await fetch(url,{method:'GET',signal:combined,credentials:'omit',cache:'no-store'});
          await response.body?.cancel();
          if(!response.ok)return;
          const elapsed=performance.now()-started;
          const health=elapsed<800?'fast':elapsed<2000?'fair':'slow';
          lineProbeCache.set(key,{health,expires:Date.now()+300000});
          if(!line.health&&!signal.aborted){
            line.estimated=true;
            document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:f.id,lineKey:line.key,health,estimated:true}}));
          }
        }catch{}finally{controller.abort();}
      });
    }
  }
  function rankedLines(f) {
    const rank={fast:0,fair:1,unknown:2,slow:3};
    return f.lines.map((line,i)=>({line,i})).sort((a,b)=>(rank[a.line.health]??2)-(rank[b.line.health]??2));
  }
  function routeButtons(f) {
    return `<details class="watch-routes" aria-label="播放线路"><summary class="routes-heading"><span>播放线路 <small>${f.lines.length} 条</small></span><span class="route-current" title="${esc(f.lines[f.lineIndex||0]?.name||'')}">当前 ${esc(f.lines[f.lineIndex||0]?.name||'暂无片源')}</span><span class="route-switch">切换源</span></summary><div class="watch-source-list" aria-label="选择播放线路">${rankedLines(f).map(({line,i})=>`<button class="source-button ${i===(f.lineIndex||0)?'active':''}" data-live-line="${i}" aria-pressed="${i===(f.lineIndex||0)}"><span class="source-dot" data-health="${line.health||'unknown'}" title="${line.estimated?'连接响应预估：':''}${({fast:'流畅',fair:'一般',slow:'缓慢',unknown:'尚未检测'})[line.health||'unknown']}"></span><span>${esc(line.name)}</span></button>`).join('')}</div><p id="route-status" role="status"></p></details>`;
  }
  async function addOtherLines(f,signal,token) {
    probeLines(f,signal);
    const pending=candidateSearches.get(f.id);
    if(pending&&!pending.signal.aborted){try{await pending.task;}catch{}}
    else if(f.douban&&!f.candidatesComplete){
      try{
        const result=await searchFilms(f.name,signal);
        const normalize=value=>data.text(value).replace(/[\s·:：]/g,'');
        const match=result.results.filter(data.allowed).find(item=>normalize(item.vod_name)===normalize(f.name)&&(!f.year||!item.vod_year||String(item.vod_year)===String(f.year)));
        if(match?.source_lines?.length)f.candidates=match.source_lines;
        if(!signal.aborted)f.candidatesComplete=true;
      }catch{}
    }
    if(signal.aborted)return;
    const loaded=new Set(f.lines.map(line=>line.sourceKey));
    const candidates=(f.candidates||[]).filter(line=>{
      if(loaded.has(line.source_code))return false;
      loaded.add(line.source_code);
      return true;
    }).slice(0,20);
    let index=0;
    await Promise.allSettled(Array.from({length:Math.min(2,candidates.length)},async()=>{
      while(index<candidates.length&&!signal.aborted){
        const candidate=candidates[index++];
        try{const result=await data.detail(candidate,signal);for(const line of result.lines)if(!f.lines.some(old=>old.key===line.key))f.lines.push(line);
          if(token===generation&&!signal.aborted){if(location.hash.startsWith('#player/'))document.querySelector('.watch-routes')?.replaceWith(document.createRange().createContextualFragment(routeButtons(f)));probeLines(f,signal);}
        }catch{} }
    }));
  }
  let lineTransfer=null;
  async function playback(f,signal) {
    const line=f.lines[f.lineIndex||0];const ep=['电影','纪录片'].includes(f.type)?0:episodeFor(f).episode-1;
    const episode=line?.episodes[ep];
    if(!episode)return null;
    const value={filmId:f.id,lineKey:line.key,url:await data.resolveEpisode(line,ep,signal),episode:ep+1,source:line.sourceKey,label:episode.name,resume:historyMetadata[f.id]?.episode===ep+1&&!watchedComplete(historyMetadata[f.id])?historyMetadata[f.id]?.position:0,resumeRatio:lineTransfer?.filmId===f.id&&lineTransfer.episode===ep+1?lineTransfer.ratio:null,switched:lineTransfer?.filmId===f.id,autoplay:continuePlayback};
    continuePlayback=false;lineTransfer=null;return value;
  }
  render = async function () {
    const token=++generation;request?.abort();homeFilterController?.abort();request=new AbortController();const {signal}=request;
    const [page='home',encoded='']=(location.hash.slice(1)||'home').split('/');shell(page);
    try{
      if(!authenticated&&!(await authorize()))return;
      if(token!==generation)return;
      showSources();
      if(page==='home'){activePlayback=null;$('#main').innerHTML=status('正在加载推荐…',false);await fetchHome(signal,token);}
      else if(page==='discover'){activePlayback=null;await fetchDiscovery(signal,token);}
      else if(page==='search'){activePlayback=null;await fetchSearch(decodeURIComponent(encoded),signal,token);}
      else if(page==='detail'||page==='player'){
        const film=films.find(f=>f.id===encoded);
        if(!film){$('#main').innerHTML=status('影片记录已失效，请重新搜索。',false);return;}
        if(page==='detail'){
          if(isSeries(film)&&Date.now()-(film.linesCheckedAt||0)>1800000){delete film.lines;delete film.candidates;film.candidatesComplete=false;}
          activePlayback=null;$('#main').innerHTML=detail(film);void hydrateDetail(film,signal,token);void checkAvailability(film,signal,token).then(()=>{if(!signal.aborted&&token===generation&&film.lines?.length)void addOtherLines(film,signal,token);});return;
        }
        $('#main').innerHTML=status('正在获取播放线路…',false);
        await resolveFilm(film,signal);if(token!==generation)return;
        if(!episodeState[film.id]&&historyMetadata[film.id])episodeState[film.id]={season:1,episode:Math.max(1,Math.min(film.episodes,historyMetadata[film.id].episode||1))};
        if(page==='detail'){activePlayback=null;$('#main').innerHTML=detail(film);}
        else{
          if(!film.manualLine&&!activePlayback){film.lineIndex=rankedLines(film).find(({line})=>line.episodes[['电影','纪录片'].includes(film.type)?0:episodeFor(film).episode-1])?.i||0;}
          activePlayback=await playback(film,signal);if(token!==generation)return;$('#main').innerHTML=player(film);
          document.querySelector('.watch-routes').replaceWith(document.createRange().createContextualFragment(routeButtons(film)));
          if(!activePlayback)$('#route-status').textContent='这条线路没有当前集，请选择其他线路。';
        }
        void addOtherLines(film,signal,token);
      } else {activePlayback=null;previewRender();
        if(page==='about')$('#main').innerHTML='<article class="article"><div class="page-title"><h1>关于 OpenStream</h1></div><p>搜索影片、发现好故事，选择适合自己的播放线路。</p><h2>隐私</h2><p>收藏、观看历史和偏好保存在当前浏览器。搜索与播放会向相关内容来源发起请求。</p><h2>影片资料</h2><p>TMDB: This product uses the TMDB API but is not endorsed or certified by TMDB.</p><h2>内容与版权</h2><p>影片资料和播放内容由第三方来源提供，版权归各自权利方所有。</p></article>';
      }
    }catch(error){if(token===generation&&!signal.aborted)$('#main').innerHTML=status(error.message||'暂时无法加载，请重试');}
  };
  searchAll = function () {
    const query=commandInput.value.trim();if(!query)return;
    recentQueries=[query,...recentQueries.filter(item=>item!==query)].slice(0,6);save('recentQueries',recentQueries);
    command.close();const hash='#search/'+encodeURIComponent(query);if(location.hash===hash)render();else location.hash=hash;
  };
  commandInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&commandInput.value.trim()&&commandIndex<0){event.preventDefault();event.stopImmediatePropagation();searchAll();}},true);
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='live-login')return;event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:new FormData(event.target).get('password')})});
      const session=await response.json();if(!session.authenticated)throw new Error(response.status===429?'尝试次数过多，请稍后再试':'密码不正确，请重试');
      event.target.reset();authenticated=true;ProxyAuth.setSession(session);render();
    }catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    if(event.target.closest('[data-browse-related]')){document.querySelector('#related-films')?.scrollIntoView({behavior:document.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}
    const newEp=event.target.closest('[data-new-episode]');
    if(newEp){const f=films.find(f=>f.id===newEp.dataset.id);if(f)Object.assign(episodeFor(f),{episode:Number(newEp.dataset.newEpisode),season:1});}
    const genre=event.target.closest('[data-live-home-genre]');if(genre){if(homeGenre!==genre.dataset.liveHomeGenre)void updateHomeGenre(genre.dataset.liveHomeGenre);return;}
    const retry=event.target.closest('[data-live-retry]');if(retry){render();return;}
    const page=event.target.closest('[data-live-page]');if(page&&!page.disabled){discoverPage+=Number(page.dataset.livePage);render();return;}
    const line=event.target.closest('[data-live-line]');if(line){
      const f=films.find(f=>f.id===location.hash.split('/')[1]);
      if((f.lineIndex||0)===Number(line.dataset.liveLine))return;
      const video=document.querySelector('#watch-player video');
      if(video){LivePlayback.progress(video.currentTime,video.duration,f.id);rememberLinePosition(f,video);continuePlayback=!video.paused;}
      document.querySelectorAll('[data-live-line]').forEach(button=>button.disabled=true);line.setAttribute('aria-busy','true');
      f.manualLine=true;f.lineIndex=Number(line.dataset.liveLine);f.episodes=f.lines[f.lineIndex].episodes.length;render();return;
    }
    if(event.target.closest('[data-action="favorite"],[data-action="undo-favorite"]'))queueMicrotask(persist);
  });
  document.addEventListener('click',async event=>{
    if(!event.target.closest('[data-action="clear-cookies"]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!confirm('清除当前站点 Cookie？收藏与观看历史会保留。'))return;
    await fetch('/api/auth/logout',{method:'POST'});
    for(const name of document.cookie.split(';').map(value=>value.split('=')[0].trim()).filter(Boolean))document.cookie=name+'=; Max-Age=0; path=/; SameSite=Lax';
    authenticated=false;ProxyAuth.clearAuthCache();toast('已清除 Cookie');render();
  },true);
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement&&!event.target.src.endsWith('/assets/placeholder.svg'))event.target.src='assets/placeholder.svg';},true);
  window.addEventListener('session-expired',()=>{authenticated=false;});
  function rememberLinePosition(f,video){
    const r=historyMetadata[f.id];const duration=Number(video?.duration)||r?.duration,position=Number(video?.currentTime)||r?.position||0;
    lineTransfer={filmId:f.id,episode:activePlayback?.episode||1,ratio:duration>0?Math.min(.999,Math.max(0,position/duration)):null};
  }
  const failedPlaybackLines=new Map();
  const overlayNotifiedPlayback=new WeakSet();
  window.LivePlayback={
    current:()=>activePlayback,
    overlay(media){
      if(!media||media!==activePlayback||overlayNotifiedPlayback.has(media))return false;
      overlayNotifiedPlayback.add(media);
      return true;
    },
    continue(){continuePlayback=true;},
    progress(position,duration,filmId){
      if(!activePlayback||activePlayback.filmId!==filmId||!Number.isFinite(duration)||duration<=0)return;
      const id=activePlayback.filmId;history=[id,...history.filter(value=>value!==id)].slice(0,200);
      historyMetadata[id]={watchedAt:new Date().toISOString(),position:Math.floor(position),duration:Math.floor(duration),season:1,episode:activePlayback.episode,source:activePlayback.source,totalEpisodes:films.find(f=>f.id===id)?.episodes||1,completed:position/duration>=.99};
      save('history',history);save('historyMetadataV2',historyMetadata);persist();
    },
    failed(media){
      if(!media||media!==activePlayback)return;
      const f=films.find(f=>f.id===media.filmId);if(!f)return;
      const key=f.id+':'+media.episode;
      const failed=failedPlaybackLines.get(key)||new Set();
      if(failed.has(media.lineKey))return;
      failed.add(media.lineKey);failedPlaybackLines.set(key,failed);
      const next=rankedLines(f).find(({line})=>!failed.has(line.key)&&line.episodes?.[media.episode-1]);
      if(!next){toast('播放暂时失败，请稍后重试或选择其他来源');return;}
      const video=document.querySelector('#watch-player video');
      if(video)LivePlayback.progress(video.currentTime,video.duration,f.id);
      rememberLinePosition(f,video);continuePlayback=true;f.lineIndex=next.i;
      toast('正在切换线路…');render();
    }
  };
  const saveVisibleProgress=()=>{
    const video=document.querySelector('#watch-player video');
    if(video&&activePlayback)LivePlayback.progress(video.currentTime,video.duration,activePlayback.filmId);
  };
  window.addEventListener('pagehide',saveVisibleProgress);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveVisibleProgress();});
  migrateHistory();
  render();
})();

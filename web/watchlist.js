(() => {
 const REFRESH=30*60*1000;
 const categories={watching:'在追',planned:'想看',completed:'已看完'};
 let libraryCategory='all',refreshing=false;
 const cleanTime=value=>new Date(Number(value)).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const availability=window.OpenStreamLibrary.availability;
 function category(f){const saved=load('watchlist',{})[f.id]?.status;if(categories[saved])return saved;const record=historyMetadata[f.id];return watchedComplete(record)&&(!isSeries(f)||(record.episode||1)>=(f.episodes||1))?'completed':record?'watching':'planned';}
 function setCategory(id,status){if(!favorites.has(id)||!categories[status])return;const records=load('watchlist',{});records[id]={status,updatedAt:new Date().toISOString()};save('watchlist',records);render();}
 function libraryMarkup(){
  const all=films.filter(f=>favorites.has(f.id)&&(!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(f))),list=all.filter(f=>libraryCategory==='all'||category(f)===libraryCategory),update=load('watchlistRefresh',{}),stamp=Object.values(update).map(v=>v.checkedAt||0).sort((a,b)=>b-a)[0];
  return `<div class="library-head"><div class="page-title"><h1>我的收藏</h1></div><button class="secondary" data-refresh-watchlist ${refreshing?'disabled':''}>${refreshing?'正在检查更新…':'检查更新'}</button></div><div class="watchlist-filters" role="group" aria-label="收藏分类">${[['all','全部'],...Object.entries(categories)].map(([key,label])=>`<button class="chip ${libraryCategory===key?'selected':''}" data-library-category="${key}" aria-pressed="${libraryCategory===key}">${label} <small>${key==='all'?all.length:all.filter(f=>category(f)===key).length}</small></button>`).join('')}</div><p class="library-refresh-note" id="watchlist-status" role="status">${stamp?'最近检查 '+cleanTime(stamp)+' · 半小时内复用结果':'按需检查已收藏剧集，不影响观看进度'}</p>${list.length?`<div class="watchlist-grid">${list.map(f=>{
   const r=historyMetadata[f.id],observed=update[f.id],available=observed?.episodes||f.episodes||1,watched=r?.episode||0;
   return `<article class="watchlist-item">${card(f)}<div class="watchlist-detail"><label>分类<select data-watchlist-category data-id="${f.id}" aria-label="${esc(f.name)}的收藏分类">${Object.entries(categories).map(([key,label])=>`<option value="${key}" ${category(f)===key?'selected':''}>${label}</option>`).join('')}</select></label>${isSeries(f)?`<p>${observed?.verifiedAt?'上次核实更新至':'资料收录'} ${available} 集 · ${r?.completedEpisodes?.length?'已看 '+new Set(r.completedEpisodes).size+' 集（本机记录）':watched?'看到第 '+watched+' 集':'尚未观看'}</p>${newEpisode(f)?`<a class="text-button" href="#player/${f.id}" data-new-episode="${newEpisode(f)}" data-id="${f.id}">有新集 · 第 ${newEpisode(f)} 集</a>`:r?`<a class="text-button" href="#player/${f.id}" data-action="resume-history" data-id="${f.id}">${watchedComplete(r)?'重新观看':'继续观看'}</a>`:''}`:''}${observed?.state==='failed'?'<p>更新查询未完成，已保留上次结果</p>':''}${availability.markup(f.id)}</div></article>`;
  }).join('')}</div>`:`<div class="empty"><h2>${all.length?'此分类还没有影片':'还没有收藏'}</h2><a class="primary" href="#discover">探索影片</a></div>`}`;
 }
 async function refreshWatchlist(check){
  if(refreshing)return;refreshing=true;render();let checked=0,cached=0,failed=0;
  const records=load('watchlistRefresh',{}),targets=films.filter(f=>favorites.has(f.id)&&isSeries(f)&&category(f)!=='completed').sort((a,b)=>(records[a.id]?.checkedAt||0)-(records[b.id]?.checkedAt||0)).slice(0,10);
  try{for(const f of targets){
   if(records[f.id]?.checkedAt&&Date.now()-records[f.id].checkedAt<REFRESH){cached++;continue;}
   try{const result=await check(f);const episodes=Math.max(1,Number(result)||f.episodes||1);records[f.id]={checkedAt:Date.now(),verifiedAt:Date.now(),episodes,state:'ready'};checked++;}catch{records[f.id]={...records[f.id],checkedAt:Date.now(),state:'failed'};failed++;}
   save('watchlistRefresh',records);
  }}finally{refreshing=false;if(location.hash==='#library')await render();const status=document.querySelector('#watchlist-status');if(status)status.textContent=`已检查 ${checked} 部 · 复用 ${cached} 部${failed?` · ${failed} 部暂未完成`:''}${targets.length?'':' · 暂无需要检查的剧集'}`;}
 }
 document.addEventListener('click',async event=>{
  const categoryButton=event.target.closest('[data-library-category]');if(categoryButton){libraryCategory=categoryButton.dataset.libraryCategory;await render();document.querySelector(`[data-library-category="${libraryCategory}"]`)?.focus({preventScroll:true});}
  if(event.target.closest('[data-refresh-watchlist]'))void refreshWatchlist(window.LiveLibrary?.checkUpdates||(async f=>f.episodes));
 });
 document.addEventListener('change',event=>{if(event.target.matches('[data-watchlist-category]'))setCategory(event.target.dataset.id,event.target.value);});
 Object.assign(window.OpenStreamLibrary,{category,setCategory,libraryMarkup,refreshWatchlist});
})();

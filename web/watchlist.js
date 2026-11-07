(() => {
 const REFRESH=30*60*1000;
 const categories={watching:'在追',planned:'想看',completed:'已看完'};
 let libraryCategory='all',refreshing=false;
 const updateQueue=new Map();
 function category(f){const saved=load('watchlist',{})[f.id]?.status;if(categories[saved])return saved;const record=historyMetadata[f.id];return watchedComplete(record)&&(!isSeries(f)||(f.lines?.length&&window.OpenStreamEpisodes?OpenStreamEpisodes.catalog(f).some(item=>item.key===OpenStreamEpisodes.display(f,record).key)&&OpenStreamEpisodes.nextOrdinal(f,{episodeKey:OpenStreamEpisodes.display(f,record).key})===null:(record.episode||1)>=(f.episodes||1)))?'completed':record?'watching':'planned';}
 function setCategory(id,status){if(!favorites.has(id)||!categories[status])return;const records=load('watchlist',{});records[id]={status,updatedAt:new Date().toISOString()};save('watchlist',records);render();}
 function progressMarkup(f){
  const record=historyMetadata[f.id];
  if(!record)return '';
  const episode=isSeries(f)?(window.OpenStreamEpisodes?OpenStreamEpisodes.display(f,record).label:'第 '+(record.episode||1)+' 集'):'';
  const position=Number(record.position)||0;
  const completed=watchedComplete(record),update=updatedEpisodeLink(f);
  return `<div class="watchlist-progress">${episode?`<span class="watchlist-episode">${esc(episode)}</span>`:''}<span class="watchlist-position"><span>${esc(completed?'已看完':'看到 '+playbackTime(position))}</span><a class="text-button watchlist-resume" href="#player/${f.id}" data-action="resume-history" data-id="${f.id}">${completed?'重看':'继续'}</a></span></div>${update?`<div class="watchlist-actions">${update}</div>`:''}`;
 }
 function libraryMarkup(){
  const all=films.filter(f=>favorites.has(f.id)&&(!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(f))),list=all.filter(f=>libraryCategory==='all'||category(f)===libraryCategory);
  return `<div class="library-head"><div class="page-title"><h1>我的收藏</h1></div></div><div class="watchlist-filters" role="group" aria-label="收藏分类">${[['all','全部'],...Object.entries(categories)].map(([key,label])=>`<button class="chip ${libraryCategory===key?'selected':''}" data-library-category="${key}" aria-pressed="${libraryCategory===key}">${label} <small>${key==='all'?all.length:all.filter(f=>category(f)===key).length}</small></button>`).join('')}</div>${list.length?`<div class="poster-grid watchlist-grid">${list.map(f=>card(f).replace('class="poster-card"',`class="poster-card watchlist-item" data-watchlist-id="${f.id}"`).replace(/<\/article>$/,`<div class="watchlist-detail">${progressMarkup(f)}</div></article>`)).join('')}</div>`:`<div class="empty"><h2>${all.length?'此分类还没有影片':'还没有收藏'}</h2><a class="primary" href="#discover">探索影片</a></div>`}`;
 }
 function patchProgress(f){
  const target=document.querySelector(`[data-watchlist-id="${f.id}"] .watchlist-detail`),markup=progressMarkup(f);
  if(target&&target.innerHTML!==markup)target.innerHTML=markup;
 }
 async function refreshWatchlist(check,ids=null){
  if(typeof check!=='function')return;
  for(const f of films)if(favorites.has(f.id)&&isSeries(f)&&category(f)!=='completed'&&(!ids||ids.has(f.id)))updateQueue.set(f.id,{f,check});
  if(refreshing)return;refreshing=true;
  const records=load('watchlistRefresh',{});
  try{while(updateQueue.size){
   const [id,job]=updateQueue.entries().next().value;updateQueue.delete(id);const {f,check}=job;
   if(!favorites.has(id))continue;
   if(records[f.id]?.checkedAt&&Date.now()-records[f.id].checkedAt<REFRESH)continue;
   // Route entry triggers one serialized pass; leaving stops work before the next title.
   if(location.hash!=='#library')break;
   try{const result=await check(f);records[f.id]={checkedAt:Date.now(),verifiedAt:Date.now(),episodes:Math.max(1,Number(result)||f.episodes||1),state:'ready'};}catch{records[f.id]={...records[f.id],checkedAt:Date.now(),state:'failed'};}
   save('watchlistRefresh',records);if(location.hash==='#library')patchProgress(f);
  }}finally{refreshing=false;if(location.hash!=='#library')updateQueue.clear();}
 }
 function observeUpdates(check,signal){
  const observer=new IntersectionObserver(entries=>{const ids=new Set();for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);ids.add(entry.target.dataset.watchlistId);}if(ids.size)void refreshWatchlist(check,ids);},{rootMargin:'200px'});
  document.querySelectorAll('[data-watchlist-id]').forEach(node=>observer.observe(node));
  signal.addEventListener('abort',()=>{observer.disconnect();updateQueue.clear();},{once:true});
 }
 document.addEventListener('click',async event=>{
  const categoryButton=event.target.closest('[data-library-category]');if(categoryButton){libraryCategory=categoryButton.dataset.libraryCategory;await render();document.querySelector(`[data-library-category="${libraryCategory}"]`)?.focus({preventScroll:true});}
 });
 Object.assign(window.OpenStreamLibrary,{category,setCategory,libraryMarkup,refreshWatchlist,observeUpdates});
})();

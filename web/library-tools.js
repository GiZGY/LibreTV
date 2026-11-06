(() => {
 const FRESH=24*60*60*1000,FAIL_FRESH=60*60*1000;
 const cleanTime=value=>new Date(Number(value)).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const availability={
  record(filmId,state){
   if(!/^[a-z0-9_-]{1,80}$/i.test(filmId)||!['played','failed','sources','no_result','query_failed'].includes(state))return;
   const values=load('playability',{}),old=values[filmId];
   if(['sources','query_failed'].includes(state)&&['played','failed'].includes(old?.state)&&Date.now()-old.checkedAt<(old.state==='played'?FRESH:FAIL_FRESH))return;
   if(old?.state===state&&Date.now()-old.checkedAt<60000)return;
   values[filmId]={state,checkedAt:Date.now()};const sorted=Object.entries(values).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,300);save('playability',Object.fromEntries(sorted));
  },
  view(filmId,now=Date.now()){
   const value=load('playability',{})[filmId];if(!value||!Number.isFinite(value.checkedAt)||value.checkedAt>now+60000)return{state:'unknown',label:'尚未核实播放',detail:'影片资料不代表当前可播放'};
   const stale=now-value.checkedAt>(['failed','no_result','query_failed'].includes(value.state)?FAIL_FRESH:FRESH),labels={played:'近期播放成功',sources:'已找到线路 · 尚未播放',failed:'近期播放失败',no_result:'近期未找到片源',query_failed:'最近查询未完成'};
   return{...value,stale,label:stale?'核实结果已过期':labels[value.state]||'尚未核实播放',detail:cleanTime(value.checkedAt)+(stale?' · 可重新检查':'')};
  },
  markup(filmId){const value=availability.view(filmId);return `<p class="playability-note" title="${esc(value.detail)}">${esc(value.label)}${value.checkedAt?`<time datetime="${new Date(value.checkedAt).toISOString()}">${esc(value.detail)}</time>`:''}</p>`;}
 };
 const DISMISS_KEY=(window.OPENSTREAM_LIVE?'openstream_live_':'openstream_ui_')+'resume_notice_session_v1';
 let dismissed=new Set(),shownNotice=null;
 try{const stored=JSON.parse(sessionStorage.getItem(DISMISS_KEY)||'[]');if(Array.isArray(stored))dismissed=new Set(stored.filter(key=>typeof key==='string').slice(-100));}catch{}
 function continueWatching(){
  const after=(f,r)=>f.lines?.length&&window.OpenStreamEpisodes?OpenStreamEpisodes.nextOrdinal(f,{episodeKey:OpenStreamEpisodes.display(f,r).key}):((r?.episode||1)<(f.episodes||1)?true:null);
  const rows=history.map(id=>({f:films.find(f=>f.id===id),r:historyMetadata[id]})).filter(({f,r})=>{
   if(!f||!r||load('watchlist',{})[f.id]?.status==='completed'||window.OPENSTREAM_LIVE&&window.LiveData&&!LiveData.allowed(f))return false;
   const stamp=Date.parse(r.watchedAt);if(!Number.isFinite(stamp))return false;
   if(!Number.isFinite(r.position)||!Number.isFinite(r.duration)||r.position<=0||r.duration<=0||r.position>r.duration)return false;
   return !watchedComplete(r)||isSeries(f)&&after(f,r);
  }).sort((a,b)=>Date.parse(b.r.watchedAt)-Date.parse(a.r.watchedAt));
  const latest=rows[0];shownNotice=null;if(!latest)return '';
  const {f,r}=latest,key=JSON.stringify([f.id,r.episodeKey||[r.season||1,r.episode||1].join(':'),Math.floor(r.position),watchedComplete(r)]);
  // Dismissing the latest item must not reveal older history one entry at a time.
  if(dismissed.has(key))return '';shownNotice=key;
  const next=watchedComplete(r)&&isSeries(f),target=next&&f.lines?.length&&window.OpenStreamEpisodes?after(f,r):null,shown=target?{episode:target}:r,label=isSeries(f)?(window.OpenStreamEpisodes?OpenStreamEpisodes.display(f,shown).label:`第 ${r.season||1} 季 · 第 ${r.episode||1} ${f.type==='综艺'?'期':'集'}`):'';
  return `<aside class="continue-notice" aria-label="继续观看"><p class="continue-notice-title"><span>${esc(f.name)}</span>${label?`<span class="continue-notice-episode">${esc(label)}</span>`:''}</p><div class="continue-notice-actions"><a class="text-button" href="#player/${f.id}" data-id="${f.id}" ${next?'data-playback-intent="next"':'data-action="resume-history"'}>继续</a><button type="button" class="continue-notice-close" data-dismiss-resume aria-label="关闭继续观看提醒">×</button></div></aside>`;
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-dismiss-resume]'),notice=button?.closest('.continue-notice');if(!notice||!shownNotice)return;
  dismissed.add(shownNotice);dismissed=new Set([...dismissed].slice(-100));shownNotice=null;
  try{sessionStorage.setItem(DISMISS_KEY,JSON.stringify([...dismissed]));}catch{}
  const next=notice.nextElementSibling?.querySelector('a,button')||document.querySelector('#main');notice.remove();next?.focus({preventScroll:true});
 });
 window.OpenStreamLibrary={availability,continueWatching};
})();

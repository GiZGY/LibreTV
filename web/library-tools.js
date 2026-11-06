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
 function continueWatching(){
  const after=(f,r)=>f.lines?.length&&window.OpenStreamEpisodes?OpenStreamEpisodes.nextOrdinal(f,{episodeKey:OpenStreamEpisodes.display(f,r).key}):((r?.episode||1)<(f.episodes||1)?true:null);
  const list=history.map(id=>({f:films.find(f=>f.id===id),r:historyMetadata[id]})).filter(({f,r})=>f&&(!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(f))&&(!watchedComplete(r)||isSeries(f)&&after(f,r))).sort((a,b)=>Date.parse(b.r?.watchedAt||0)-Date.parse(a.r?.watchedAt||0)).slice(0,6);
  if(!list.length)return '';
  return `<section class="continue-section" aria-label="继续观看"><div class="section-head"><h2>继续观看</h2><a class="text-button" href="#history">全部记录 ${icon('arrow')}</a></div><div class="continue-list">${list.map(({f,r})=>{
   const next=watchedComplete(r)&&isSeries(f),target=next&&f.lines?.length&&window.OpenStreamEpisodes?after(f,r):null,shown=target?{episode:target}:r,label=window.OpenStreamEpisodes?OpenStreamEpisodes.display(f,shown).label:isSeries(f)?`第 ${r?.season||1} 季 · 第 ${r?.episode||1} ${f.type==='综艺'?'期':'集'}`:'正片',position=next?0:r?.position||0,progress=r?.duration&&!next?Math.min(100,position/r.duration*100):0;
   return `<article class="continue-item"><a class="continue-cover" href="#detail/${f.id}"><img ${posterAttributes(f,'90px')} alt="${esc(f.name)}海报" loading="lazy"></a><div class="continue-copy"><h3>${esc(f.name)}</h3><p>${esc(label)}</p><p>${next?'上集已看完':r?.duration?`看到 ${playbackTime(position)} / ${playbackTime(r.duration)}`:r?'尚未开始':'进度未保存'}</p><div class="progress" role="progressbar" aria-label="观看进度" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></div><a class="primary" href="#player/${f.id}" data-id="${f.id}" ${next?'data-playback-intent="next"':'data-action="resume-history"'}>${next?'播放下一集':position?'继续观看':'开始观看'}</a></div><button class="continue-remove" data-action="remove-history" data-id="${f.id}" aria-label="移除${esc(f.name)}的观看记录">×</button></article>`;
  }).join('')}</div></section>`;
 }
 window.OpenStreamLibrary={availability,continueWatching};
})();

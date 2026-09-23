const icons={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="white"/><circle cx="16" cy="17" r="2" fill="white"/>',play:'<path d="m7 4 14 8-14 8z"/>',arrow:'<path d="m8 5 7 7-7 7"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.arrow}</svg>`;
const films=[
{id:'interstellar',name:'星际穿越',en:'Interstellar',year:2014,genre:'科幻',rating:'9.4',length:'169 分钟',director:'克里斯托弗·诺兰',cast:'马修·麦康纳 / 安妮·海瑟薇',description:'当人类的未来不再属于地球，一群探索者穿越虫洞，寻找新的家园。在时间与宇宙的尽头，爱是唯一能够跨越维度的力量。'},
{id:'dune',name:'沙丘2',en:'Dune: Part Two',year:2024,genre:'科幻',rating:'8.2',length:'166 分钟',director:'丹尼斯·维伦纽瓦',cast:'提莫西·查拉梅 / 赞达亚',description:'保罗来到弗雷曼人的世界，在命运、爱情和权力之间，选择属于自己的道路。沙漠深处，一场改变宇宙的风暴正在酝酿。'},
{id:'inception',name:'盗梦空间',en:'Inception',year:2010,genre:'悬疑',rating:'9.4',length:'148 分钟',director:'克里斯托弗·诺兰',cast:'莱昂纳多·迪卡普里奥 / 约瑟夫·高登-莱维特',description:'梦境可以被进入，记忆可以被改变。一位盗梦者接受了一项危险任务：不是偷取一个想法，而是在潜意识深处种下它。'},
{id:'blade',name:'银翼杀手2049',en:'Blade Runner 2049',year:2017,genre:'科幻',rating:'8.4',length:'164 分钟',director:'丹尼斯·维伦纽瓦',cast:'瑞恩·高斯林 / 哈里森·福特',description:'一段埋藏多年的秘密，让银翼杀手踏上寻找答案的旅途。在霓虹与尘埃之间，何以为人的问题再次浮现。'},
{id:'oppenheimer',name:'奥本海默',en:'Oppenheimer',year:2023,genre:'传记',rating:'8.8',length:'180 分钟',director:'克里斯托弗·诺兰',cast:'基里安·墨菲 / 艾米莉·布朗特',description:'一位物理学家的选择，改变了世界的轨迹。从科学的突破到内心的审判，追寻那个时代留下的回响。'},
{id:'shawshank',name:'肖申克的救赎',en:'The Shawshank Redemption',year:1994,genre:'剧情',rating:'9.7',length:'142 分钟',director:'弗兰克·德拉邦特',cast:'蒂姆·罗宾斯 / 摩根·弗里曼',description:'在高墙之内，安迪与瑞德建立起跨越岁月的友谊。自由也许遥远，但希望始终有自己的方向。'}
];
const sampleShows = [
 ['city','长街来信','电视剧','剧情',2024,12,'7.8','#536c76'],
 ['north','北岸疑云','电视剧','悬疑',2023,8,'8.3','#5b637e'],
 ['summer','夏日慢行','电视剧','爱情',2025,16,'8.0','#b38168'],
 ['island','浮岛旅行记','动漫','奇幻',2024,12,'8.6','#6a8c8a'],
 ['orbit','轨道少年','动漫','科幻',2025,10,'8.1','#7771a6'],
 ['kitchen','周末厨房','综艺','美食',2024,10,'8.2','#b6854f'],
 ['walk','一起去远方','综艺','旅行',2025,8,'8.5','#638870'],
 ['rain','雨夜来客','电影','悬疑',2024,1,'7.9','#62697e'],
 ['return','归途','电影','剧情',2023,1,'8.1','#947b69'],
 ['moon','月面来信','电影','科幻',2025,1,'8.0','#626e83'],
 ['garden','花园日记','电影','爱情',2024,1,'7.6','#ad8b89']
];
for(const [id,name,type,yearGenre,year,count,rating,color] of sampleShows){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#18212e"/></linearGradient></defs><rect width="500" height="750" fill="url(#g)"/><circle cx="390" cy="170" r="170" fill="white" opacity=".12"/><path d="M0 560L320 290 500 440V750H0" fill="white" opacity=".08"/><text x="42" y="510" fill="white" font-size="42" font-family="sans-serif">${name}</text><text x="44" y="557" fill="white" opacity=".6" font-size="20">${type} · ${year}</text></svg>`;
 films.push({id,name,en:'',type,genre:yearGenre,year,episodes:count,seasons:count>1?2:1,rating,length:count>1?'每集 45 分钟':'112 分钟',director:'林远',cast:'陈予 / 许宁',description:'一段相遇，改变了原本平静的生活。随着故事展开，每个人都需要面对自己的选择。',art:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
}
let discoverPage=1,undoHistory=null;
const episodeState={};
function episodeFor(f){return episodeState[f.id]||(episodeState[f.id]={season:1,episode:1});}
function isSeries(f){return !['电影','纪录片'].includes(f.type)&&f.episodes>1;}
function episodePicker(f){if(!isSeries(f))return '';const state=episodeFor(f);return `<section class="detail-section"><div class="section-head"><h2>选集</h2><span>全 ${f.episodes} 集</span></div><div class="season-tabs">${Array.from({length:f.seasons},(_,i)=>`<button data-action="season" data-id="${f.id}" data-value="${i+1}" aria-pressed="${state.season===i+1}" class="chip ${state.season===i+1?'selected':''}">第 ${i+1} 季</button>`).join('')}</div><div class="episodes">${Array.from({length:f.episodes},(_,i)=>`<button class="episode ${state.episode===i+1?'active':''}" data-action="episode" data-id="${f.id}" data-value="${i+1}">${i+1}</button>`).join('')}</div></section>`;}
const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(k,d){try{return JSON.parse(localStorage.getItem((window.OPENSTREAM_LIVE?'openstream_live_':'openstream_ui_')+k))??d}catch{return d}}
function save(k,v){try{localStorage.setItem((window.OPENSTREAM_LIVE?'openstream_live_':'openstream_ui_')+k,JSON.stringify(v))}catch{toast('浏览器暂时无法保存偏好')}}
let favorites=new Set(load('favorites',window.OPENSTREAM_LIVE?[]:['interstellar','blade'])),history=load('history',window.OPENSTREAM_LIVE?[]:['interstellar','dune']),filters={type:'电影',genre:'全部',year:'全部',region:'全部',sort:'精选'},homeGenre='全部';let toastTimer;
const historyExamples={
 interstellar:{watchedAt:new Date(Date.now()-45*60000).toISOString(),position:2906,duration:10140},
 city:{watchedAt:new Date(Date.now()-3*3600000).toISOString(),position:1132,duration:2700,season:1,episode:5},
 kitchen:{watchedAt:new Date(Date.now()-26*3600000).toISOString(),position:3870,duration:5400,season:1,episode:3},
 island:{watchedAt:new Date(Date.now()-3*86400000).toISOString(),position:1420,duration:1440,season:2,episode:8},
 dune:{watchedAt:new Date(Date.now()-8*86400000).toISOString(),position:9960,duration:9960}
};
const historyMetadata=load('historyMetadataV2',window.OPENSTREAM_LIVE?{}:historyExamples);
if(!window.OPENSTREAM_LIVE&&!load('historyExamplesV2',false)){history=[...new Set([...history,...Object.keys(historyExamples)])];save('history',history);save('historyMetadataV2',historyMetadata);save('historyExamplesV2',true);}
function playbackTime(seconds){const m=Math.floor(seconds/60);return m+':'+String(seconds%60).padStart(2,'0');}
function watchedComplete(record){return !!record&&(record.completed===true||(record.duration>0&&record.position/record.duration>=.99));}
function newEpisode(f){const r=historyMetadata[f.id];return isSeries(f)&&r&&r.totalEpisodes>0&&f.episodes>r.totalEpisodes?r.totalEpisodes+1:0;}
function historyLabel(id){const record=historyMetadata[id];return watchedComplete(record)?'重新观看':record?'继续播放 · '+playbackTime(record.position):'立即观看';}
function watchedTime(value){if(!value)return '观看时间未知';return new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2300)}
const img=f=>f.art||`assets/${f.id}.jpg`;
function posterAttributes(f,sizes='(max-width:700px) 44vw, 220px'){
 const src=img(f),match=/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+(\/[\w.-]+)$/.exec(src);
 const responsive=match?` srcset="${[185,342,500,780].map(width=>`https://image.tmdb.org/t/p/w${width}${match[1]} ${width}w`).join(', ')}" sizes="${esc(sizes)}"`:'';
 return `src="${esc(src)}"${responsive} decoding="async"`;
}
function scoreClass(value){const n=Number(value);return !Number.isFinite(n)||n<=0?'score-neutral':n>=7?'score-high':'score-neutral';}
function certificationMarkup(f){const c=f.certification;if(c?.country!=='US'||!['G','PG','PG-13','R','NC-17'].includes(c.label))return '';return `<span class="film-certification ${c.label==='R'?'is-restricted':''}" title="美国电影分级：${esc(c.label)}" aria-label="美国电影分级：${esc(c.label)}">${esc(c.label)}</span>`;}
const card=(f,featured=false)=>window.OPENSTREAM_LIVE&&window.LiveData&&!LiveData.allowed(f)?'':`<article class="poster-card"><a href="#detail/${f.id}"><div class="poster-art"><img class="poster-ambient" ${posterAttributes(f,featured?'(max-width:700px) 190px, 280px':undefined)} alt="" aria-hidden="true" loading="lazy" referrerpolicy="no-referrer"><img ${posterAttributes(f,featured?'(max-width:700px) 190px, 280px':undefined)} alt="${esc(f.name)}海报" referrerpolicy="no-referrer" loading="${featured?'eager':'lazy'}" width="500" height="750"><span class="play-hint" aria-hidden="true">▷</span></div><h3 title="${esc(f.name)}">${esc(f.name)}</h3><p class="poster-meta"><span>${esc([f.year||'年份未收录',f.genre||f.type].filter(Boolean).join(' / '))}</span>${Number(f.rating)>0?`<span class="poster-score ${scoreClass(f.rating)}" title="${esc(f.ratingSource||'评分')}">${f.ratingSource==='TMDB'?'<span class="rating-provider">TMDB </span>':''}★ ${esc(f.rating)}</span>`:''}${certificationMarkup(f)}</p></a><button class="quick-favorite favorite-button" aria-label="${favorites.has(f.id)?'取消收藏':'收藏'}${esc(f.name)}" aria-pressed="${favorites.has(f.id)}" data-action="favorite" data-id="${f.id}">${icon('bookmark')}</button></article>`;
const grid=list=>{list=list.filter(f=>!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(f));return list.length?`<div class="poster-grid">${list.map(f=>card(f)).join('')}</div>`:`<div class="empty"><h2>暂时没有找到影片</h2><p>换个关键词，或试试其他筛选条件。</p><button class="primary" data-action="reset">查看全部影片</button></div>`;};
function chips(items,current,key,style='',labels={}){return items.map(x=>`<button class="chip ${style} ${x===current?'selected':''}" data-filter="${key}" data-value="${x}" aria-pressed="${x===current}">${labels[x]||x}</button>`).join('')}
function heroMarkup(){
 const featured=films.filter(f=>(f.type||'电影')==='电影'&&Number(f.rating)>=7);
 // Repeating the set keeps each loop group wider than the visible canvas.
 const items=[...featured,...featured];
 const group=duplicate=>`<div class="film-ribbon-group" ${duplicate?'aria-hidden="true"':''}>${items.map((film,i)=>{
  let markup=card(film,true).replace('<article class="poster-card"',i>=featured.length?'<article data-loop-copy="true" class="poster-card"':'<article class="poster-card"');
  if(duplicate||i>=featured.length)markup=markup.replace('<a ','<a tabindex="-1" ').replace('<button ','<button tabindex="-1" ');
  return markup;
 }).join('')}</div>`;
 return `<section class="film-ribbon poster-ribbon" aria-label="精选影片"><div class="film-ribbon-track">${group(false)}${group(true)}</div></section>`;
}





function home(){return `<div id="hero-slot">${heroMarkup()}</div><div class="section-head"><h2>推荐影片</h2><a class="text-button" href="#discover">发现更多 ${icon('arrow')}</a></div><div class="filter-tabs">${chips(['全部','科幻','悬疑','剧情','传记'],homeGenre,'home')}</div><div id="home-recommendations" class="poster-grid">${films.filter(f=>(f.type||'电影')==='电影').map(f=>card(f).replace('<article class="poster-card"',`<article data-home-genre="${esc(f.genre)}" ${homeGenre!=='全部'&&f.genre!==homeGenre?'hidden':''} class="poster-card"`)).join('')}</div><div class="section-head"><h2>剧集与动漫</h2></div>${grid(films.filter(f=>['电视剧','动漫'].includes(f.type)))}<div class="section-head"><h2>综艺</h2></div>${grid(films.filter(f=>f.type==='综艺'))}`;}
const filterScroll = {};
function filterStrip(label,key,items) {
  return `<div class="discovery-row"><span class="discovery-label" id="label-${key}">${label}</span><button class="strip-arrow" data-action="strip" data-key="${key}" data-direction="-1" aria-label="向左滚动${label}">${icon('arrow')}</button><div class="filter-strip" data-strip="${key}" role="group" aria-labelledby="label-${key}">${chips(items,filters[key],key)}</div><button class="strip-arrow" data-action="strip" data-key="${key}" data-direction="1" aria-label="向右滚动${label}">${icon('arrow')}</button></div>`;
}
function discover(){
  let list=films.filter(f=>(filters.genre==='全部'||f.genre===filters.genre)&&(filters.year==='全部'||String(f.year)===filters.year)&&(f.type||'电影')===filters.type);
  if(filters.sort==='评分最高')list.sort((a,b)=>b.rating-a.rating);
  if(filters.sort==='最新上映')list.sort((a,b)=>b.year-a.year);
  const years=['全部',...Array.from({length:new Date().getFullYear()-1990+1},(_,i)=>String(new Date().getFullYear()-i))];
  const pages=Math.max(1,Math.ceil(list.length/6));discoverPage=Math.min(discoverPage,pages);
  const active=filters.genre!=='全部'||filters.year!=='全部'||filters.type!=='电影'||filters.sort!=='精选';
  return `<div class="discovery-heading"><h1>探索影片</h1><button class="text-button" data-action="reset" ${active?'':'disabled'}>重置筛选</button></div><div class="discovery-filters">${filterStrip('分类','type',['电影','电视剧','动漫','综艺','纪录片'])}${filterStrip('题材','genre',['全部','科幻','悬疑','剧情','传记','喜剧','爱情','动作','冒险','惊悚','犯罪','动画','战争','历史','奇幻','家庭','美食','旅行'])}${filterStrip('年份','year',years)}</div><div class="results-head discovery-results"><span>${list.length} 部影片</span><div class="sort-options" role="group" aria-label="排序">${chips(['精选','最新上映','评分最高'],filters.sort,'sort')}</div></div>${grid(list.slice((discoverPage-1)*6,discoverPage*6))}<div class="pagination"><button data-action="page" data-value="-1" ${discoverPage===1?'disabled':''}>上一页</button><span>第 ${discoverPage} / ${pages} 页</span><button data-action="page" data-value="1" ${discoverPage===pages?'disabled':''}>下一页</button></div>`;
}

function detail(f){return `<a class="back" href="${listOrigin}">← 返回列表</a><div class="detail-layout"><img class="detail-poster" ${posterAttributes(f,'(max-width:700px) 44vw, 300px')} alt="${esc(f.name)}海报"><div class="detail-content"><h1>${esc(f.name)}</h1><p class="english">${esc(f.en)}</p><div class="meta"><span class="score ${scoreClass(f.rating)}" title="${esc(f.ratingSource||'评分')}">${f.ratingSource==='TMDB'?'TMDB ':''}★ ${esc(f.rating)}</span>${certificationMarkup(f)}<span data-detail-year>${esc(f.year||'年份未收录')}</span><span data-detail-genre>${esc(f.genre||f.type)}</span><span>${esc(f.length)}</span></div><p class="synopsis">${esc(f.description)}</p><p class="credits">导演　${esc(f.director)}<br>主演　${esc(f.cast)}</p><div class="actions"><a href="#player/${f.id}" class="primary">${icon('play')}${history.includes(f.id)?historyLabel(f.id):'立即观看'}</a><button class="secondary favorite-button" aria-pressed="${favorites.has(f.id)}" data-action="favorite" data-id="${f.id}">${icon('bookmark')}${favorites.has(f.id)?'已收藏':'加入收藏'}</button></div></div></div>${episodePicker(f)}<div class="section-head"><h2>相关推荐</h2></div><div id="related-films">${window.OPENSTREAM_LIVE?'<p class="related-empty">正在寻找相关影片…</p>':grid(window.FilmMetadata?.related(f,films)||[])}</div>`}
function player(f){
 const state=episodeFor(f),serial=isSeries(f);
 const episode=serial?`第 ${state.season} 季 · 第 ${state.episode} ${f.type==='综艺'?'期':'集'}`:'正片';
 return `<section class="watch-page"><div class="watch-heading"><a class="back" href="#detail/${f.id}">${icon('arrow')}返回详情</a><span>${f.type||'电影'} · ${esc(f.year)}</span></div><div class="watch-layout"><div class="watch-main"><div class="watch-screen" id="screen"><div id="watch-player" aria-label="影片播放器"></div></div></div><aside class="watch-side-column"><div class="watch-aside ${serial?'has-episodes':''}"><div class="watch-side-heading"><h2>${esc(f.name)}</h2><button class="secondary favorite-button" aria-pressed="${favorites.has(f.id)}" data-action="favorite" data-id="${f.id}">${icon('bookmark')}${favorites.has(f.id)?'已收藏':'收藏'}</button></div><div class="watch-film-info"><span class="score ${scoreClass(f.rating)}" title="${esc(f.ratingSource||'评分')}">${f.ratingSource==='TMDB'?'TMDB ':''}★ ${esc(f.rating)}</span><span>${esc(f.year)} · ${esc(f.genre)}</span><span>${esc(f.length)}</span></div><section class="watch-synopsis" aria-label="影片简介">${String(f.description||'').length>100?`<details class="watch-plot"><summary><span class="plot-expand">展开</span><span class="plot-collapse">收起</span></summary><p>${esc(f.description)}</p></details><p class="plot-preview">${esc(f.description)}</p>`:`<p>${esc(f.description)}</p>`}</section><dl class="watch-credits"><dt>导演</dt><dd>${esc(f.director)}</dd><dt>主演</dt><dd>${esc(f.cast)}</dd></dl>${serial?`<div class="watch-next"><button class="secondary" data-action="episode" data-id="${f.id}" data-value="${Math.max(1,state.episode-1)}" ${state.episode===1?'disabled':''}>上一集</button><label>自动连播 <input class="switch" type="checkbox" aria-label="自动连播" data-watch-autoplay ${load('autoplay',true)?'checked':''}></label><button class="secondary" data-action="episode" data-id="${f.id}" data-value="${Math.min(f.episodes,state.episode+1)}" ${state.episode===f.episodes?'disabled':''}>下一集</button></div>`:''}${serial?episodePicker(f):''}</div><details class="watch-routes" aria-label="播放线路"><summary class="routes-heading"><span>播放线路 <small>12 条</small></span><span class="route-current">当前 综合影视</span><span class="route-switch">切换源</span></summary><div class="watch-source-list">${Array.from({length:12},(_,i)=>`<button class="source-button ${i===0?'active':''}" data-action="source" aria-pressed="${i===0}"><span class="source-dot"></span><span>${i===0?'综合影视':'备用线路 '+i}</span><svg viewBox="0 0 24 24" class="source-check"><path d="m5 12 4 4L19 6"/></svg></button>`).join('')}</div></details></aside></div></section>`;
}

function library(){let list=films.filter(f=>favorites.has(f.id)&&(!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(f)));return `<div class="page-title"><h1>我的收藏</h1></div><div class="results-head"><span>${list.length} 部影片</span></div>${list.length?grid(list):'<div class="empty"><h2>还没有收藏</h2><a class="primary" href="#discover">探索影片</a></div>'}` }
let historyOlderOpen=false,historyOlderLimit=20;
function historyBucket(record,now=new Date()){
 const stamp=new Date(record.watchedAt).getTime();
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
 const week=new Date(today);week.setDate(today.getDate()-6);
 return stamp>=today.getTime()?'今天':stamp>=yesterday.getTime()?'昨天':stamp>=week.getTime()?'近 7 天':'7 天以前';
}
function historyRow({film:f,record:r}){
 const progress=r.duration?Math.min(100,r.position/r.duration*100):0;
 const episode=f.episodes>1?`第 ${r.season||1} 季 · 第 ${r.episode||1} ${f.type==='综艺'?'期':'集'}`:'正片';
 return `<article class="history-item"><img ${posterAttributes(f,'80px')} loading="lazy" alt="${esc(f.name)}"><div class="history-copy"><h3>${esc(f.name)}</h3><time datetime="${r.watchedAt||''}">${watchedTime(r.watchedAt)}</time><p>${episode} · ${watchedComplete(r)?'已看完':r.duration?'看到 '+playbackTime(r.position)+' / '+playbackTime(r.duration):'进度未知'}</p><div class="progress" role="progressbar" aria-label="观看进度" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></div></div><a href="#player/${f.id}" data-action="resume-history" data-id="${f.id}" class="primary">${watchedComplete(r)?'重新观看':'继续观看'}</a>${newEpisode(f)?`<a class="text-button" href="#player/${f.id}" data-new-episode="${newEpisode(f)}" data-id="${f.id}">有新集 · 第 ${newEpisode(f)} 集</a>`:''}<button class="remove" data-action="remove-history" data-id="${f.id}" aria-label="移除${esc(f.name)}的观看记录">移除</button></article>`;

}
function historyPage(){
 const records=history.map(id=>({film:films.find(f=>f.id===id),record:historyMetadata[id]||{}})).filter(x=>x.film&&(!window.OPENSTREAM_LIVE||!window.LiveData||LiveData.allowed(x.film))).sort((a,b)=>new Date(b.record.watchedAt||0)-new Date(a.record.watchedAt||0));
 const groups=new Map(['今天','昨天','近 7 天','7 天以前'].map(label=>[label,[]]));
 for(const row of records)groups.get(historyBucket(row.record)).push(row);
 const sections=[...groups].filter(([,rows])=>rows.length).map(([label,rows])=>{
  if(label==='7 天以前')return `<details class="history-older" ${historyOlderOpen?'open':''}><summary>7 天以前 <span>· ${rows.length} 条</span></summary><div class="history-list">${rows.slice(0,historyOlderLimit).map(historyRow).join('')}</div>${rows.length>historyOlderLimit?'<button class="text-button history-more" data-history-more>显示更多</button>':''}</details>`;
  return `<section class="history-group"><h2>${label}</h2><div class="history-list">${rows.map(historyRow).join('')}</div></section>`;
 }).join('');
 return `<div class="library-head"><div class="page-title"><h1>观看历史</h1></div>${records.length?'<button class="text-button" data-action="clear-history">清空历史</button>':''}</div>${sections||'<div class="empty"><h2>还没有观看记录</h2><a class="primary" href="#discover">探索影片</a></div>'}`;
}
document.addEventListener('toggle',event=>{if(event.target.matches?.('.history-older'))historyOlderOpen=event.target.open;},true);
document.addEventListener('click',event=>{if(event.target.closest('[data-history-more]')){historyOlderOpen=true;historyOlderLimit+=20;render();}});

function render(){let [page='home',id='']=(location.hash.slice(1)||'home').split('/');let f=films.find(x=>x.id===id);document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===page));$('#crumb').textContent=({home:'发现 / 为你推荐',discover:'发现 / 全部影片',library:'我的空间 / 收藏',history:'我的空间 / 观看历史',detail:'发现 / 影片详情',player:'正在观看',search:'发现 / 搜索',about:'关于 OpenStream'})[page]||'发现';if(page==='home')$('#main').innerHTML=home();else if(page==='discover')$('#main').innerHTML=discover();else if(page==='library')$('#main').innerHTML=library();else if(page==='history')$('#main').innerHTML=historyPage();else if(['detail','player'].includes(page)&&f)$('#main').innerHTML=page==='detail'?detail(f):player(f);else if(page==='search'){let q;try{q=decodeURIComponent(id)}catch{q=''}$('#search').value=q;let list=films.filter(f=>(f.name+f.en+f.director).toLowerCase().includes(q.toLowerCase()));$('#main').innerHTML=`<div class="page-title"><h1>搜索结果</h1><p>“${esc(q)}” · 找到 ${list.length} 部影片</p></div>${grid(list)}`}else if(page==='about')$('#main').innerHTML='<article class="article"><div class="page-title"><h1>关于 OpenStream</h1></div><p>OpenStream 提供影片搜索、分类浏览与播放功能。</p><h2>隐私</h2><p>收藏和偏好仅保存在当前浏览器，不向服务器发送。</p><h2>内容与版权</h2><p>电影海报和剧照用于本地界面展示，版权归各自权利方所有。影片资料与图片来源：TMDB。OpenStream 不属于 TMDB 官方产品。</p></article>';else $('#main').innerHTML='<div class="empty"><h2>没有找到这个页面</h2><a class="primary" href="#home">返回首页</a></div>';document.title=(f?f.name+' · ':'')+'OpenStream';}
$('#search-form').addEventListener('submit',e=>{e.preventDefault();openCommand()});
document.addEventListener('click',e=>{const filter=e.target.closest('[data-filter]');if(filter){if(filter.dataset.filter==='home'){if(homeGenre===filter.dataset.value)return;homeGenre=filter.dataset.value;document.querySelectorAll('[data-filter="home"]').forEach(button=>{const selected=button.dataset.value===homeGenre;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('#home-recommendations [data-home-genre]').forEach(card=>{card.hidden=homeGenre!=='全部'&&card.dataset.homeGenre!==homeGenre});return}discoverPage=1;document.querySelectorAll('[data-strip]').forEach(el=>filterScroll[el.dataset.strip]=el.scrollLeft);const focusKey=filter.dataset.filter,focusValue=filter.dataset.value;if(filter.dataset.filter==='home')homeGenre=filter.dataset.value;else filters[filter.dataset.filter]=filter.dataset.value;render();document.querySelectorAll('[data-strip]').forEach(el=>el.scrollLeft=filterScroll[el.dataset.strip]||0);const selected=[...document.querySelectorAll('[data-filter]')].find(el=>el.dataset.filter===focusKey&&el.dataset.value===focusValue);selected?.focus({preventScroll:true});return}const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='settings')$('#settings').showModal();if(a==='close')$('#settings').close();if(a==='favorite')toggleFavorite(b.dataset.id);if(a==='reset'){discoverPage=1;filters={type:'电影',genre:'全部',year:'全部',region:'全部',sort:'精选'};location.hash='discover';render()}if(a==='scifi'){filters={type:'电影',genre:'科幻',year:'全部',region:'全部',sort:'精选'};location.hash='discover'}if(a==='preview-play'){const panel=$('.screen-center');if(panel){panel.innerHTML='<p role="status">正在加载…</p>';const screen=$('#screen');setTimeout(()=>{if(screen.isConnected)panel.innerHTML='<p role="alert">影片暂不可播放</p><button class="secondary" data-action="preview-play">重试</button>';},650)}else toast('影片暂不可播放，请稍后再试')}if(a==='source'){document.querySelectorAll('.source-button').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-pressed','false')});b.classList.add('active');b.setAttribute('aria-pressed','true');toast('已切换'+b.textContent)}if(a==='fullscreen'){if(document.fullscreenElement)document.exitFullscreen();else $('#screen')?.requestFullscreen?.().catch(()=>toast('当前浏览器不支持全屏'))}if(a==='clear-history'){if(confirm('清空全部观看记录？')){undoHistory=[...history];history=[];save('history',history);render();showUndo()}}if(a==='remove-history'){undoHistory=[...history];history=history.filter(x=>x!==b.dataset.id);save('history',history);render();showUndo()}});
document.addEventListener('change',e=>{if(e.target.id==='year'){filters.year=e.target.value;render()}if(e.target.id==='sort'){filters.sort=e.target.value;render()}});
for(const id of ['autoplay','motion']){$('#'+id).checked=load(id,id!=='motion');$('#'+id).addEventListener('change',e=>{save(id,e.target.checked);if(id==='motion')document.body.classList.toggle('reduce-motion',e.target.checked)})}document.body.classList.toggle('reduce-motion',load('motion',false));$('#settings').addEventListener('click',e=>{if(e.target===$('#settings')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
document.addEventListener('keydown',e=>{if(((e.key.toLowerCase()==='k'&&(e.metaKey||e.ctrlKey))||(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)))&&!$('#settings').open){e.preventDefault();openCommand()}});let listOrigin='#home';
document.querySelectorAll('[data-icon]').forEach(el=>el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon)));if(!window.OPENSTREAM_LIVE)render();

const command = $('#command');
const commandInput = $('#command-input');
let recentQueries = load('recentQueries', []);
let commandItems = [], commandIndex = -1;
let commandOpener;
function openCommand() {
  if (command.open) return;
  commandOpener = document.activeElement;
  commandInput.value = '';
  command.showModal();
  renderCommand();
  commandInput.focus();
}
function renderCommand() {
  const query = commandInput.value.trim();
  commandItems = query ? films.filter(f => (f.name + f.en + f.director).toLowerCase().includes(query.toLowerCase())).map(f => ({label:f.name, film:f})) : recentQueries.map(label => ({label}));
  commandIndex = -1;
  commandInput.removeAttribute('aria-activedescendant');
  $('#command-results').innerHTML = commandItems.length ? `${!query?'<div class="command-label">最近搜索</div>':''}${commandItems.map((item,i)=>`<button class="command-result" role="option" aria-selected="false" id="suggestion-${i}" data-suggestion="${i}">${item.film?`<img src="${img(item.film)}" alt=""><span>${esc(item.label)}<small>${item.film.year} · ${item.film.genre}</small></span>`:`<span>${esc(item.label)}</span>`}<span class="result-arrow">↵</span></button>`).join('')}` : `<p class="command-empty">${query?'没有找到相关影片':'输入片名开始搜索'}</p>${query?'<button class="primary full" data-action="search-all">搜索全部片源</button>':''}`;
}
function selectCommand(index) {
  const item = commandItems[index];
  if (!item) return;
  if (!item.film) {commandInput.value=item.label;renderCommand();commandInput.focus();return;}
  const query = commandInput.value.trim();
  recentQueries = [query,...recentQueries.filter(q=>q!==query)].slice(0,6);
  save('recentQueries',recentQueries);
  command.close();
  location.hash='detail/'+item.film.id;
}
$('#search').addEventListener('click',openCommand);
commandInput.addEventListener('input',renderCommand);
$('#command-close').addEventListener('click',()=>command.close());
command.addEventListener('close',()=>commandOpener?.focus());
command.addEventListener('click',e=>{const option=e.target.closest('[data-suggestion]');if(option)selectCommand(Number(option.dataset.suggestion));if(e.target===command){const r=command.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)command.close();}});
commandInput.addEventListener('keydown',e=>{
  if(['ArrowDown','ArrowUp'].includes(e.key)&&commandItems.length){e.preventDefault();commandIndex=(commandIndex+(e.key==='ArrowDown'?1:-1)+commandItems.length)%commandItems.length;command.querySelectorAll('[role="option"]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===commandIndex)));commandInput.setAttribute('aria-activedescendant','suggestion-'+commandIndex);$('#suggestion-'+commandIndex).scrollIntoView({block:'nearest'});}
  if(e.key==='Enter'){e.preventDefault();if(!commandItems.length&&commandInput.value.trim()){searchAll();return;}selectCommand(commandIndex<0?0:commandIndex);}
});
// Keep each list's position separate from detail and playback routes.
const routeScroll = new Map();
let previousRoute = location.hash || '#home';
let restoringRoute=false;
window.addEventListener('scroll',()=>{if(!restoringRoute)routeScroll.set(previousRoute,window.scrollY);},{passive:true});
window.addEventListener('hashchange',async()=>{
  const next = location.hash || '#home';document.body.classList.remove('lights-off');
  if(!/^#(detail|player)\//.test(previousRoute))listOrigin=previousRoute;
  const targetY=routeScroll.get(next)||0;previousRoute=next;restoringRoute=true;
  try{await render();}finally{if((location.hash||'#home')===next)requestAnimationFrame(()=>{if((location.hash||'#home')===next){window.scrollTo(0,targetY);restoringRoute=false;}});}
});

function showUndo(){
  toast('已移除观看记录');clearTimeout(toastTimer);
  const button=document.createElement('button');button.textContent='撤销';button.dataset.action='undo';$('#toast').append(button);
  toastTimer=setTimeout(()=>{$('#toast').classList.remove('visible');undoHistory=null;},10000);
}
function searchAll(){command.close();toast('全部片源搜索暂不可用');}
function updateStripArrows(){document.querySelectorAll('[data-strip]').forEach(strip=>{const row=strip.parentElement;row.querySelector('[data-direction="-1"]').disabled=strip.scrollLeft<2;row.querySelector('[data-direction="1"]').disabled=strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-2;});}
let stripFrame=0;
function scheduleStripUpdate(){if(stripFrame)return;stripFrame=requestAnimationFrame(()=>{stripFrame=0;updateStripArrows();});}
new MutationObserver(scheduleStripUpdate).observe($('#main'),{childList:true,subtree:true});
document.addEventListener('scroll',e=>{if(e.target.matches?.('[data-strip]'))scheduleStripUpdate();},true);
window.addEventListener('resize',scheduleStripUpdate);
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const a=b.dataset.action;



 if(a==='strip'){const strip=document.querySelector(`[data-strip="${b.dataset.key}"]`);strip.scrollBy({left:Number(b.dataset.direction)*strip.clientWidth*.75,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 if(a==='page'){discoverPage+=Number(b.dataset.value);render();$('.discovery-results').scrollIntoView({block:'start'});}
 if(a==='undo'&&undoHistory){history=undoHistory;undoHistory=null;save('history',history);if(location.hash==='#history')render();toast('已恢复观看记录');}
 if(a==='search-all')searchAll();
 if(a==='season'||a==='episode'){const f=films.find(f=>f.id===b.dataset.id);const state=episodeFor(f);state[a]=Number(b.dataset.value);if(a==='season')state.episode=1;if(a==='episode'&&!location.hash.startsWith('#player/'))location.hash='player/'+f.id;else render();}
 if(a==='lights'){const off=document.body.classList.toggle('lights-off');b.textContent=off?'开灯':'关灯';b.setAttribute('aria-pressed',String(off));}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('lights-off');});

updateStripArrows();

document.querySelector('.nav-toggle').addEventListener('click',event=>{
 const collapsed=document.body.classList.toggle('nav-collapsed');
 event.currentTarget.setAttribute('aria-expanded',String(!collapsed));
 event.currentTarget.setAttribute('aria-label',collapsed?'展开导航':'收起导航');
});

const darkMode=document.querySelector('#dark-mode');
let themeFrame;
function applyTheme(dark){const root=document.documentElement;root.classList.add('theme-changing');void root.offsetWidth;cancelAnimationFrame(themeFrame);themeFrame=requestAnimationFrame(()=>{themeFrame=requestAnimationFrame(()=>root.classList.remove('theme-changing'));});document.documentElement.dataset.theme=dark?'dark':'light';darkMode.checked=dark;const button=document.querySelector('.theme-toggle');button.setAttribute('aria-label',dark?'切换到日间模式':'切换到夜间模式');button.title=button.getAttribute('aria-label');}
applyTheme(load('darkMode',false));
darkMode.addEventListener('change',()=>{applyTheme(darkMode.checked);save('darkMode',darkMode.checked);});


let favoriteUndoId=null;
function syncFavoriteButtons(){
 document.querySelectorAll('[data-action="favorite"]').forEach(button=>{
  const active=favorites.has(button.dataset.id);
  button.setAttribute('aria-pressed',String(active));
  const compact=button.classList.contains('quick-favorite');
  button.innerHTML=icon('bookmark')+(compact?'':active?'已收藏':'加入收藏');
  if(compact)button.setAttribute('aria-label',(active?'取消收藏':'收藏')+films.find(f=>f.id===button.dataset.id).name);
 });
}
function toggleFavorite(id){
 const removed=favorites.delete(id);
 if(!removed)favorites.add(id);
 save('favorites',[...favorites]);
 if(location.hash==='#library')render();else syncFavoriteButtons();
 favoriteUndoId=removed?id:null;
 toast(removed?'已取消收藏':'已加入收藏');
 if(!removed)return;
 clearTimeout(toastTimer);
 const button=document.createElement('button');
 button.textContent='撤销';button.dataset.action='undo-favorite';
 $('#toast').append(button);
 toastTimer=setTimeout(()=>{$('#toast').classList.remove('visible');favoriteUndoId=null;},5000);
}
document.addEventListener('click',event=>{
 if(!event.target.closest('[data-action="undo-favorite"]')||!favoriteUndoId)return;
 favorites.add(favoriteUndoId);favoriteUndoId=null;
 save('favorites',[...favorites]);
 if(location.hash==='#library')render();else syncFavoriteButtons();
 toast('已恢复收藏');
});

document.addEventListener('pointerdown',event=>{const poster=event.target.closest('.poster-art');const ribbon=poster?.closest('.film-ribbon');if(ribbon)ribbon.classList.add('is-held');});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>document.querySelector('.film-ribbon')?.classList.remove('is-held'));
function collapseNavigation(){
 document.body.classList.add('nav-collapsed');
 const button=document.querySelector('.nav-toggle');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','展开导航');
}
document.addEventListener('click',event=>{if(!event.target.closest('.sidebar')||event.target.closest('.sidebar nav a'))collapseNavigation();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')collapseNavigation();});

document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';applyTheme(dark);save('darkMode',dark);});

const mobileThemeQuery=matchMedia('(max-width:700px)');
const autoTheme=document.querySelector('#auto-theme');
autoTheme.checked=load('mobileAutoTheme',true);
function refreshAppearance(){
 const automatic=mobileThemeQuery.matches&&autoTheme.checked;
 darkMode.disabled=automatic;
 if(automatic){const hour=new Date().getHours();applyTheme(hour<7||hour>=19);}
 else applyTheme(load('darkMode',false));
}
autoTheme.addEventListener('change',()=>{save('mobileAutoTheme',autoTheme.checked);refreshAppearance();});
mobileThemeQuery.addEventListener('change',refreshAppearance);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAppearance();});
setInterval(()=>{if(!document.hidden&&mobileThemeQuery.matches&&autoTheme.checked)refreshAppearance();},60000);
refreshAppearance();

// Drag the running animation from its current phase; reduced motion uses native scrolling.
const draggableShelfSelector='.poster-ribbon, #home-recommendations > .poster-grid, #live-tv > .poster-grid, .watch-source-list';
let ribbonDrag=null;
let suppressRibbonClick=false;
document.addEventListener('pointerdown',event=>{
 const ribbon=event.target.closest(draggableShelfSelector);
 if(!ribbon||event.pointerType!=='mouse'||event.button!==0||(event.target.closest('button')&&!ribbon.matches('.watch-source-list')))return;
 const track=ribbon.querySelector('.film-ribbon-track');
 const animation=track?.getAnimations()[0];
 const duration=animation?.effect.getTiming().duration;
 const distance=track?track.getBoundingClientRect().width/2:0;
 if(!ribbon.matches('.watch-source-list'))event.preventDefault();
 suppressRibbonClick=false;
 ribbonDrag={ribbon,id:event.pointerId,x:event.clientX,scroll:ribbon.scrollLeft,animation,duration,distance,time:Number(animation?.currentTime)||0,moved:false};
});
document.addEventListener('pointermove',event=>{
 if(!ribbonDrag||event.pointerId!==ribbonDrag.id)return;
 const delta=event.clientX-ribbonDrag.x;
 if(!ribbonDrag.moved&&Math.abs(delta)<6)return;
 if(!ribbonDrag.moved){ribbonDrag.moved=true;ribbonDrag.ribbon.setPointerCapture(event.pointerId);ribbonDrag.ribbon.classList.add('is-dragging');}
 event.preventDefault();
 const drag=ribbonDrag;
 if(drag.animation&&drag.distance>0){const time=drag.time-delta/drag.distance*drag.duration;drag.animation.currentTime=((time%drag.duration)+drag.duration)%drag.duration;}
 else drag.ribbon.scrollLeft=drag.scroll-delta;
});
function finishRibbonDrag(event){
 if(!ribbonDrag||event.pointerId!==ribbonDrag.id)return;
 const {ribbon,id,moved}=ribbonDrag;
 suppressRibbonClick=moved;
 ribbon.classList.remove('is-dragging');
 if(ribbon.hasPointerCapture(id))ribbon.releasePointerCapture(id);
 ribbonDrag=null;
}
document.addEventListener('pointerup',finishRibbonDrag);
document.addEventListener('pointercancel',finishRibbonDrag);
document.addEventListener('dragstart',event=>{if(ribbonDrag&&event.target.closest(draggableShelfSelector))event.preventDefault();});
document.addEventListener('click',event=>{
 if(suppressRibbonClick&&event.target.closest(draggableShelfSelector)){event.preventDefault();event.stopImmediatePropagation();suppressRibbonClick=false;}
},true);

document.addEventListener('click',event=>{
 const resume=event.target.closest('[data-action="resume-history"]');
 if(resume){const f=films.find(f=>f.id===resume.dataset.id),r=historyMetadata[f.id];if(r&&f.episodes>1)Object.assign(episodeFor(f),{season:r.season||1,episode:r.episode||1});}
 const clear=event.target.closest('[data-action="clear-cookies"]');
 if(clear){if(!confirm('清除当前网站的 Cookie？登录状态可能失效，收藏和观看历史不会删除。'))return;
  const cookies=document.cookie.split(';').map(x=>x.split('=')[0].trim()).filter(Boolean);
  if(!cookies.length){toast('当前没有可清除的 Cookie');return;}
  for(const name of cookies)document.cookie=name+'=; Max-Age=0; path=/; SameSite=Lax';
  toast(document.cookie?'部分 Cookie 需要服务端清除':'已清除当前页面可访问的 Cookie');
 }
});

document.addEventListener('change',event=>{if(event.target.matches('[data-watch-autoplay]')){save('autoplay',event.target.checked);document.querySelector('#autoplay').checked=event.target.checked;}});


document.addEventListener('click',event=>{const button=event.target.closest('.watch-routes .source-button'),current=document.querySelector('.route-current');if(button&&current)current.textContent='当前 '+button.innerText.trim();});

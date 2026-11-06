(() => {
 const FORMAT='openstream-backup',VERSION=1,MAX_BYTES=2*1024*1024,MAX_RECORDS=500;
 const prefix=()=>window.OPENSTREAM_LIVE?'openstream_live_':'openstream_ui_';
 const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value);
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const string=(value,max=160)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').slice(0,max):'';
 const integer=(value,min=0,max=1000000)=>{if(value===undefined)return min;if((typeof value!=='number'&&typeof value!=='string')||value===''||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max)throw Error('数据中的数值不正确');return Math.floor(Number(value));};
 const stamp=value=>{if(value===undefined)return new Date(0).toISOString();if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('数据中的时间不正确');return new Date(value).toISOString();};
 const preferences={autoplay:'boolean',motion:'boolean',darkMode:'boolean',mobileAutoTheme:'boolean',playbackRate:'number'};
 let applying=false;
 function cleanFilm(value){
  if(!object(value)||!id(value.id)||!string(value.name))throw Error('影片资料不完整');
  const film={id:value.id,name:string(value.name),episodes:integer(value.episodes,1,5000),seasons:integer(value.seasons,1,200)};
  for(const key of ['en','year','type','genre','rating','catalogProvider','catalogId','length','director','cast','description'])if(value[key]!=null)film[key]=string(String(value[key]),key==='description'?1200:160);
  // Only stable public poster paths belong in a portable backup.
  try{const url=new URL(value.cover||value.art);if(url.protocol==='https:'&&/^(image\.tmdb\.org|img\d*\.doubanio\.com)$/.test(url.hostname)&&!url.search&&!url.hash&&!url.username&&!url.password)film.cover=film.art=url.href;}catch{}
  return film;
 }
 const episodeKey=value=>{if(typeof value!=='string'||value.length>160||!value.length||/[<>\x00-\x1f]|:\/\//.test(value)||! /^(?:feature$|s\d{1,3}:e\d{1,4}(?::[上中下])?$|(?:special|label|unresolved):)/.test(value))throw Error('剧集标识不正确');return value;};
 function cleanProgress(value){
  if(!object(value))throw Error('观看进度格式不正确');
  const duration=integer(value.duration,0,86400),position=integer(value.position,0,duration||86400);
  const result={watchedAt:stamp(value.watchedAt),position,duration,season:integer(value.season,1,200),episode:integer(value.episode,1,5000),totalEpisodes:integer(value.totalEpisodes,1,5000),completed:value.completed===true};
  if(value.episodeKey!==undefined)result.episodeKey=episodeKey(value.episodeKey);
  if(value.completedEpisodes!==undefined){if(!Array.isArray(value.completedEpisodes)||value.completedEpisodes.length>1000)throw Error('已看集数记录不正确');result.completedEpisodes=[...new Set(value.completedEpisodes.map(episodeKey))];}
  return result;
 }
 function cleanMap(value,clean){
  if(value===undefined)return{};if(!object(value)||Object.keys(value).length>MAX_RECORDS)throw Error('记录数量超出范围');
  const result={};for(const [key,entry]of Object.entries(value)){if(!id(key))throw Error('记录标识不正确');result[key]=clean(entry);}return result;
 }
 function validateBackup(raw){
  if(typeof raw==='string'){if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)throw Error('备份文件超过 2 MB');try{raw=JSON.parse(raw);}catch{throw Error('备份文件已损坏，未更改本机数据');}}
  if(!object(raw))throw Error('请选择 OpenStream 备份文件');
  if(raw.version===0){raw={format:FORMAT,version:1,createdAt:raw.createdAt,data:{films:raw.filmRecords||[],favorites:raw.favorites||[],history:raw.history||[],progress:raw.historyMetadataV2||{},preferences:raw.preferences||{}}};}
  if(raw.format!==FORMAT||raw.version!==VERSION||!object(raw.data))throw Error('此备份版本暂不支持');
  if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>MAX_BYTES)throw Error('备份文件超过 2 MB');
  const input=raw.data;if(!Array.isArray(input.films)||input.films.length>MAX_RECORDS)throw Error('影片记录格式不正确');
  const filmMap=new Map(input.films.map(f=>{const clean=cleanFilm(f);return[clean.id,clean];})),known=key=>filmMap.has(key);
  const list=value=>{if(!Array.isArray(value)||value.length>MAX_RECORDS||value.some(key=>!id(key)))throw Error('收藏或历史格式不正确');return[...new Set(value)].filter(known);};
  const data={films:[...filmMap.values()],favorites:list(input.favorites||[]),history:list(input.history||[]),progress:cleanMap(input.progress,cleanProgress),watchlist:cleanMap(input.watchlist,value=>{if(!object(value)||!['watching','planned','completed'].includes(value.status))throw Error('收藏分类不正确');return{status:value.status,updatedAt:stamp(value.updatedAt)};}),preferences:{},skip:cleanMap(input.skip,value=>{if(!object(value))throw Error('跳过设置不正确');return{intro:integer(value.intro,0,300),outro:integer(value.outro,0,300)};})};
  for(const collection of [data.progress,data.watchlist,data.skip])for(const key of Object.keys(collection))if(!known(key))delete collection[key];
  if(input.preferences!==undefined&&!object(input.preferences))throw Error('偏好格式不正确');
  for(const[key,type]of Object.entries(preferences)){const value=input.preferences?.[key];if(typeof value===type&&(type!=='number'||Number.isFinite(value)&&value>=.25&&value<=4))data.preferences[key]=value;}
  return{format:FORMAT,version:VERSION,createdAt:stamp(raw.createdAt),data};
 }
 function snapshot(){
  const ids=new Set([...favorites,...history]),kept=films.filter(f=>ids.has(f.id)).slice(0,MAX_RECORDS),skip={};
  for(const f of kept){const value=load('skip_'+f.id,null);if(value)skip[f.id]=value;}
  return validateBackup({format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),data:{films:kept,favorites:[...favorites],history,progress:Object.fromEntries(Object.entries(historyMetadata).filter(([key])=>ids.has(key))),watchlist:Object.fromEntries(Object.entries(load('watchlist',{})).filter(([key])=>ids.has(key))),preferences:Object.fromEntries(Object.keys(preferences).map(key=>[key,load(key,key==='playbackRate'?1:['autoplay','mobileAutoTheme'].includes(key))])),skip}});
 }
 function preview(raw){const backup=validateBackup(raw),current=snapshot();return{backup,counts:{favorites:backup.data.favorites.length,history:backup.data.history.length,films:backup.data.films.length,newFavorites:backup.data.favorites.filter(key=>!current.data.favorites.includes(key)).length}};}
 function mergeData(current,incoming){
  const byId=new Map(current.films.map(f=>[f.id,f]));for(const f of incoming.films)byId.set(f.id,{...byId.get(f.id),...f});
  const progress={...current.progress};for(const[key,value]of Object.entries(incoming.progress)){const previous=progress[key],completedEpisodes=[...new Set([...(previous?.completedEpisodes||[]),...(value.completedEpisodes||[])])].slice(-1000);if(!previous||Date.parse(value.watchedAt)>=Date.parse(previous.watchedAt))progress[key]={...value,...(completedEpisodes.length?{completedEpisodes}:{})};else if(completedEpisodes.length)progress[key]={...previous,completedEpisodes};}
  const watchlist={...current.watchlist};for(const[key,value]of Object.entries(incoming.watchlist))if(!watchlist[key]||Date.parse(value.updatedAt)>=Date.parse(watchlist[key].updatedAt))watchlist[key]=value;
  return{films:[...byId.values()].slice(-MAX_RECORDS),favorites:[...new Set([...current.favorites,...incoming.favorites])],history:[...new Set([...incoming.history,...current.history])].sort((a,b)=>Date.parse(progress[b]?.watchedAt||0)-Date.parse(progress[a]?.watchedAt||0)),progress,watchlist,preferences:{...current.preferences,...incoming.preferences},skip:{...current.skip,...incoming.skip}};
 }
 function applyBackup(raw,{mode='merge',fromSync=false,recovery=false}={}){
  if(!['merge','replace'].includes(mode))throw Error('请选择合并或替换');
  const incoming=validateBackup(raw),before=snapshot(),next=validateBackup({...incoming,data:mode==='merge'?mergeData(before.data,incoming.data):incoming.data}),p=prefix();
  const writes={favorites:next.data.favorites,history:next.data.history,filmRecords:next.data.films,historyMetadataV2:next.data.progress,watchlist:next.data.watchlist,...next.data.preferences};
  for(const f of before.data.films)writes['skip_'+f.id]=next.data.skip[f.id]||{intro:0,outro:0};for(const[key,value]of Object.entries(next.data.skip))writes['skip_'+key]=value;
  if(!fromSync&&!recovery)writes.localDataRecovery=before;
  const original=new Map(Object.keys(writes).map(key=>[p+key,localStorage.getItem(p+key)]));
  try{for(const[key,value]of Object.entries(writes))localStorage.setItem(p+key,JSON.stringify(value));}catch(error){for(const[key,value]of original)try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{}throw Error('浏览器保存空间不足，已保留原有数据');}
  applying=true;try{favorites=new Set(next.data.favorites);history=next.data.history;for(const key of Object.keys(historyMetadata))delete historyMetadata[key];Object.assign(historyMetadata,next.data.progress);const currentId=location.hash.split('/')[1],currentFilm=films.find(f=>f.id===currentId);const existing=new Map(films.map(f=>[f.id,f]));films.splice(0,films.length,...next.data.films.map(f=>Object.assign(existing.get(f.id)||{},f)));if(currentFilm&&!films.some(f=>f.id===currentId))films.push(currentFilm);}finally{applying=false;}
  document.dispatchEvent(new CustomEvent('openstream:data-restored',{detail:{fromSync}}));
  if(!fromSync)document.dispatchEvent(new CustomEvent('openstream:data-change',{detail:{key:'all',origin:'import'}}));
  return next;
 }
 function restore(){const value=load('localDataRecovery',null);if(!value)throw Error('还没有可恢复的数据');return applyBackup(value,{mode:'replace',recovery:true});}
 window.OpenStreamLocalData={snapshot,validateBackup,applyBackup,validate:validateBackup,apply:applyBackup,preview,restore,get applying(){return applying;},MAX_BYTES};
})();

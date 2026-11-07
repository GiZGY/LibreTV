(() => {
 const trailer=value=>window.OpenStreamContent?.trailerEpisode(value);
 const catalogs=new WeakMap();
 const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 const clean=value=>String(value||'').normalize('NFKC').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
 function number(value){
  if(/^\d{1,4}$/.test(value))return Number(value);
  if(!/^[零〇一二两三四五六七八九十百千]+$/.test(value))return NaN;
  if(!/[十百千]/.test(value))return Number([...value].map(char=>digits[char]).join(''));
  let sum=0,current=0;for(const char of value){if(char in digits)current=digits[char];else{const unit={十:10,百:100,千:1000}[char];sum+=(current||1)*unit;current=0;}}return sum+current;
 }
 function describe(value,{series=true,season=1}={}){
  const label=clean(value),normal=label.toLowerCase().replace(/[\s_【】\[\]（）()]/g,'').replace(/([集话期])[-.]/g,'$1');
  if(!series)return{key:'feature',label:label||'正片',season:1,number:1,kind:'feature'};
  const seasonMatch=normal.match(/第([零〇一二两三四五六七八九十百千\d]+)季/)||normal.match(/^s(\d{1,2})/i);
  const s=seasonMatch?number(seasonMatch[1]):season;
  if(/预告|花絮|特辑|特别篇|番外|彩蛋|trailer|preview|special|^sp\d*|^s0+e\d|^s\d+e0+(?:$|\D)|^第[零〇0]+季|^第[零〇0]+[集话期]/i.test(normal))return{key:'special:'+normal,label:label||'特别篇',season:s,number:null,kind:'special'};
  const match=normal.match(/s\d{1,2}e(\d{1,4})/i)||normal.match(/第([零〇一二两三四五六七八九十百千\d]+)[集话期]/)||normal.match(/^(?:ep?|episode)?(\d{1,4})(?:集|话|期)?(?:[上下中](?:集|部)?|完|end)?$/i);
  const n=match?number(match[1]):NaN;
  if(Number.isInteger(n)&&n>0&&n<=1000&&Number.isInteger(s)&&s>0&&s<=100){
   const part=normal.match(/(?:集|话|期|\d)([上中下])(?:集|部)?$/)?.[1]||'';
   return{key:'s'+s+':e'+n+(part?':'+part:''),label:label||'第 '+n+' 集',season:s,number:n,part,kind:'episode'};
  }
  return{key:'label:'+normal,label:label||'未标注集名',season:s,number:null,kind:'label'};
 }
 const serial=f=>!['电影','纪录片'].includes(f.type);
 function defaultSeason(f){const title=clean(f.name),match=title.match(/第([零〇一二两三四五六七八九十百千\d]+)季/)||title.match(/season\s*(\d{1,2})/i)||title.match(/\bs(\d{1,2})\b/i),season=match?number(match[1]):1;return Number.isInteger(season)&&season>0&&season<=100?season:1;}

 function catalog(f){
  const entries=new Map();
  for(const line of f.lines||[])for(const episode of line.episodes||[]){if(trailer(episode.name))continue;const item=describe(episode.name,{series:serial(f),season:defaultSeason(f)});if(item.key!=='label:'&&!entries.has(item.key))entries.set(item.key,item);}
  if(!entries.size&&f.lines?.some(line=>line.episodes?.length))return [];
  if(!serial(f))return[{key:'feature',label:'正片',season:1,number:1,kind:'feature'}];
  const known=[...entries.values()].filter(item=>item.kind==='episode');
  const wholeSeasons=new Set(known.map(item=>item.season));
  // Fill numbered gaps so legacy "episode 2" never becomes another source's episode 3.
  for(const season of wholeSeasons){const max=Math.max(...known.filter(item=>item.season===season).map(item=>item.number));for(let n=1;n<=max;n++){const key='s'+season+':e'+n;if(!entries.has(key)&&!known.some(item=>item.season===season&&item.number===n))entries.set(key,{key,label:'第 '+n+' 集',season,number:n,part:'',kind:'episode'});}}
  const list=[...entries.values()].sort((a,b)=>a.kind==='episode'&&b.kind==='episode'?a.season-b.season||a.number-b.number||({上:0,中:1,下:2}[a.part]??-1)-({上:0,中:1,下:2}[b.part]??-1):a.kind==='episode'?-1:b.kind==='episode'?1:0);
  return list.length?list:Array.from({length:Math.min(1000,Math.max(1,Number(f.episodes)||1))},(_,i)=>({key:'unresolved:'+i,label:'第 '+(i+1)+' 集',season:defaultSeason(f),number:i+1,kind:'unresolved'}));
 }
 function sync(f,state,key){
  if(!serial(f)&&f.lines){
   const selected=f.lines[f.lineIndex||0]?.key,lines=new Map();
   for(const line of f.lines){if(line.episodes?.length>1){line.episodes.forEach((episode,index)=>{if(trailer(episode.name))return;const key=line.key+':version:'+index;if(!lines.has(key))lines.set(key,{...line,key,name:line.name+' · '+(episode.name||'版本 '+(index+1)),version:episode.name,episodes:[episode]});});}else if(!trailer(line.episodes?.[0]?.name)&&!lines.has(line.key))lines.set(line.key,line);}
   f.lines=[...lines.values()];const index=f.lines.findIndex(line=>line.key===selected||line.key===selected+':version:0');if(index>=0)f.lineIndex=index;
  }
  const previous=catalogs.get(f),keep=key||previous?.[Math.max(0,(state?.episode||1)-1)]?.key,list=catalog(f);catalogs.set(f,list);f.episodes=list.length;
  if(state){const index=list.findIndex(item=>item.key===keep);if(index>=0)state.episode=index+1;else state.episode=Math.min(list.length,Math.max(1,state.episode||1));state.season=list[state.episode-1]?.season||1;}
  return list;
 }
 function selection(f,state){return catalog(f)[Math.max(0,(state?.episode||1)-1)]||null;}
 function indexFor(f,line,state){
  const key=typeof state==='string'?state:selection(f,state)?.key;if(!key)return -1;
  const matches=(line?.episodes||[]).map((episode,index)=>({index,item:describe(episode.name,{series:serial(f),season:defaultSeason(f)})})).filter(({item})=>!trailer(item.label)&&item.key===key);
  return matches.length===1?matches[0].index:-1;
 }
 function display(f,value){
  const list=catalog(f),valueKey=value?.episodeKey||legacyKey(f,value),found=valueKey?list.find(item=>item.key===valueKey):list[Math.max(0,(value?.episode||1)-1)];
  let item=found;
  if(!item&&valueKey){const match=valueKey.match(/^s(\d+):e(\d+)(?::([上中下]))?$/);if(match)item={key:valueKey,season:Number(match[1]),number:Number(match[2]),part:match[3]||'',kind:'episode'};else item={key:valueKey,season:value.season||defaultSeason(f),number:null,kind:valueKey.startsWith('special:')?'special':'label',label:valueKey.replace(/^(?:special|label):/,'')};}
  item=item||{season:value?.season||defaultSeason(f),number:value?.episode||1,kind:serial(f)?'episode':'feature'};
  const label=item.kind==='feature'?'正片':item.number?'第 '+item.season+' 季 · 第 '+item.number+' '+(f.type==='综艺'?'期':'集')+(item.part?'（'+item.part+'）':''):item.label||'特别篇';
  return{...item,label,episode:item.number||null,ordinal:found?list.indexOf(found)+1:value?.episode||1};
 }
 function nextOrdinal(f,state){const list=catalog(f),current=state?.episodeKey?list.findIndex(item=>item.key===state.episodeKey):Math.max(0,(state?.episode||1)-1);if(current<0)return null;for(let index=current+1;index<list.length;index++){const item=list[index],active=list[current];if(item.kind==='special')continue;if(active?.kind==='episode'&&!active.part&&item.season===active.season&&item.number===active.number)continue;return index+1;}return null;}
 function legacyKey(f,record){
  if(record?.episodeKey)return record.episodeKey;if(!record?.source||!Number.isInteger(record.episode)||record.episode<1)return null;
  const keys=new Set((f.lines||[]).filter(line=>line.sourceKey===record.source).map(line=>line.episodes?.find((ep,i)=>(ep.sourceIndex??i)===record.episode-1)).filter(Boolean).map(episode=>describe(episode.name,{series:serial(f),season:defaultSeason(f)}).key));return keys.size===1?[...keys][0]:null;
 }
 function cut(line){const label=clean([line?.name,line?.label,line?.version].filter(Boolean).join(' '));return label.match(/导演剪辑|加长|未删减|删减|精简|剧场版|电视版|修复版/)?.[0]||'标准版';}
 window.OpenStreamEpisodes={describe,catalog,sync,selection,indexFor,legacyKey,defaultSeason,display,nextOrdinal,cut};
})();

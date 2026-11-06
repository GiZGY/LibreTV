(() => {
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const time=value=>{const n=Math.max(0,Math.round(value||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
 const mediaKey=media=>media?.filmId+':'+(media?.episodeKey||media?.episode||1);
 const overrides=new Map();
 let nextFocus=null;
 const aspectRatios=['default','4:3','16:9'];
 function aspectFor(_video,applied){return aspectRatios.includes(applied)?applied:'default';}
 function backSetting(setting){const first=setting.active?.[0],parent=first?.$parent;if(!parent)return null;setting.render(first.$parents);return parent;}
 function subtitleValue(which,value){if(which==='size')return integerIn(value,16,40);if(which!=='offset'||typeof value!=='number'&&(typeof value!=='string'||!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim().replace(/−/g,'-'))))return null;const n=Number(typeof value==='string'?value.trim().replace(/−/g,'-'):value);return Number.isFinite(n)&&n>=-120&&n<=120&&Number.isInteger(n*2)?n:null;}
 function overrideFor(media){const key=mediaKey(media);if(!overrides.has(key)){if(overrides.size>=50)overrides.delete(overrides.keys().next().value);overrides.set(key,{intro:false,outro:false});}return overrides.get(key);}
 function integerIn(value,min,max){if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value.trim())))return null;const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null;}
 // A same-episode retry must not activate a marker promised for the next episode.
 function effectiveSkip(media,configured){const pending=overrideFor(media).pending||{};return{intro:pending.intro??configured.intro,outro:pending.outro??configured.outro};}
 function createSkipSettings({media,skip,onChange}){
  const temporary=overrideFor(media),valid=which=>which==='intro'||which==='outro';
  return{enabled:which=>valid(which)&&skip[which]>0&&!temporary[which],
   setSeconds(which,value,{origin='input'}={}){const seconds=integerIn(value,0,300);if(!valid(which)||seconds===null)return false;const previous=skip[which];if(origin==='mark'){temporary.pending||={};temporary.pending[which]??=previous;}else if(temporary.pending)delete temporary.pending[which];skip[which]=seconds;if(!previous&&seconds)temporary[which]=false;onChange?.({which,origin});return true;},
   setEnabled(which,enabled){if(!valid(which)||typeof enabled!=='boolean'||(enabled&&!skip[which]))return false;temporary[which]=!enabled;if(temporary.pending)delete temporary.pending[which];onChange?.({which,origin:'toggle'});return true;}
  };
 }
 function createStallWatch({video,now=()=>performance.now(),hidden=()=>document.hidden,onRecover,onFailed,startupMs=25000,stallMs=12000,cooldownMs=15000}){
  let disposed=false,armed=false,anchor=now(),lastProgress=now(),lastPosition=Number(video.currentTime)||0,played=false,recoveries=0,lastRecovery=-Infinity,recovering=false;
  function reset(){anchor=now();lastProgress=anchor;lastPosition=Number(video.currentTime)||0;}
  return{arm(){armed=true;reset();},suspend(){armed=false;recovering=false;reset();},reset,
   poll(){
    if(disposed)return;
    const stamp=now(),position=Number(video.currentTime)||0;
    if(!armed||video.ended||hidden()||(!recovering&&(video.paused||video.seeking))){reset();if(recovering)lastRecovery=stamp;return;}
    if(position>lastPosition+.05){played=true;recovering=false;lastProgress=stamp;lastPosition=position;return;}
    if(position<lastPosition-.2){reset();return;}
    const threshold=recovering?cooldownMs:played?stallMs:startupMs;
    if(stamp-(played?lastProgress:anchor)<threshold||stamp-lastRecovery<cooldownMs)return;
    lastRecovery=stamp;reset();
    if(recoveries++<1){recovering=true;onRecover?.();return;}
    armed=false;onFailed?.();
   },dispose(){disposed=true;armed=false;},snapshot:()=>({played,recoveries,armed,recovering})};
 }
 function timestamp(value){
  const m=String(value).trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{3})$/);if(!m)return NaN;
  const h=Number(m[1]||0),min=Number(m[2]),s=Number(m[3]);return min<60&&s<60?h*3600+min*60+s+Number(m[4])/1000:NaN;
 }
 function parseSubtitles(text){
  if(typeof text!=='string'||text.length>2*1024*1024)throw Error('字幕文件过大，最多 2 MB');
  const normalized=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(normalized.includes('\uFFFD'))throw Error('字幕编码未识别，请使用 UTF-8 文件');
  const blocks=normalized.replace(/^WEBVTT[^\n]*\n/,'').split(/\n[ \t]*\n/),cues=[];
  for(const block of blocks){const lines=block.split('\n');if(/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]||''))continue;
   const index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
   const match=lines[index].match(/^\s*(\S+)\s+-->\s+(\S+)/);if(!match)throw Error('字幕时间格式有误');
   const start=timestamp(match[1]),end=timestamp(match[2]);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>172800)throw Error('字幕时间范围有误');
   const value=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
   if(!value||value.length>4096)throw Error('字幕内容有误');cues.push({start,end,text:value});if(cues.length>20000)throw Error('字幕条目过多');
  }
  if(!cues.length)throw Error('没有识别到字幕，请选择 SRT 或 VTT 文件');
  return cues.sort((a,b)=>a.start-b.start||a.end-b.end);
 }
 function cuesAt(cues,position){
  let lo=0,hi=cues.length;while(lo<hi){const mid=(lo+hi)>>1;if(cues[mid].start<=position)lo=mid+1;else hi=mid;}
  const out=[];for(let i=lo-1;i>=0&&i>=lo-32;i--)if(cues[i].end>position)out.unshift(cues[i].text);return out.slice(-4).join('\n');
 }
 function createSleep({now=()=>Date.now(),schedule=fn=>setInterval(fn,1000),unschedule=id=>clearInterval(id)}={}){
  let state={deadline:null,endKey:null,stopped:false},timer=null,binding=null;const listeners=new Set();
  const emit=()=>listeners.forEach(fn=>fn(snapshot()));
  const clear=()=>{if(timer!==null){unschedule(timer);timer=null;}};
  const snapshot=()=>({...state,remaining:state.deadline?Math.max(0,state.deadline-now()):0});
  const applies=media=>state.endKey===mediaKey(media);
  const stop=()=>{state={deadline:null,endKey:null,stopped:true};clear();binding?.pause();emit();};
  function tick(){if(state.deadline&&now()>=state.deadline){stop();return;}emit();}
  return{snapshot,applies,blocked:()=>state.stopped,tick,
   setMinutes(minutes){const n=integerIn(minutes,1,240);if(n===null)return false;state={deadline:now()+n*60000,endKey:null,stopped:false};clear();timer=schedule(tick);emit();return true;},
   setEnd(media){state={deadline:null,endKey:mediaKey(media),stopped:false};clear();emit();},
   extend(){if(state.deadline){state.deadline+=15*60000;emit();}},
   cancel(){state={deadline:null,endKey:null,stopped:false};clear();emit();},
   beforeAdvance(media,manual){tick();if(manual){if(applies(media)||state.stopped)this.cancel();return true;}return !state.stopped&&!applies(media);},
   ended(media){if(applies(media)){stop();return true;}return state.stopped;},
   bind(instance){binding=instance;if(state.stopped)instance.pause();return()=>{if(binding===instance)binding=null;};},
   subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},dispose(){clear();listeners.clear();binding=null;}
  };
 }
 const sleep=createSleep();
 let subtitle={key:null,cues:[],name:'',enabled:false,size:24,offset:0};
 function attach({instance,host,film,media,skip,onSkipChange,recover,cancelRecovery}){
  const video=instance.video,key=mediaKey(media),temporary=overrideFor(media),skipControls=createSkipSettings({media,skip,onChange:onSkipChange}),skipDrafts=new Map(),subtitleDrafts=new Map();let disposed=false,opened=null,opener=null,fileGeneration=0;
  if(subtitle.key!==key)subtitle={key,cues:[],name:'',enabled:false,size:subtitleValue('size',load('subtitleSize',24))??24,offset:0};
  const root=document.createElement('div');root.className='player-tools-ui';
  root.innerHTML=`<div class="player-tool-head"><div class="player-tool-title"><strong></strong><span data-player-target></span></div></div><div class="player-inline-status" role="status" hidden><span></span><button type="button" data-player-play hidden>继续播放</button><button type="button" data-player-retry hidden>重试</button><button type="button" data-player-panel="lines" hidden>换线</button><a href="#detail/${escape(film.id)}" hidden>返回详情</a></div><section class="player-tool-panel" data-player-view="episodes" role="dialog" aria-label="选集" tabindex="-1" hidden><div class="player-episode-grid"></div></section><section class="player-tool-panel" data-player-view="lines" role="dialog" aria-label="播放线路" tabindex="-1" hidden><div class="player-tool-lines"></div></section><input type="file" data-subtitle-file accept=".srt,.vtt" hidden><div class="player-local-subtitle" aria-hidden="true"></div><div class="player-sleep-pill" role="status" hidden></div>`;
  instance.template.$player.append(root);
  const mobileSheet=document.createElement('dialog');mobileSheet.className='player-mobile-sheet';mobileSheet.setAttribute('aria-label','观看选项');root.append(mobileSheet);
  mobileSheet.addEventListener('cancel',event=>{event.preventDefault();closePanel();});
  root.querySelector('.player-tool-title strong').textContent=film.name;
  const target=root.querySelector('[data-player-target]'),status=root.querySelector('.player-inline-status');
  instance.template.$player.querySelector('.art-notice')?.setAttribute('data-player-message','');
  const notify=text=>{instance.notice.show=text;};
  const item=name=>instance.setting.find(name);
  function setStatus(text,{error=false,busy=false}={}){status.hidden=!text;status.querySelector('span').textContent=text||'';status.classList.toggle('is-error',error);for(const node of status.querySelectorAll('[data-player-retry],[data-player-panel],a'))node.hidden=!error;status.querySelector('[data-player-play]').hidden=true;root.setAttribute('aria-busy',String(busy));}
  function updateTarget(loading=false){const state=episodeFor(film),item=window.OpenStreamEpisodes?.display(film,state);target.textContent=(loading?'正在加载 · ':'')+(isSeries(film)?(item?.label||'第 '+state.episode+' 集'):'正片')+(media?.cut&&media.cut!=='标准版'?' · '+media.cut:'');}
  function updateSkip(){for(const which of ['intro','outro']){const row=item('skip-'+which);if(!row?.$item)continue;const input=row.$item.querySelector('[data-skip-seconds]'),toggle=row.$item.querySelector('[data-skip-enabled]');if(input&&!skipDrafts.has(which))input.value=String(skip[which]);if(toggle){const enabled=skipControls.enabled(which);toggle.setAttribute('aria-checked',String(enabled));toggle.title=enabled?'仅本集关闭':'开启跳过';for(const icon of toggle.querySelectorAll('[data-skip-icon]'))icon.hidden=(icon.dataset.skipIcon==='on')!==enabled;}}}
  function renderEpisodes(){const state=episodeFor(film),list=window.OpenStreamEpisodes?.catalog(film)||Array.from({length:film.episodes},(_,i)=>({label:String(i+1),number:i+1})),seasons=new Set(list.filter(item=>item.number).map(item=>item.season||1));root.querySelector('.player-episode-grid').innerHTML=list.map((item,index)=>{const label=item.number?(seasons.size>1?(item.season||1)+'季·':'')+item.number+(item.part?'（'+item.part+'）':''):item.label,full=item.number?'第 '+(item.season||1)+' 季 · 第 '+item.number+' 集'+(item.part?'（'+item.part+'）':''):item.label;return `<button type="button" data-player-episode="${index+1}" aria-label="${escape(full)}" title="${escape(full)}" aria-pressed="${state.episode===index+1}" class="${label.length>5?'is-wide':''}">${escape(label)}</button>`;}).join('');}
  function renderLines(stable=false){
   const list=root.querySelector('.player-tool-lines'),ranked=window.LivePlayback?.rankedLines?.(film)??(film.lines||[]).map((line,i)=>({line,i})),existing=new Map([...list.children].map(button=>[button.lineKey,button]));
   if(!stable)list.replaceChildren();
   const current=new Set();
   for(const {line,i:index} of ranked){
    const key=line.key||String(index),button=stable?existing.get(key)||document.createElement('button'):document.createElement('button'),missing=window.OpenStreamEpisodes&&OpenStreamEpisodes.indexFor(film,line,episodeFor(film))<0,cut=window.OpenStreamEpisodes?.cut(line)||'标准版',name=line.name+(cut!=='标准版'?' · '+cut:''),health=['fast','fair','slow'].includes(line.health)?line.health:'unknown',active=index===(film.lineIndex||0),description=[name,active?'当前线路':'',({fast:'流畅',fair:'一般',slow:'缓慢',unknown:'尚未核实'})[health],missing?'缺少当前集':''].filter(Boolean).join(' · ');
    current.add(key);button.lineKey=key;button.type='button';button.dataset.playerLine=String(index);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',description);button.title=description;button.disabled=!!missing;
    if(!button.firstElementChild)button.innerHTML='<span class="source-dot" aria-hidden="true"></span><span class="player-line-name"></span>';
    button.querySelector('.source-dot').dataset.health=health;button.querySelector('.player-line-name').textContent=name;
    if(!button.isConnected)list.append(button);
   }
   if(stable)for(const [key,button] of existing)if(!current.has(key)){button.disabled=true;button.title=button.getAttribute('aria-label')+' · 线路暂不可用';}
  }
  function closePanel(restore=true){if(!opened)return;const panel=root.querySelector(`[data-player-view="${opened}"]`);panel.hidden=true;if(mobileSheet.open){mobileSheet.close();panel.setAttribute('role','dialog');root.append(panel);}host.querySelectorAll('[data-player-panel]').forEach(button=>button.setAttribute('aria-expanded','false'));opened=null;if(restore&&opener?.isConnected){instance.controls.show=true;opener.focus({preventScroll:true});}}
  function openPanel(name,trigger){if(!['episodes','lines'].includes(name))return;instance.setting.show=false;const speed=host.querySelector('.fine-speed');if(speed)speed.open=false;if(opened===name){closePanel();return;}closePanel(false);opener=trigger||host.querySelector(`.player-bottom-trigger[data-player-panel="${name}"]`);opened=name;if(name==='episodes')renderEpisodes();if(name==='lines')renderLines();const panel=root.querySelector(`[data-player-view="${name}"]`);panel.hidden=false;if(matchMedia('(max-width:700px)').matches&&!document.fullscreenElement&&!instance.fullscreenWeb){mobileSheet.setAttribute('aria-label',panel.getAttribute('aria-label'));panel.setAttribute('role','document');mobileSheet.append(panel);mobileSheet.showModal();}host.querySelectorAll(`[data-player-panel="${name}"]`).forEach(button=>button.setAttribute('aria-expanded','true'));instance.controls.show=true;(panel.querySelector('[aria-pressed="true"]:not(:disabled)')||panel.querySelector('button:not(:disabled)')||panel).focus({preventScroll:true});}
  for(const name of ['episodes','lines']){const panel=root.querySelector(`[data-player-view="${name}"]`);panel.id='player-'+name+'-popover';for(const trigger of host.querySelectorAll(`[data-player-panel="${name}"]`)){trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-haspopup','dialog');}}
  function onClick(event){
   const button=event.target.closest('button');if(!button||!root.contains(button))return;event.stopPropagation();
   if(button.dataset.playerPanel){openPanel(button.dataset.playerPanel,button);return;}
   if(button.hasAttribute('data-player-play')){instance.video.play()?.catch(()=>notify('请再点击播放器中的播放按钮'));return;}
   if(button.hasAttribute('data-player-retry')){closePanel(false);window.LivePlayback?.retry(media);return;}
   if(button.dataset.playerEpisode){nextFocus='episodes';closePanel(false);window.LivePlayback?.selectEpisode(media,Number(button.dataset.playerEpisode));return;}
   if(button.dataset.playerLine){nextFocus='lines';closePanel(false);window.LivePlayback?.selectLine(media,Number(button.dataset.playerLine));return;}
  }
  function onKey(event){if(!opened)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePanel();return;}event.stopPropagation();if(event.key!=='Tab')return;const panel=root.querySelector(`[data-player-view="${opened}"]`),nodes=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),a[href]:not([hidden]),input:not(:disabled):not([hidden]),[tabindex="0"]')].filter(node=>node.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  const outside=event=>{if(!opened||event.target.closest?.('[data-player-panel]'))return;const panel=root.querySelector(`[data-player-view="${opened}"]`);if(event.target===mobileSheet){const r=mobileSheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}else if(!panel.contains(event.target))closePanel();};
  root.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);document.addEventListener('click',outside,true);
  const routeContainer=document.querySelector('.watch-routes')?.parentElement,routeObserver=new MutationObserver(()=>{if(opened==='lines')renderLines(true);});
  if(routeContainer)routeObserver.observe(routeContainer,{childList:true});
  root.addEventListener('change',async event=>{
   if(!event.target.hasAttribute('data-subtitle-file'))return;
   const file=event.target.files?.[0],generation=++fileGeneration;event.target.value='';if(!file)return;
   try{if(!/\.(srt|vtt)$/i.test(file.name))throw Error('请选择 SRT 或 VTT 字幕');if(file.size>2*1024*1024)throw Error('字幕文件过大，最多 2 MB');const buffer=await file.arrayBuffer();if(disposed||generation!==fileGeneration)return;let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('字幕编码未识别，请使用 UTF-8 文件');}const cues=parseSubtitles(text);subtitle={...subtitle,key,cues,name:file.name.slice(0,100),enabled:true,offset:0};subtitleDrafts.delete('offset');renderSubtitle();updateSubtitle();notify('字幕已载入');}catch(error){if(!disposed&&generation===fileGeneration)notify(error.message);}
  });
  const caption=root.querySelector('.player-local-subtitle');
  function renderSubtitle(){if(disposed)return;caption.textContent=subtitle.enabled?cuesAt(subtitle.cues,Number(instance.currentTime)-subtitle.offset):'';caption.style.fontSize=subtitle.size+'px';}
  const subtitleText=(which,n)=>which==='offset'&&n>0?'+'+n:String(n);
  function updateSubtitle(){
   const file=item('subtitle-file'),toggle=item('subtitle-toggle'),parent=item('local-subtitle');if(file&&(file.$tooltip?.textContent??file.tooltip)!==(subtitle.name||'尚未选择字幕'))file.tooltip=escape(subtitle.name||'尚未选择字幕');if(parent&&parent.tooltip!==(subtitle.enabled?'已开启':'关闭'))parent.tooltip=subtitle.enabled?'已开启':'关闭';if(toggle){toggle.switch=subtitle.enabled;toggle.$item?.setAttribute('aria-checked',String(subtitle.enabled));toggle.$item?.setAttribute('aria-disabled',String(!subtitle.cues.length));}
   for(const which of ['size','offset']){const row=item('subtitle-'+which),input=row?.$item?.querySelector('[data-subtitle-'+which+']');if(!input)continue;const n=subtitle[which],draft=subtitleDrafts.has(which)?subtitleValue(which,subtitleDrafts.get(which)):n;if(!subtitleDrafts.has(which))input.value=subtitleText(which,n);if(which==='offset'){input.setAttribute('aria-valuenow',String(n));input.setAttribute('aria-valuetext',n===0?'不偏移':(n>0?'延后 ':'提前 ')+Math.abs(n)+' 秒');}for(const button of row.$item.querySelectorAll('[data-subtitle-step]'))button.disabled=draft===null||draft+Number(button.dataset.delta)<(which==='size'?16:-120)||draft+Number(button.dataset.delta)>(which==='size'?40:120);}
  }
  function commitSubtitle(which,input,delta=0){
   if(disposed)return;const n=subtitleValue(which,input.value),next=n===null?null:subtitleValue(which,n+delta);if(next===null){subtitleDrafts.set(which,input.value);input.setAttribute('aria-invalid','true');notify(which==='size'?'请输入 16–40 的整数字号':'请输入 −120 至 +120 秒，按 0.5 秒调整');return false;}
   subtitle[which]=next;subtitleDrafts.delete(which);input.removeAttribute('aria-invalid');if(which==='size')save('subtitleSize',next);renderSubtitle();updateSubtitle();return true;
  }
  function subtitleStepper(which){
   const row=item('subtitle-'+which);if(!row?.$item||row.$item.querySelector('[data-subtitle-'+which+']'))return;const size=which==='size',step=size?1:.5,min=size?16:-120,max=size?40:120,controls=settingControls(row,'player-subtitle-setting');
   controls.innerHTML=`<button type="button" data-subtitle-step="${which}" data-delta="-${step}" aria-label="${size?'减小字幕字号':'字幕提前 0.5 秒'}">−</button><label class="player-setting-number"><input ${size?'type="number" step="1"':'type="text" role="spinbutton" autocomplete="off" spellcheck="false"'} inputmode="${size?'numeric':'decimal'}" min="${min}" max="${max}" data-subtitle-${which} aria-label="${size?'字幕字号':'字幕时间偏移（秒）'}"${size?'':' aria-valuemin="-120" aria-valuemax="120"'}><span>${size?'px':'秒'}</span></label><button type="button" data-subtitle-step="${which}" data-delta="${step}" aria-label="${size?'增大字幕字号':'字幕延后 0.5 秒'}">＋</button>`;
   const input=controls.querySelector('input');input.value=subtitleText(which,subtitle[which]);input.addEventListener('input',()=>{subtitleDrafts.set(which,input.value);input.removeAttribute('aria-invalid');updateSubtitle();});input.addEventListener('change',()=>commitSubtitle(which,input));
   input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commitSubtitle(which,input);}else if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Home'||event.key==='End'){input.value=String(event.key==='Home'?min:max);commitSubtitle(which,input);}else{const n=subtitleValue(which,input.value),next=n===null?null:n+(event.key==='ArrowUp'?step:-step);if(next!==null&&next>=min&&next<=max)commitSubtitle(which,input,event.key==='ArrowUp'?step:-step);}}});
   for(const button of controls.querySelectorAll('button')){button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>commitSubtitle(which,input,Number(button.dataset.delta)));}
  }
  function markSkip(which){
   if(disposed||instance.isDestroy)return false;
   const duration=Number(instance.duration),position=Number(instance.currentTime),value=Math.round(which==='intro'?position:duration-position),other=which==='intro'?skip.outro:skip.intro;
   if(!Number.isFinite(duration)||duration<30||!Number.isFinite(value)||value<1||value>300||value+other>=duration-10||value>duration*.45){notify('这个位置不适合跳过，请选择更接近片头或片尾的位置');return false;}
   skipDrafts.delete(which);skipControls.setSeconds(which,value,{origin:'mark'});updateSkip();notify((which==='intro'?'片头结束已记为 ':'片尾已记为 ')+time(value)+'，下一集起生效');return true;
  }
  const nativeSettings=instance.template.$setting,gear=instance.controls.setting;
  const nativeRows=[
   {name:'aspect-ratio',html:'画面比例',onClick:()=>''},
   {name:'sleep-timer',html:'睡眠定时',tooltip:'未设置',selector:[
    {name:'sleep-custom',html:'分钟后停止',onClick:()=>''},
    {name:'sleep-end',html:'本集结束停止',onClick(){if(!disposed)sleep.setEnd(media);return '';}},
    {name:'sleep-extend',html:'延长 15 分钟',disable:true,onClick(){if(!disposed)sleep.extend();return '';}},
    {name:'sleep-cancel',html:'取消定时',disable:true,onClick(){if(!disposed)sleep.cancel();return '';}},
    {name:'sleep-resume',html:'继续播放',disable:true,onClick(){if(!disposed){sleep.cancel();instance.play=true;instance.setting.show=false;}return '';}}
   ]},
   {name:'local-subtitle',html:'字幕',tooltip:subtitle.enabled?'已开启':'关闭',selector:[
    {name:'subtitle-file',html:'选择 SRT / VTT',tooltip:escape(subtitle.name||'尚未选择字幕'),onClick(){if(!disposed)root.querySelector('[data-subtitle-file]').click();return escape(subtitle.name||'尚未选择字幕');}},
    {name:'subtitle-toggle',html:'显示字幕',switch:subtitle.enabled,onSwitch(row){if(disposed)return row.switch;if(!subtitle.cues.length){notify('请先选择字幕');return false;}subtitle.enabled=!row.switch;renderSubtitle();updateSubtitle();return subtitle.enabled;}},
    {name:'subtitle-size',html:'字号',onClick:()=>''},
    {name:'subtitle-offset',html:'时间偏移',onClick:()=>''}
   ]}
  ];
  for(const row of nativeRows)instance.setting.add(row);
  gear.setAttribute('role','button');gear.setAttribute('tabindex','0');gear.setAttribute('aria-label','播放设置');gear.setAttribute('aria-expanded','false');
  nativeSettings.setAttribute('role','dialog');nativeSettings.setAttribute('aria-label','播放设置');
  function settingControls(row,className){const controls=document.createElement('div');controls.className='player-setting-controls';controls.addEventListener('click',event=>event.stopPropagation());row.$item.classList.add(className);row.$item.append(controls);return controls;}
  function commitSkip(which,input){if(disposed)return;skipDrafts.set(which,input.value);if(!skipControls.setSeconds(which,input.value)){input.setAttribute('aria-invalid','true');notify('请输入 0–300 的整数秒数');return;}input.removeAttribute('aria-invalid');skipDrafts.delete(which);updateSkip();}
  function updateAspect(){const row=item('aspect-ratio'),selected=aspectFor(video,instance.aspectRatio);for(const button of row?.$item?.querySelectorAll('button[data-aspect-ratio]')||[])button.setAttribute('aria-pressed',String(selected===button.dataset.aspectRatio));}
  function decorateNativeSettings(){
   if(disposed)return;
   for(const which of ['intro','outro']){
    const row=item('skip-'+which);if(!row?.$item||row.$item.querySelector('[data-skip-seconds]'))continue;
    const controls=settingControls(row,'player-skip-setting'),label=which==='intro'?'跳过片头':'跳过片尾';
    controls.innerHTML=`<button type="button" class="player-setting-switch" data-skip-enabled="${which}" role="switch" aria-label="${label}" aria-checked="false"></button><label class="player-setting-number"><input type="number" min="0" max="300" step="1" inputmode="numeric" data-skip-seconds="${which}" aria-label="${label}秒数"><span>秒</span></label><button type="button" class="player-skip-mark" data-skip-mark="${which}">标记</button>`;
    const input=controls.querySelector('input'),toggle=controls.querySelector('[data-skip-enabled]'),button=controls.querySelector('[data-skip-mark]');
    for(const name of ['on','off']){const icon=instance.icons[name==='on'?'switchOn':'switchOff'];icon.dataset.skipIcon=name;icon.setAttribute('aria-hidden','true');toggle.append(icon);}
    input.value=skipDrafts.get(which)??String(skip[which]);input.addEventListener('input',()=>{skipDrafts.set(which,input.value);input.removeAttribute('aria-invalid');});input.addEventListener('change',()=>commitSkip(which,input));input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commitSkip(which,input);}});
    toggle.addEventListener('click',()=>{if(disposed)return;if(!skipControls.setEnabled(which,!skipControls.enabled(which))){notify('请先输入跳过秒数');return;}updateSkip();});
    const markLabel=which==='intro'?'当前位置记为片头结束':'当前位置记为片尾开始';button.title=markLabel;button.setAttribute('aria-label',markLabel);button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',event=>{event.preventDefault();markSkip(which);});
   }
   const aspect=item('aspect-ratio');if(aspect?.$item&&!aspect.$item.querySelector('button[data-aspect-ratio]')){const controls=settingControls(aspect,'player-aspect-setting');controls.innerHTML=aspectRatios.map(value=>`<button type="button" data-aspect-ratio="${value}" aria-pressed="false">${value==='default'?'默认':value}</button>`).join('');controls.addEventListener('click',event=>{const button=event.target.closest('button[data-aspect-ratio]');if(button&&!disposed&&aspectRatios.includes(button.dataset.aspectRatio)){instance.aspectRatio=button.dataset.aspectRatio;save('aspectRatio',button.dataset.aspectRatio);updateAspect();}});}
   subtitleStepper('size');subtitleStepper('offset');
   const custom=item('sleep-custom');if(custom?.$item&&!custom.$item.querySelector('[data-sleep-custom]')){const controls=settingControls(custom,'player-sleep-setting');controls.innerHTML='<input type="number" min="1" max="240" step="1" inputmode="numeric" value="30" data-sleep-custom aria-label="睡眠定时分钟数"><button type="button" data-sleep-start>开始</button>';const input=controls.querySelector('input'),start=()=>{if(disposed)return;if(!sleep.setMinutes(input.value)){input.setAttribute('aria-invalid','true');notify('请输入 1–240 的整数分钟数');return;}input.removeAttribute('aria-invalid');};input.addEventListener('input',()=>input.removeAttribute('aria-invalid'));input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();start();}});controls.querySelector('button').addEventListener('click',start);}
   for(const row of nativeSettings.querySelectorAll('.art-setting-item')){
    const name=row.dataset.name||'',model=name?item(name):null,range=row.querySelector('input');
    const custom=row.classList.contains('player-skip-setting')||row.classList.contains('player-aspect-setting')||row.classList.contains('player-sleep-setting')||row.classList.contains('player-subtitle-setting');
    row.setAttribute('tabindex',range||custom?'-1':'0');row.setAttribute('role',model&&'switch'in model?'switch':range||custom?'group':'button');
    if(model&&'switch'in model)row.setAttribute('aria-checked',String(model.switch));
    if(range&&!range.hasAttribute('aria-label'))range.setAttribute('aria-label',row.querySelector('.art-setting-item-left-text')?.textContent||'调整数值');
    if(row.classList.contains('art-setting-item-back')){row.setAttribute('role','presentation');row.setAttribute('tabindex','-1');row.removeAttribute('aria-label');if(!row.querySelector('button[data-settings-back]')){const title=row.textContent.trim(),button=document.createElement('button');button.type='button';button.className='player-settings-back';button.dataset.settingsBack='';button.setAttribute('aria-label','返回上一级');button.innerHTML='<svg class="player-settings-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7"/></svg><span>'+escape(title)+'</span>';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(disposed)return;const parent=backSetting(instance.setting);decorateNativeSettings();activeNativePanel=nativeSettings.querySelector('.art-setting-panel.art-current');queueMicrotask(()=>parent?.$item?.focus({preventScroll:true}));});row.replaceChildren(button);}}
    if(['sleep-end','sleep-extend','sleep-cancel','sleep-resume'].includes(name)){row.setAttribute('data-'+name,'');if(name!=='sleep-end')row.hidden=!!model?.disable;}
    if(name==='subtitle-file')model?.$tooltip?.setAttribute('data-subtitle-summary','');
    if(name==='subtitle-toggle'){row.setAttribute('data-subtitle-toggle','');row.setAttribute('aria-disabled',String(!subtitle.cues.length));}
   }
   updateSkip();updateAspect();updateSubtitle();
  }
  function settingFocusables(){const current=nativeSettings.querySelector('.art-setting-panel.art-current');return current?[...current.querySelectorAll('[tabindex="0"],button:not(:disabled),input:not(:disabled)')].filter(node=>node.getClientRects().length&&!node.closest('[hidden]')):[];}
  const focusSetting=()=>settingFocusables()[0]?.focus({preventScroll:true});
  let activeNativePanel=nativeSettings.querySelector('.art-setting-panel.art-current');
  const nativeKey=event=>{
   event.stopPropagation();if(event.key==='Escape'){event.preventDefault();instance.setting.show=false;gear.focus();return;}
   if(event.key==='Tab'){const nodes=settingFocusables(),index=nodes.indexOf(document.activeElement),next=index+(event.shiftKey?-1:1);event.preventDefault();if(index>=0&&next>=0&&next<nodes.length)nodes[next].focus();else{instance.setting.show=false;gear.focus();}return;}
   if(['Enter',' '].includes(event.key)&&event.target.matches('.art-setting-item[tabindex="0"]')){event.preventDefault();event.target.click();}
  };
  const nativeClick=()=>{queueMicrotask(decorateNativeSettings);const current=nativeSettings.querySelector('.art-setting-panel.art-current');if(current!==activeNativePanel){activeNativePanel=current;queueMicrotask(focusSetting);}};
  const gearKey=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();gear.click();}};
  nativeSettings.addEventListener('keydown',nativeKey);nativeSettings.addEventListener('click',nativeClick);gear.addEventListener('keydown',gearKey);
  const settingObserver=new MutationObserver(decorateNativeSettings);settingObserver.observe(nativeSettings,{childList:true,subtree:true});decorateNativeSettings();
  instance.on('setting',active=>{gear.setAttribute('aria-expanded',String(active));if(active){closePanel(false);instance.setting.render();activeNativePanel=nativeSettings.querySelector('.art-setting-panel.art-current');decorateNativeSettings();queueMicrotask(focusSetting);}});
  instance.on('aspectRatio',updateAspect);
  instance.on('video:loadedmetadata',updateAspect);
  const restoredAspect=aspectFor(video,load('aspectRatio','default'));if(instance.aspectRatio!==restoredAspect)instance.aspectRatio=restoredAspect;
  const detachSleep=sleep.bind(instance),unsubscribe=sleep.subscribe(state=>{if(disposed)return;const label=state.stopped?'定时已结束，播放已停止':state.deadline?'将在 '+time(Math.ceil(state.remaining/1000))+' 后停止':state.endKey?sleep.applies(media)?'本集结束后停止，不再自动连播':'已为上一集设置停止':'未设置';const parent=item('sleep-timer');if(parent)parent.tooltip=label;const pill=root.querySelector('.player-sleep-pill');pill.hidden=!state.deadline&&!state.endKey&&!state.stopped;pill.textContent=label;for(const[name,hidden]of [['sleep-extend',!state.deadline],['sleep-cancel',!state.deadline&&!state.endKey],['sleep-resume',!state.stopped]]){const row=item(name);if(row){row.disable=hidden;if(row.$item)row.$item.hidden=hidden;}}if(state.stopped)setStatus('定时已结束，播放已停止');});
  const watch=createStallWatch({video,onRecover(){if(disposed||sleep.blocked())return;setStatus('播放较慢，正在恢复…');recover?.();},onFailed(){if(disposed||sleep.blocked())return;setStatus('正在尝试其他线路…');window.LivePlayback?.failed(media);}});
  const poll=setInterval(()=>watch.poll(),1000);
  instance.on('video:play',()=>{if(sleep.blocked()){instance.pause();return;}watch.arm();});
  instance.on('video:playing',()=>{watch.arm();if(!sleep.blocked())setStatus('');});
  instance.on('video:pause',()=>{if(!watch.snapshot().recovering)watch.suspend();});instance.on('video:seeking',()=>{if(!watch.snapshot().recovering)watch.suspend();});instance.on('video:seeked',()=>{watch.arm();renderSubtitle();});
  instance.on('video:timeupdate',renderSubtitle);
  const userPause=event=>{if(!watch.snapshot().recovering||video.paused)return;const pointer=event.type==='pointerdown'&&event.target.closest('.art-control-play,.art-video,.art-layer-play'),keyboard=event.type==='keydown'&&(event.key===' '||event.code==='Space')&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName);if(pointer||keyboard){watch.suspend();cancelRecovery?.();}};
  host.addEventListener('pointerdown',userPause,true);host.addEventListener('keydown',userPause,true);
  const fullscreenChanged=()=>{if(!document.fullscreenElement&&!document.webkitFullscreenElement&&opened)closePanel();};
  document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
  const onLoading=event=>{if(event.detail?.filmId!==film.id)return;updateTarget(true);setStatus('正在加载…',{busy:true});root.querySelectorAll('[data-player-episode],[data-player-line]').forEach(button=>button.disabled=true);};
  const onFailure=()=>{watch.suspend();updateTarget(false);setStatus('播放暂未恢复，请重试或换一条线路',{error:true});renderEpisodes();renderLines();};
  const health=event=>{if(event.detail?.filmId===film.id&&opened==='lines')renderLines(true);};
  document.addEventListener('playback-loading',onLoading);document.addEventListener('playback-error',onFailure);document.addEventListener('playback-failed',onFailure);document.addEventListener('playback-health',health);
  updateTarget();updateSkip();updateSubtitle();renderEpisodes();renderLines();if(!media?.url)setStatus('这条线路没有当前集，请选择其他线路',{error:true});
  if(nextFocus){const focus=nextFocus;nextFocus=null;queueMicrotask(()=>{if(!disposed)host.querySelector(`.player-bottom-trigger[data-player-panel="${focus}"]`)?.focus({preventScroll:true});});}
  instance.on('destroy',()=>{disposed=true;fileGeneration++;settingObserver.disconnect();routeObserver.disconnect();nativeSettings.removeEventListener('keydown',nativeKey);nativeSettings.removeEventListener('click',nativeClick);gear.removeEventListener('keydown',gearKey);if(mobileSheet.open)mobileSheet.close();watch.dispose();clearInterval(poll);host.removeEventListener('pointerdown',userPause,true);host.removeEventListener('keydown',userPause,true);detachSleep();unsubscribe();root.removeEventListener('click',onClick);document.removeEventListener('keydown',onKey,true);document.removeEventListener('click',outside,true);document.removeEventListener('fullscreenchange',fullscreenChanged);document.removeEventListener('webkitfullscreenchange',fullscreenChanged);document.removeEventListener('playback-loading',onLoading);document.removeEventListener('playback-error',onFailure);document.removeEventListener('playback-failed',onFailure);document.removeEventListener('playback-health',health);root.remove();});
  return{skipEnabled:which=>!temporary[which],sleep,watch,notify,updateSkip,openPanel,closePanel,playBlocked(){setStatus('点击继续播放');status.querySelector('[data-player-play]').hidden=false;}};
 }
 window.OpenStreamPlayerTools={attach,createStallWatch,createSleep,createSkipSettings,effectiveSkip,aspectFor,backSetting,subtitleValue,parseSubtitles,cuesAt,sleep,overrideFor};
})();

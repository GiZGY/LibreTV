(() => {
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const time=value=>{const n=Math.max(0,Math.round(value||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
 const mediaKey=media=>media?.filmId+':'+(media?.episodeKey||media?.episode||1);
 const overrides=new Map();
 let nextFocus=null;
 function overrideFor(media){const key=mediaKey(media);if(!overrides.has(key)){if(overrides.size>=50)overrides.delete(overrides.keys().next().value);overrides.set(key,{intro:false,outro:false});}return overrides.get(key);}
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
   setMinutes(minutes){const n=Number(minutes);if(!Number.isFinite(n)||n<1||n>240)return;state={deadline:now()+n*60000,endKey:null,stopped:false};clear();timer=schedule(tick);emit();},
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
  const video=instance.video,key=mediaKey(media),temporary=overrideFor(media);let disposed=false,opened=null,opener=null,fileGeneration=0;
  if(subtitle.key!==key)subtitle={key,cues:[],name:'',enabled:false,size:Math.max(16,Math.min(40,Number(load('subtitleSize',24))||24)),offset:0};
  const root=document.createElement('div');root.className='player-tools-ui';
  root.innerHTML=`<div class="player-tool-head"><div class="player-tool-title"><strong></strong><span data-player-target></span></div></div><div class="player-inline-status" role="status" hidden><span></span><button type="button" data-player-play hidden>继续播放</button><button type="button" data-player-retry hidden>重试</button><button type="button" data-player-panel="lines" hidden>换线</button><a href="#detail/${escape(film.id)}" hidden>返回详情</a></div><section class="player-tool-panel" data-player-view="episodes" role="dialog" aria-label="选集" tabindex="-1" hidden><div class="player-panel-heading"><h3>选集</h3><button type="button" data-player-close aria-label="关闭选集">关闭</button></div><div class="player-episode-grid"></div></section><section class="player-tool-panel" data-player-view="lines" role="dialog" aria-label="播放线路" tabindex="-1" hidden><div class="player-panel-heading"><h3>切换线路</h3><button type="button" data-player-close aria-label="关闭播放线路">关闭</button></div><div class="player-tool-lines"></div><p>缺少当前集的线路暂不可选。</p></section><input type="file" data-subtitle-file accept=".srt,.vtt" hidden><div class="player-local-subtitle" aria-hidden="true"></div><div class="player-sleep-pill" role="status" hidden></div>`;
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
  function updateSkip(){for(const key of ['intro','outro']){const row=item('skip-'+key);if(row){row.range=[skip[key],0,300,1];row.tooltip=skip[key]?skip[key]+' 秒':'关闭';}}}
  function renderEpisodes(){const state=episodeFor(film),list=window.OpenStreamEpisodes?.catalog(film)||Array.from({length:film.episodes},(_,i)=>({label:String(i+1)}));root.querySelector('.player-episode-grid').innerHTML=list.map((item,index)=>`<button type="button" data-player-episode="${index+1}" aria-pressed="${state.episode===index+1}" ${state.episode===index+1?'class="active"':''}>${escape(item.label)}</button>`).join('');}
  function renderLines(){root.querySelector('.player-tool-lines').innerHTML=(film.lines||[]).map((line,index)=>{const missing=window.OpenStreamEpisodes&&OpenStreamEpisodes.indexFor(film,line,episodeFor(film))<0,cut=window.OpenStreamEpisodes?.cut(line)||'标准版';return `<button type="button" data-player-line="${index}" aria-pressed="${index===(film.lineIndex||0)}" ${missing?'disabled':''}><span>${escape(line.name)}${cut!=='标准版'?' · '+escape(cut):''}</span><small>${missing?'缺少当前集':index===(film.lineIndex||0)?'当前线路':({fast:'响应较快',fair:'响应一般',slow:'响应较慢'})[line.health]||'尚未核实'}</small></button>`;}).join('');}
  function closePanel(restore=true){if(!opened)return;const panel=root.querySelector(`[data-player-view="${opened}"]`);panel.hidden=true;if(mobileSheet.open){mobileSheet.close();panel.setAttribute('role','dialog');root.append(panel);}host.querySelectorAll('[data-player-panel]').forEach(button=>button.setAttribute('aria-expanded','false'));opened=null;if(restore&&opener?.isConnected)opener.focus({preventScroll:true});}
  function openPanel(name,trigger){if(!['episodes','lines'].includes(name))return;instance.setting.show=false;const speed=host.querySelector('.fine-speed');if(speed)speed.open=false;if(opened===name){closePanel();return;}closePanel(false);opener=trigger||host.querySelector(`.player-bottom-trigger[data-player-panel="${name}"]`);opened=name;if(name==='episodes')renderEpisodes();if(name==='lines')renderLines();const panel=root.querySelector(`[data-player-view="${name}"]`);panel.hidden=false;if(matchMedia('(max-width:700px)').matches&&!document.fullscreenElement&&!instance.fullscreenWeb){mobileSheet.setAttribute('aria-label',panel.getAttribute('aria-label'));panel.setAttribute('role','document');mobileSheet.append(panel);mobileSheet.showModal();}host.querySelectorAll(`[data-player-panel="${name}"]`).forEach(button=>button.setAttribute('aria-expanded','true'));instance.controls.show=true;(panel.querySelector('button:not(:disabled)')||panel).focus({preventScroll:true});}
  function onClick(event){
   const button=event.target.closest('button');if(!button||!root.contains(button))return;event.stopPropagation();
   if(button.dataset.playerPanel){openPanel(button.dataset.playerPanel,button);return;}
   if(button.hasAttribute('data-player-close')){closePanel();return;}
   if(button.hasAttribute('data-player-play')){instance.video.play()?.catch(()=>notify('请再点击播放器中的播放按钮'));return;}
   if(button.hasAttribute('data-player-retry')){closePanel(false);window.LivePlayback?.retry(media);return;}
   if(button.dataset.playerEpisode){nextFocus='episodes';window.LivePlayback?.selectEpisode(media,Number(button.dataset.playerEpisode));return;}
   if(button.dataset.playerLine){nextFocus='lines';window.LivePlayback?.selectLine(media,Number(button.dataset.playerLine));return;}
  }
  function onKey(event){if(!opened)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePanel();return;}event.stopPropagation();if(event.key!=='Tab')return;const panel=root.querySelector(`[data-player-view="${opened}"]`),nodes=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),a[href]:not([hidden]),input:not(:disabled):not([hidden]),[tabindex="0"]')].filter(node=>node.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  const outside=event=>{if(!opened||event.target.closest('[data-player-panel]'))return;const panel=root.querySelector(`[data-player-view="${opened}"]`);if(event.target===mobileSheet){const r=mobileSheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}else if(!panel.contains(event.target))closePanel(false);};
  root.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);host.addEventListener('pointerdown',outside);
  root.addEventListener('change',async event=>{
   if(!event.target.hasAttribute('data-subtitle-file'))return;
   const file=event.target.files?.[0],generation=++fileGeneration;event.target.value='';if(!file)return;
   try{if(!/\.(srt|vtt)$/i.test(file.name))throw Error('请选择 SRT 或 VTT 字幕');if(file.size>2*1024*1024)throw Error('字幕文件过大，最多 2 MB');const buffer=await file.arrayBuffer();if(disposed||generation!==fileGeneration)return;let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('字幕编码未识别，请使用 UTF-8 文件');}const cues=parseSubtitles(text);subtitle={...subtitle,key,cues,name:file.name.slice(0,100),enabled:true,offset:0};renderSubtitle();updateSubtitle();notify('字幕已载入');}catch(error){if(!disposed&&generation===fileGeneration)notify(error.message);}
  });
  const caption=root.querySelector('.player-local-subtitle');
  function renderSubtitle(){if(disposed)return;caption.textContent=subtitle.enabled?cuesAt(subtitle.cues,Number(instance.currentTime)-subtitle.offset):'';caption.style.fontSize=subtitle.size+'px';}
  function updateSubtitle(){const file=item('subtitle-file'),toggle=item('subtitle-toggle'),size=item('subtitle-size'),offset=item('subtitle-offset'),parent=item('local-subtitle');if(file)file.tooltip=escape(subtitle.name||'尚未选择字幕');if(parent)parent.tooltip=subtitle.enabled?'已开启':'关闭';if(toggle){toggle.switch=subtitle.enabled;toggle.$item?.setAttribute('aria-checked',String(subtitle.enabled));toggle.$item?.setAttribute('aria-disabled',String(!subtitle.cues.length));}if(size){size.range=[subtitle.size,16,40,2];size.tooltip=subtitle.size+'px';}if(offset){offset.range=[subtitle.offset,-120,120,.5];offset.tooltip=subtitle.offset+' 秒';}}
  function markSkip(which){
   if(disposed||instance.isDestroy)return false;
   const duration=Number(instance.duration),position=Number(instance.currentTime),value=Math.round(which==='intro'?position:duration-position),other=which==='intro'?skip.outro:skip.intro;
   if(!Number.isFinite(duration)||duration<30||!Number.isFinite(value)||value<1||value>300||value+other>=duration-10||value>duration*.45){notify('这个位置不适合跳过，请选择更接近片头或片尾的位置');return false;}
   skip[which]=value;onSkipChange?.();updateSkip();notify((which==='intro'?'片头结束已记为 ':'片尾已记为 ')+time(value)+'，下一集起生效');return true;
  }
  const nativeSettings=instance.template.$setting,gear=instance.controls.setting;
  const nativeRows=[
   {name:'episode-skip',html:'本集跳过',tooltip:'单集设置',selector:[
    ...['intro','outro'].map(which=>({name:'keep-'+which,html:which==='intro'?'本集保留片头':'本集保留片尾',switch:temporary[which],onSwitch(row){if(disposed)return row.switch;const enabled=!row.switch;temporary[which]=enabled;row.$item?.setAttribute('aria-checked',String(enabled));notify(enabled?'仅本集保留，下一集恢复原设置':'本集恢复原跳过设置');return enabled;}})),
    {name:'skip-reset',html:'恢复默认',onClick(){if(!disposed){skip.intro=0;skip.outro=0;onSkipChange?.();updateSkip();notify('已关闭这部影片的片头片尾跳过');}return '';}}
   ]},
   {name:'sleep-timer',html:'睡眠定时',tooltip:'未设置',selector:[
    ...[15,30,60].map(minutes=>({name:'sleep-'+minutes,html:minutes+' 分钟',onClick(){if(!disposed)sleep.setMinutes(minutes);return '';}})),
    {name:'sleep-end',html:'本集结束停止',onClick(){if(!disposed)sleep.setEnd(media);return '';}},
    {name:'sleep-extend',html:'延长 15 分钟',disable:true,onClick(){if(!disposed)sleep.extend();return '';}},
    {name:'sleep-cancel',html:'取消定时',disable:true,onClick(){if(!disposed)sleep.cancel();return '';}},
    {name:'sleep-resume',html:'继续播放',disable:true,onClick(){if(!disposed){sleep.cancel();instance.play=true;instance.setting.show=false;}return '';}}
   ]},
   {name:'local-subtitle',html:'字幕',tooltip:subtitle.enabled?'已开启':'关闭',selector:[
    {name:'subtitle-file',html:'选择 SRT / VTT',tooltip:escape(subtitle.name||'尚未选择字幕'),onClick(){if(!disposed)root.querySelector('[data-subtitle-file]').click();return escape(subtitle.name||'尚未选择字幕');}},
    {name:'subtitle-toggle',html:'显示字幕',switch:subtitle.enabled,onSwitch(row){if(disposed)return row.switch;if(!subtitle.cues.length){notify('请先选择字幕');return false;}subtitle.enabled=!row.switch;renderSubtitle();updateSubtitle();return subtitle.enabled;}},
    {name:'subtitle-size',html:'字号',tooltip:subtitle.size+'px',range:[subtitle.size,16,40,2],onChange(row){if(!disposed){subtitle.size=Number(row.range[0]);save('subtitleSize',subtitle.size);renderSubtitle();}return subtitle.size+'px';}},
    {name:'subtitle-offset',html:'时间偏移',tooltip:subtitle.offset+' 秒',range:[subtitle.offset,-120,120,.5],onChange(row){if(!disposed){subtitle.offset=Number(row.range[0]);renderSubtitle();}return subtitle.offset+' 秒';}}
   ]}
  ];
  for(const row of nativeRows)instance.setting.add(row);
  gear.setAttribute('role','button');gear.setAttribute('tabindex','0');gear.setAttribute('aria-label','播放设置');gear.setAttribute('aria-expanded','false');
  nativeSettings.setAttribute('role','dialog');nativeSettings.setAttribute('aria-label','播放设置');
  function decorateNativeSettings(){
   for(const which of ['intro','outro']){
    const row=item('skip-'+which);if(!row?.$item)continue;row.$item.classList.add('player-skip-setting');
    if(!row.$item.querySelector('[data-skip-mark]')){const button=document.createElement('button');button.type='button';button.className='player-skip-mark';button.dataset.skipMark=which;button.textContent='标记';const label=which==='intro'?'当前位置记为片头结束':'当前位置记为片尾开始';button.title=label;button.setAttribute('aria-label',label);button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();markSkip(which);});row.$item.insertBefore(button,row.$item.querySelector('.art-setting-item-right'));}
    row.$range?.setAttribute('data-skip-range',which);row.$range?.setAttribute('aria-label',(which==='intro'?'跳过片头':'跳过片尾')+'秒数');
   }
   for(const row of nativeSettings.querySelectorAll('.art-setting-item')){
    const name=row.dataset.name||'',model=name?item(name):null,range=row.querySelector('input');
    row.setAttribute('tabindex',range?'-1':'0');row.setAttribute('role',model&&'switch'in model?'switch':range?'group':'button');
    if(model&&'switch'in model)row.setAttribute('aria-checked',String(model.switch));
    if(range&&!range.hasAttribute('aria-label'))range.setAttribute('aria-label',row.querySelector('.art-setting-item-left-text')?.textContent||'调整数值');
    if(/^keep-(intro|outro)$/.test(name))row.setAttribute('data-keep-skip',name.slice(5));
    if(name==='skip-reset')row.setAttribute('data-skip-reset','');
    if(/^sleep-(15|30|60)$/.test(name))row.setAttribute('data-sleep-minutes',name.slice(6));
    if(['sleep-end','sleep-extend','sleep-cancel','sleep-resume'].includes(name)){row.setAttribute('data-'+name,'');if(name!=='sleep-end')row.hidden=!!model?.disable;}
    if(name==='subtitle-file')model?.$tooltip?.setAttribute('data-subtitle-summary','');
    if(name==='subtitle-toggle'){row.setAttribute('data-subtitle-toggle','');row.setAttribute('aria-disabled',String(!subtitle.cues.length));}
    if(name==='subtitle-size'){model?.$range?.setAttribute('data-subtitle-size','');model?.$tooltip?.setAttribute('data-subtitle-size-value','');}
    if(name==='subtitle-offset')model?.$range?.setAttribute('data-subtitle-offset','');
   }
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
  instance.on('setting',active=>{gear.setAttribute('aria-expanded',String(active));if(active){closePanel(false);decorateNativeSettings();queueMicrotask(focusSetting);}});
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
  const health=event=>{if(event.detail?.filmId===film.id&&opened==='lines'&&!root.querySelector('.player-tool-lines').matches(':hover,:focus-within'))renderLines();};
  document.addEventListener('playback-loading',onLoading);document.addEventListener('playback-error',onFailure);document.addEventListener('playback-failed',onFailure);document.addEventListener('playback-health',health);
  updateTarget();updateSkip();updateSubtitle();renderEpisodes();renderLines();if(!media?.url)setStatus('这条线路没有当前集，请选择其他线路',{error:true});
  if(nextFocus){const focus=nextFocus;nextFocus=null;queueMicrotask(()=>{if(!disposed)host.querySelector(`.player-bottom-trigger[data-player-panel="${focus}"]`)?.focus({preventScroll:true});});}
  instance.on('destroy',()=>{disposed=true;fileGeneration++;settingObserver.disconnect();nativeSettings.removeEventListener('keydown',nativeKey);nativeSettings.removeEventListener('click',nativeClick);gear.removeEventListener('keydown',gearKey);if(mobileSheet.open)mobileSheet.close();watch.dispose();clearInterval(poll);host.removeEventListener('pointerdown',userPause,true);host.removeEventListener('keydown',userPause,true);detachSleep();unsubscribe();root.removeEventListener('click',onClick);document.removeEventListener('keydown',onKey,true);host.removeEventListener('pointerdown',outside);document.removeEventListener('fullscreenchange',fullscreenChanged);document.removeEventListener('webkitfullscreenchange',fullscreenChanged);document.removeEventListener('playback-loading',onLoading);document.removeEventListener('playback-error',onFailure);document.removeEventListener('playback-failed',onFailure);document.removeEventListener('playback-health',health);root.remove();});
  return{skipEnabled:which=>!temporary[which],sleep,watch,notify,updateSkip,openPanel,closePanel,playBlocked(){setStatus('点击继续播放');status.querySelector('[data-player-play]').hidden=false;}};
 }
 window.OpenStreamPlayerTools={attach,createStallWatch,createSleep,parseSubtitles,cuesAt,sleep,overrideFor};
})();

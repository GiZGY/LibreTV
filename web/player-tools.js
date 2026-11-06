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
  root.innerHTML=`<div class="player-tool-head"><div class="player-tool-title"><strong></strong><span data-player-target></span></div><div class="player-tool-actions">${isSeries(film)?'<button type="button" data-player-panel="episodes" aria-expanded="false">选集</button>':''}<button type="button" data-player-panel="lines" aria-expanded="false">线路</button><button type="button" data-player-panel="options" aria-expanded="false" aria-label="观看设置">设置</button></div></div><div class="player-inline-status" role="status" hidden><span></span><button type="button" data-player-play hidden>继续播放</button><button type="button" data-player-retry hidden>重试</button><button type="button" data-player-panel="lines" hidden>换线</button><a href="#detail/${escape(film.id)}" hidden>返回详情</a></div><section class="player-tool-panel" data-player-view="episodes" role="dialog" aria-label="选集" tabindex="-1" hidden><div class="player-panel-heading"><h3>选集</h3><button type="button" data-player-close aria-label="关闭选集">关闭</button></div><div class="player-episode-grid"></div></section><section class="player-tool-panel" data-player-view="lines" role="dialog" aria-label="播放线路" tabindex="-1" hidden><div class="player-panel-heading"><h3>切换线路</h3><button type="button" data-player-close aria-label="关闭播放线路">关闭</button></div><div class="player-tool-lines"></div><p>缺少当前集的线路暂不可选。</p></section><section class="player-tool-panel" data-player-view="options" role="dialog" aria-label="观看设置" tabindex="-1" hidden><div class="player-panel-heading"><h3>观看设置</h3><button type="button" data-player-close aria-label="关闭观看设置">关闭</button></div><section class="player-option-group"><h4>片头与片尾</h4><p data-skip-summary></p><div class="player-option-actions"><button type="button" data-skip-mark="intro">当前位置记为片头结束</button><button type="button" data-skip-mark="outro">当前位置记为片尾开始</button><button type="button" data-skip-reset>恢复默认</button></div><label class="player-option-check"><input type="checkbox" data-keep-skip="intro" ${temporary.intro?'checked':''}>本集保留片头</label><label class="player-option-check"><input type="checkbox" data-keep-skip="outro" ${temporary.outro?'checked':''}>本集保留片尾</label></section><section class="player-option-group"><h4>睡眠定时</h4><p data-sleep-summary role="status"></p><div class="player-option-actions">${[15,30,60].map(n=>`<button type="button" data-sleep-minutes="${n}">${n} 分钟</button>`).join('')}<button type="button" data-sleep-end>本集结束停止</button><button type="button" data-sleep-extend hidden>延长 15 分钟</button><button type="button" data-sleep-cancel hidden>取消定时</button><button type="button" data-sleep-resume hidden>继续播放</button></div></section><section class="player-option-group"><h4>外挂字幕</h4><p data-subtitle-summary role="status"></p><input type="file" data-subtitle-file accept=".srt,.vtt" hidden><div class="player-option-actions"><button type="button" data-subtitle-open>选择 SRT / VTT</button><button type="button" data-subtitle-toggle disabled>关闭字幕</button></div><label class="player-subtitle-control">字号 <input type="range" min="16" max="40" step="2" value="${subtitle.size}" data-subtitle-size aria-label="字幕字号"><output data-subtitle-size-value>${subtitle.size}px</output></label><label class="player-subtitle-control">时间偏移 <input type="number" min="-120" max="120" step="0.5" value="${subtitle.offset}" data-subtitle-offset aria-label="字幕时间偏移"><span>秒 · 正值延后</span></label><p>字幕仅在本机处理，仅用于本集。</p></section><p class="player-options-message" data-player-message role="status"></p></section><div class="player-local-subtitle" aria-hidden="true"></div><div class="player-sleep-pill" role="status" hidden></div>`;
  instance.template.$player.append(root);
  const mobileSheet=document.createElement('dialog');mobileSheet.className='player-mobile-sheet';mobileSheet.setAttribute('aria-label','观看选项');root.append(mobileSheet);
  mobileSheet.addEventListener('cancel',event=>{event.preventDefault();closePanel();});
  root.querySelector('.player-tool-title strong').textContent=film.name;
  const target=root.querySelector('[data-player-target]'),status=root.querySelector('.player-inline-status'),message=root.querySelector('[data-player-message]');
  const notify=text=>{message.textContent=text;instance.notice.show=text;};
  function setStatus(text,{error=false,busy=false}={}){status.hidden=!text;status.querySelector('span').textContent=text||'';status.classList.toggle('is-error',error);for(const node of status.querySelectorAll('[data-player-retry],[data-player-panel],a'))node.hidden=!error;status.querySelector('[data-player-play]').hidden=true;root.setAttribute('aria-busy',String(busy));}
  function updateTarget(loading=false){const state=episodeFor(film),item=window.OpenStreamEpisodes?.display(film,state);target.textContent=(loading?'正在加载 · ':'')+(isSeries(film)?(item?.label||'第 '+state.episode+' 集'):'正片')+(media?.cut&&media.cut!=='标准版'?' · '+media.cut:'');}
  function updateSkip(){root.querySelector('[data-skip-summary]').textContent='片头 '+time(skip.intro)+' · 片尾 '+time(skip.outro)+' · 整部影片生效';}
  function renderEpisodes(){const state=episodeFor(film),list=window.OpenStreamEpisodes?.catalog(film)||Array.from({length:film.episodes},(_,i)=>({label:String(i+1)}));root.querySelector('.player-episode-grid').innerHTML=list.map((item,index)=>`<button type="button" data-player-episode="${index+1}" aria-pressed="${state.episode===index+1}" ${state.episode===index+1?'class="active"':''}>${escape(item.label)}</button>`).join('');}
  function renderLines(){root.querySelector('.player-tool-lines').innerHTML=(film.lines||[]).map((line,index)=>{const missing=window.OpenStreamEpisodes&&OpenStreamEpisodes.indexFor(film,line,episodeFor(film))<0,cut=window.OpenStreamEpisodes?.cut(line)||'标准版';return `<button type="button" data-player-line="${index}" aria-pressed="${index===(film.lineIndex||0)}" ${missing?'disabled':''}><span>${escape(line.name)}${cut!=='标准版'?' · '+escape(cut):''}</span><small>${missing?'缺少当前集':index===(film.lineIndex||0)?'当前线路':({fast:'响应较快',fair:'响应一般',slow:'响应较慢'})[line.health]||'尚未核实'}</small></button>`;}).join('');}
  function closePanel(restore=true){if(!opened)return;const panel=root.querySelector(`[data-player-view="${opened}"]`);panel.hidden=true;if(mobileSheet.open){mobileSheet.close();panel.setAttribute('role','dialog');root.append(panel);}root.querySelectorAll('[data-player-panel]').forEach(button=>button.setAttribute('aria-expanded','false'));opened=null;if(restore&&opener?.isConnected)opener.focus({preventScroll:true});}
  function openPanel(name,trigger){if(opened===name){closePanel();return;}closePanel(false);opener=trigger||root.querySelector(`[data-player-panel="${name}"]`);opened=name;if(name==='episodes')renderEpisodes();if(name==='lines')renderLines();const panel=root.querySelector(`[data-player-view="${name}"]`);panel.hidden=false;if(matchMedia('(max-width:700px)').matches&&!document.fullscreenElement&&!instance.fullscreenWeb){mobileSheet.setAttribute('aria-label',panel.getAttribute('aria-label'));panel.setAttribute('role','document');mobileSheet.append(panel);mobileSheet.showModal();}root.querySelectorAll(`[data-player-panel="${name}"]`).forEach(button=>button.setAttribute('aria-expanded','true'));instance.controls.show=true;(panel.querySelector('button:not(:disabled)')||panel).focus({preventScroll:true});}
  function onClick(event){
   const button=event.target.closest('button');if(!button||!root.contains(button))return;event.stopPropagation();
   if(button.dataset.playerPanel){openPanel(button.dataset.playerPanel,button);return;}
   if(button.hasAttribute('data-player-close')){closePanel();return;}
   if(button.hasAttribute('data-player-play')){instance.video.play()?.catch(()=>notify('请再点击播放器中的播放按钮'));return;}
   if(button.hasAttribute('data-player-retry')){closePanel(false);window.LivePlayback?.retry(media);return;}
   if(button.dataset.playerEpisode){nextFocus='episodes';window.LivePlayback?.selectEpisode(media,Number(button.dataset.playerEpisode));return;}
   if(button.dataset.playerLine){nextFocus='lines';window.LivePlayback?.selectLine(media,Number(button.dataset.playerLine));return;}
   if(button.dataset.skipMark){const duration=Number(instance.duration),position=Number(instance.currentTime),which=button.dataset.skipMark,value=Math.round(which==='intro'?position:duration-position),other=which==='intro'?skip.outro:skip.intro;
    if(!Number.isFinite(duration)||duration<30||!Number.isFinite(value)||value<1||value>300||value+other>=duration-10||value>duration*.45){notify('这个位置不适合跳过，请选择更接近片头或片尾的位置');return;}
    skip[which]=value;onSkipChange?.();updateSkip();notify((which==='intro'?'片头结束已记为 ':'片尾已记为 ')+time(value)+'，下一集起生效');return;
   }
   if(button.hasAttribute('data-skip-reset')){skip.intro=0;skip.outro=0;onSkipChange?.();updateSkip();notify('已关闭这部影片的片头片尾跳过');return;}
   if(button.dataset.sleepMinutes){sleep.setMinutes(button.dataset.sleepMinutes);return;}
   if(button.hasAttribute('data-sleep-end')){sleep.setEnd(media);return;}
   if(button.hasAttribute('data-sleep-cancel')){sleep.cancel();return;}
   if(button.hasAttribute('data-sleep-extend')){sleep.extend();return;}
   if(button.hasAttribute('data-sleep-resume')){sleep.cancel();instance.play=true;closePanel();return;}
   if(button.hasAttribute('data-subtitle-open')){root.querySelector('[data-subtitle-file]').click();return;}
   if(button.hasAttribute('data-subtitle-toggle')){subtitle.enabled=!subtitle.enabled;renderSubtitle();updateSubtitle();}
  }
  function onKey(event){if(!opened)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePanel();return;}event.stopPropagation();if(event.key!=='Tab')return;const panel=root.querySelector(`[data-player-view="${opened}"]`),nodes=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),a[href]:not([hidden]),input:not(:disabled):not([hidden]),[tabindex="0"]')].filter(node=>node.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  const outside=event=>{if(!opened||event.target.closest('[data-player-panel]'))return;const panel=root.querySelector(`[data-player-view="${opened}"]`);if(event.target===mobileSheet){const r=mobileSheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}else if(!panel.contains(event.target))closePanel(false);};
  root.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);host.addEventListener('pointerdown',outside);
  root.addEventListener('change',async event=>{
   if(event.target.dataset.keepSkip){temporary[event.target.dataset.keepSkip]=event.target.checked;notify(event.target.checked?'仅本集保留，下一集恢复原设置':'本集恢复原跳过设置');return;}
   if(!event.target.hasAttribute('data-subtitle-file'))return;
   const file=event.target.files?.[0],generation=++fileGeneration;event.target.value='';if(!file)return;
   try{if(!/\.(srt|vtt)$/i.test(file.name))throw Error('请选择 SRT 或 VTT 字幕');if(file.size>2*1024*1024)throw Error('字幕文件过大，最多 2 MB');const buffer=await file.arrayBuffer();if(disposed||generation!==fileGeneration)return;let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('字幕编码未识别，请使用 UTF-8 文件');}const cues=parseSubtitles(text);subtitle={...subtitle,key,cues,name:file.name.slice(0,100),enabled:true,offset:0};root.querySelector('[data-subtitle-offset]').value='0';renderSubtitle();updateSubtitle();notify('字幕已载入');}catch(error){if(!disposed&&generation===fileGeneration)notify(error.message);}
  });
  root.addEventListener('input',event=>{if(event.target.hasAttribute('data-subtitle-size')){subtitle.size=Math.max(16,Math.min(40,Number(event.target.value)||24));save('subtitleSize',subtitle.size);renderSubtitle();updateSubtitle();}if(event.target.hasAttribute('data-subtitle-offset')){subtitle.offset=Math.max(-120,Math.min(120,Number(event.target.value)||0));renderSubtitle();}});
  const caption=root.querySelector('.player-local-subtitle');
  function renderSubtitle(){if(disposed)return;caption.textContent=subtitle.enabled?cuesAt(subtitle.cues,Number(instance.currentTime)-subtitle.offset):'';caption.style.fontSize=subtitle.size+'px';}
  function updateSubtitle(){root.querySelector('[data-subtitle-summary]').textContent=subtitle.name?(subtitle.name+(subtitle.enabled?'':' · 已关闭')):'尚未选择字幕';root.querySelector('[data-subtitle-size-value]').textContent=subtitle.size+'px';const toggle=root.querySelector('[data-subtitle-toggle]');toggle.disabled=!subtitle.cues.length;toggle.textContent=subtitle.enabled?'关闭字幕':'开启字幕';}
  const detachSleep=sleep.bind(instance),unsubscribe=sleep.subscribe(state=>{if(disposed)return;const label=state.stopped?'定时已结束，播放已停止':state.deadline?'将在 '+time(Math.ceil(state.remaining/1000))+' 后停止':state.endKey?sleep.applies(media)?'本集结束后停止，不再自动连播':'已为上一集设置停止':'未设置';root.querySelector('[data-sleep-summary]').textContent=label;const pill=root.querySelector('.player-sleep-pill');pill.hidden=!state.deadline&&!state.endKey&&!state.stopped;pill.textContent=label;root.querySelector('[data-sleep-extend]').hidden=!state.deadline;root.querySelector('[data-sleep-cancel]').hidden=!state.deadline&&!state.endKey;root.querySelector('[data-sleep-resume]').hidden=!state.stopped;if(state.stopped)setStatus('定时已结束，播放已停止');});
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
  if(nextFocus){const focus=nextFocus;nextFocus=null;queueMicrotask(()=>{if(!disposed)root.querySelector(`[data-player-panel="${focus}"]`)?.focus({preventScroll:true});});}
  instance.on('destroy',()=>{disposed=true;fileGeneration++;if(mobileSheet.open)mobileSheet.close();watch.dispose();clearInterval(poll);host.removeEventListener('pointerdown',userPause,true);host.removeEventListener('keydown',userPause,true);detachSleep();unsubscribe();root.removeEventListener('click',onClick);document.removeEventListener('keydown',onKey,true);host.removeEventListener('pointerdown',outside);document.removeEventListener('fullscreenchange',fullscreenChanged);document.removeEventListener('webkitfullscreenchange',fullscreenChanged);document.removeEventListener('playback-loading',onLoading);document.removeEventListener('playback-error',onFailure);document.removeEventListener('playback-failed',onFailure);document.removeEventListener('playback-health',health);root.remove();});
  return{skipEnabled:which=>!temporary[which],sleep,watch,notify,updateSkip,closePanel,playBlocked(){setStatus('点击继续播放');status.querySelector('[data-player-play]').hidden=false;}};
 }
 window.OpenStreamPlayerTools={attach,createStallWatch,createSleep,parseSubtitles,cuesAt,sleep,overrideFor};
})();

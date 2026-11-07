(() => {
 const style=document.createElement('style');
 style.textContent='#watch-player:fullscreen{width:100vw;height:100vh;background:#000}#watch-player:fullscreen .art-video-player{width:100%;height:100%}.player-next-episode{display:grid;place-items:center;width:32px;height:32px;padding:4px;border:0;background:none;color:inherit;cursor:pointer}.player-next-episode:disabled{opacity:.35;cursor:default}.player-next-episode:focus-visible{outline:2px solid #ef692e;outline-offset:-2px;border-radius:4px}';
 document.head.append(style);
 let art=null;
 let host=null;
 let mountedMedia=null;
 let libraryPromise;
 let hlsPromise;
 function loadHls(){
  if(window.Hls)return Promise.resolve();
  return hlsPromise ||= new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='libs/hls.min.js';
   script.onload=resolve;script.onerror=()=>{hlsPromise=null;reject(new Error('视频组件加载失败'));};
   document.head.append(script);
  });
 }
 function loadPlayer(){
  if(window.Artplayer)return Promise.resolve();
  return libraryPromise ||= new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='libs/artplayer.min.js?v=5.4.0';
   script.onload=resolve;script.onerror=()=>{libraryPromise=null;reject(new Error('播放器加载失败'));};
   document.head.append(script);
  });
 }
 function verifyMedia(url,{signal,position=0,ratio=null,rate=1,timeoutMs=5000}={}){
  return new Promise(resolve=>{
   const video=document.createElement('video');video.dataset.playbackProbe='';video.muted=true;video.defaultMuted=true;video.volume=0;video.playsInline=true;video.preload='auto';video.playbackRate=video.defaultPlaybackRate=rate;video.setAttribute('aria-hidden','true');video.tabIndex=-1;video.style.cssText='position:fixed;width:1px;height:1px;left:0;top:0;opacity:0;pointer-events:none';
   let hls=null,done=false,anchor=null,target=0,seeking=false;const started=performance.now(),events=[];
   const on=(name,fn)=>{events.push([name,fn]);video.addEventListener(name,fn);};
   const finish=(playable,reason)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);signal?.removeEventListener('abort',abort);for(const [name,fn]of events)video.removeEventListener(name,fn);hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();resolve({playable,reason,ms:performance.now()-started});};
   const abort=()=>finish(false,'aborted'),timer=setTimeout(()=>finish(false,'timeout'),timeoutMs);
   const poll=setInterval(()=>{
    if(video.error){finish(false,'media_error');return;}
    if(video.paused||video.seeking||seeking||video.readyState<2||!video.videoWidth)return;
    if(video.currentTime<target-.25)return;
    if(!anchor){anchor={position:video.currentTime,stamp:performance.now()};return;}
    if(video.currentTime-anchor.position>.15&&performance.now()-anchor.stamp>=200)finish(true,'decoded_progress');
   },100);
   const play=()=>{if(done)return;video.play()?.catch(error=>{if(!done&&error?.name!=='AbortError')finish(false,error?.name==='NotAllowedError'?'play_blocked':'media_error');});};
   on('error',()=>finish(false,'media_error'));on('seeked',()=>{seeking=false;anchor=null;play();});on('canplay',play);
   on('loadedmetadata',()=>{const duration=Number(video.duration);target=Number.isFinite(duration)&&duration>0?Math.min(Math.max(0,Number.isFinite(ratio)&&ratio>0?ratio*duration:position),Math.max(0,duration-.5)):Math.max(0,position);if(target>.1){seeking=true;try{video.currentTime=target;}catch{finish(false,'seek_failed');return;}}play();});
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
   (document.fullscreenElement||document.body).append(video);
   void(async()=>{
    try{
     if(!/\.mp4(?:[?#]|$)/i.test(url)){
      try{await loadHls();}catch{if(!video.canPlayType('application/vnd.apple.mpegurl'))throw Error('engine');}
      if(done)return;
      if(window.Hls?.isSupported()){
       hls=new Hls({enableWorker:true,maxBufferLength:4,maxMaxBufferLength:8,backBufferLength:0,startPosition:Math.max(0,position),manifestLoadingTimeOut:3000,manifestLoadingMaxRetry:0,fragLoadingTimeOut:3000,fragLoadingMaxRetry:0});
       hls.on(Hls.Events.ERROR,(_event,error)=>{if(error.fatal)finish(false,'media_error');});hls.loadSource(url);hls.attachMedia(video);
      }else video.src=url;
     }else video.src=url;
     play();
    }catch{finish(false,'engine_error');}
   })();
  });
 }
 window.OpenStreamPlayerProbe={verify:verifyMedia};
 async function mount(){
  const next=document.querySelector('#watch-player');
  const currentMedia=window.LivePlayback?.current();
  const metric=window.OpenStreamPlayback?.forMedia(currentMedia);
  if(next===host&&currentMedia===mountedMedia)return;
  const webFullscreen=!!art?.fullscreenWeb;
  const previousSound=art?.video?{muted:art.video.muted,volume:art.video.volume}:null;
  if(art){art.destroy(false);art=null;}
  host=next;mountedMedia=currentMedia;if(!host)return;
  try{
   metric?.segment('engine');await loadPlayer();if(host!==next||currentMedia!==mountedMedia||!next.isConnected)return;
   const film=films.find(f=>f.id===location.hash.split('/')[1]);
   const media=window.LivePlayback?.current();
   const mediaUrl=media?.url||'';
   const isHls=!!mediaUrl&&!/\.mp4(?:[?#]|$)/i.test(mediaUrl);
   if(isHls){
    try{await loadHls();}catch(error){
     if(!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'))throw error;
    }
    if(host!==next||currentMedia!==mountedMedia||!next.isConnected)return;
   }
   metric?.segment('render');
   let hls=null,guard=null,recoveries=0,failed=false,nativePlayback=false,overlayNotice=null,overlayTimer,session=metric,tools=null;
   const reportHealth=health=>{if(media)document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:media.filmId,lineKey:media.lineKey,health}}));};
   const fail=()=>{if(failed||media!==window.LivePlayback?.current())return;failed=true;reportHealth('slow');window.LivePlayback?.failed(media);};
   const skipKey='skip_'+film.id;
   const storedSkip=load(skipKey,{});
   const configuredSkip={intro:Math.min(300,Math.max(0,Math.round(Number(storedSkip.intro)||0))),outro:Math.min(300,Math.max(0,Math.round(Number(storedSkip.outro)||0)))};
   const skip=window.OpenStreamPlayerTools?.effectiveSkip(media,configuredSkip)||{...configuredSkip};
   const skipSetting=(key,label)=>({name:'skip-'+key,html:label,onClick:()=>''});
   // Reparenting a native-fullscreen element exits fullscreen in Chromium.
   Artplayer.FULLSCREEN_WEB_IN_BODY=false;
   // The application owns recovery; library reconnects would outlive its bounded budget.
   Artplayer.RECONNECT_TIME_MAX=0;
   session?.segment('media');
   art=new Artplayer({container:next,url:mediaUrl,type:isHls?'m3u8':'',theme:'#ef692e',lang:'zh-cn',autoplay:!!media?.autoplay&&!window.OpenStreamPlayerTools?.sleep.blocked(),
    customType:{m3u8(video,url){
     const startNative=()=>{
      if(nativePlayback||!video.canPlayType('application/vnd.apple.mpegurl'))return false;
      const resumePlaying=!video.paused;
      nativePlayback=true;
      guard?.();guard=null;hls?.destroy();hls=null;
      video.disableRemotePlayback=false;
      video.src=url;
      guard=window.OpenStreamNativeAdSession?.attach({video,host:next,url});
      if(resumePlaying)video.play()?.catch(()=>{});
      return true;
     };
     try{
     if(window.Hls?.isSupported()){
      hls=new Hls({enableWorker:true,backBufferLength:30,maxBufferLength:30,maxMaxBufferLength:60,fLoader:OpenStreamAdGuard.createFragmentLoader(Hls.DefaultConfig.loader,(context,response)=>guard?.inspect?.(context,response))});
      guard=OpenStreamAdGuard.attach({hls,video,events:Hls.Events,host:next,enabled:()=>true,
       onOverlay:()=>{
        if(!window.LivePlayback?.overlay(media))return;
        overlayNotice=document.createElement('div');
        overlayNotice.className='ad-skip-notice';overlayNotice.setAttribute('role','status');
        overlayNotice.style.pointerEvents='none';overlayNotice.textContent='请勿相信片中广告';
        next.appendChild(overlayNotice);
        overlayTimer=setTimeout(()=>{overlayNotice?.remove();overlayNotice=null;},2000);
       }});
      const activeHls=hls;
      hls.on(Hls.Events.ERROR,(_event,error)=>{
       if(!error.fatal||nativePlayback||hls!==activeHls)return;
       const startupCodecError=['bufferAddCodecError','bufferIncompatibleCodecsError','manifestIncompatibleCodecsError'].includes(error.details);
       if(startupCodecError&&!video.played.length&&video.readyState<2){
        try{if(startNative())return;}catch(_){fail();return;}
       }
       if(recoveries++<1&&error.type===Hls.ErrorTypes.MEDIA_ERROR){if(typeof session!=='undefined')session?.recovery();hls.recoverMediaError();}else fail();
      });
      hls.loadSource(url);hls.attachMedia(video);
     }else if(!startNative())next.innerHTML='<div class="watch-empty">当前浏览器不支持此视频格式</div>';
     }catch(error){if(!startNative())throw error;}
    }},
    volume:previousSound?.volume??load('volume',.8),muted:previousSound?.muted??load('muted',false),setting:true,airplay:true,aspectRatio:false,pip:true,fullscreen:true,fullscreenWeb:true,playsInline:true,
    hotkey:true,fastForward:false,playbackRate:false,autoPlayback:false,
    settings:[...(isSeries(film)?[{html:'自动连播',switch:load('autoplay',true),onSwitch(item){const enabled=!item.switch;save('autoplay',enabled);document.querySelectorAll('#autoplay,[data-watch-autoplay]').forEach(el=>el.checked=enabled);return enabled;}}]:[]),skipSetting('intro','跳过片头'),skipSetting('outro','跳过片尾')],
    controls:[...(isSeries(film)?[{name:'next-episode',position:'left',index:11,html:'<button type="button" class="player-next-episode" aria-label="下一集" title="下一集" '+(window.OpenStreamEpisodes?!OpenStreamEpisodes.nextOrdinal(film,episodeFor(film))?'disabled':'':episodeFor(film).episode>=film.episodes?'disabled':'')+'><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M5 4v16l11-8L5 4zm12 0h3v16h-3z"/></svg></button>',click:()=>advance(true)}]:[]),...(isSeries(film)?[{name:'episode-picker',position:'right',index:5,html:'<button type="button" class="player-bottom-trigger" data-player-panel="episodes" aria-expanded="false">选集</button>',click:(_controls,event)=>{event.stopPropagation();tools?.openPanel('episodes',event.target.closest('button'));}}]:[]),{name:'route-picker',position:'right',index:6,html:'<button type="button" class="player-bottom-trigger" data-player-panel="lines" aria-expanded="false">线路</button>',click:(_controls,event)=>{event.stopPropagation();tools?.openPanel('lines',event.target.closest('button'));}},{name:'fine-speed',position:'right',index:8,html:'<details class="fine-speed"><summary aria-label="调整播放速度" aria-haspopup="dialog" aria-controls="player-speed-popover" aria-expanded="false">1×</summary><div class="fine-speed-panel" id="player-speed-popover" role="dialog" aria-label="播放速度"><div class="fine-speed-heading"><div class="rate-stepper"><button type="button" data-step="-0.05" aria-label="减慢 0.05 倍">−</button><output>1×</output><button type="button" data-step="0.05" aria-label="加快 0.05 倍">＋</button></div></div><div class="fine-speed-track"><input type="range" min="0.5" max="2" step="0.05" value="1" aria-label="播放速度" aria-valuetext="1 倍"><div class="fine-speed-presets">'+[.5,.75,1,1.25,1.5,1.75,2].map(n=>'<button type="button" style="--tick:'+((n-.5)/1.5*100)+'%" data-rate="'+n+'">'+n+'×</button>').join('')+'</div></div></div></details>'}],
    layers:mediaUrl?[]:[{name:'empty-media',html:'<div class="watch-empty"><span>暂未获取到播放地址</span><p>请选择其他线路，或返回影片详情</p></div>',style:{inset:'0',display:'grid',placeItems:'center',pointerEvents:'none'}}]
   });
   const instance=art;
   const sound={muted:previousSound?.muted??load('muted',false),volume:previousSound?.volume??load('volume',.8)};
   function restoreSound(){
    if(instance.isDestroy)return;
    instance.video.defaultMuted=sound.muted;
    instance.video.muted=sound.muted;
    instance.video.volume=sound.volume;
   }
   // WebKit can reset decoder mute on play or rate changes without a JS setter call.
   restoreSound();
   instance.on('video:play',restoreSound);
   instance.on('video:ratechange',restoreSound);
   session ||= media?.url?window.OpenStreamPlayback?.createSession({transition:media?.switched?'line':media?.autoplay?'episode':'open',trigger:media?.trigger||'open'}):null;
   session?.bindMedia(media,media?.episodeKey,()=>!instance.isDestroy&&media===window.LivePlayback?.current());
   instance.on('destroy',()=>session?.dispose());
   let playIntent=!!media?.autoplay,playAttempt=false,playAttempts=0,playTimer=null;
   function resumePlayIntent(){
    if(!playIntent||playAttempt||instance.isDestroy||media!==window.LivePlayback?.current()||window.OpenStreamPlayerTools?.sleep.blocked())return;
    playAttempt=true;playAttempts++;
    Promise.resolve().then(()=>instance.video.play()).catch(error=>{
     if(!playIntent||instance.isDestroy)return;
     if(error?.name==='AbortError'&&playAttempts<5){clearTimeout(playTimer);playTimer=setTimeout(resumePlayIntent,250);}
     else{playIntent=false;instance.controls.show=true;instance.mask.show=true;tools?.playBlocked();}
    }).finally(()=>{playAttempt=false;});
   }
   for(const event of ['video:loadedmetadata','video:canplay','video:seeked'])instance.on(event,()=>queueMicrotask(resumePlayIntent));
   instance.on('video:playing',()=>{playIntent=false;clearTimeout(playTimer);});
   instance.on('destroy',()=>{playIntent=false;clearTimeout(playTimer);});
   instance.on('video:volumechange',()=>{if(instance.isDestroy)return;sound.volume=instance.video.volume;sound.muted=instance.video.muted;save('volume',sound.volume);save('muted',sound.muted);});
   instance.on('video:waiting',()=>{if(!instance.video.paused&&!instance.video.seeking)session?.waiting();});
   instance.on('video:playing',()=>session?.playing());
   instance.on('video:pause',()=>session?.phase('paused'));
   instance.on('video:seeking',()=>session?.phase('seeking'));
   instance.on('video:ended',()=>session?.phase('ended'));
   instance.on('video:error',()=>session?.error('media_'+(instance.video.error?.code||'unknown')));
   instance.on('video:timeupdate',()=>session?.tick(instance.currentTime,{paused:instance.video.paused,seeking:instance.video.seeking,hidden:document.hidden,media,episodeKey:media?.episodeKey,actualRate:instance.video.playbackRate,defaultRate:instance.video.defaultPlaybackRate}));
   const metricVisibility=()=>session?.visibility(document.hidden);document.addEventListener('visibilitychange',metricVisibility);metricVisibility();instance.on('destroy',()=>document.removeEventListener('visibilitychange',metricVisibility));
   if(instance.video.requestVideoFrameCallback){const frame=instance.video.requestVideoFrameCallback(()=>{if(!instance.isDestroy)session?.frame({media,episodeKey:media?.episodeKey});});instance.on('destroy',()=>instance.video.cancelVideoFrameCallback?.(frame));}
   instance.on('destroy',()=>{clearTimeout(overlayTimer);overlayNotice?.remove();guard?.();hls?.destroy();});
   let progressAt=0;
   instance.on('video:timeupdate',()=>{if(media===window.LivePlayback?.current()&&media&&restored&&Date.now()-progressAt>5000&&!instance.video.paused){progressAt=Date.now();window.LivePlayback?.progress(instance.currentTime,instance.duration,media.filmId);}});
   instance.on('video:pause',()=>{if(media===window.LivePlayback?.current()&&media&&restored)window.LivePlayback?.progress(instance.currentTime,instance.duration,media.filmId);});
   instance.on('video:error',()=>{if(media&&(!isHls||nativePlayback))fail();});
   let waitingAt=0,stallTimer=null;
   instance.on('video:waiting',()=>{
    if(instance.video.seeking||instance.video.paused)return;
    waitingAt=performance.now();clearTimeout(stallTimer);
    stallTimer=setTimeout(()=>reportHealth('slow'),3000);
   });
   instance.on('video:playing',()=>{
    clearTimeout(stallTimer);
    const delay=waitingAt?performance.now()-waitingAt:0;
    reportHealth(delay>=3000?'slow':delay>=1000?'fair':'fast');
    if(media)window.OpenStreamSourceHealth?.recordSourceEvent(media.source,{status:'ready',ms:delay});
    waitingAt=0;
   });
   instance.on('video:seeking',()=>{clearTimeout(stallTimer);waitingAt=0;});
   instance.on('video:pause',()=>{clearTimeout(stallTimer);waitingAt=0;});
   instance.on('destroy',()=>clearTimeout(stallTimer));
   const panel=next.querySelector('.fine-speed');
   const slider=panel.querySelector('input');
   const format=rate=>Number(rate.toFixed(2))+'×';
   const normalizeRate=value=>{const rate=Number(value);return Number.isFinite(rate)&&rate>0?Math.max(.5,Math.min(2,Math.round(rate*20)/20)):1;};
   let preferredRate=normalizeRate(load('playbackRate',1));
   let holdTimer=null,holding=false;
   function syncRate(){
    if(instance.isDestroy)return;
    const video=instance.video;
    // Decoder creation and the initial resume seek can discard an early rate even
    // when the DOM still reports it. Commit only after a frame and completed seek.
    if(video.readyState<2||video.seeking)return;
    // A media reload resets playbackRate to defaultPlaybackRate, including HLS recovery.
    if(video.defaultPlaybackRate!==preferredRate)video.defaultPlaybackRate=preferredRate;
    const target=holding?2:preferredRate;
    if(video.playbackRate!==target)instance.playbackRate=target;
    const rate=video.playbackRate;
    if(typeof session!=='undefined')session?.rates(preferredRate,target,rate,video.defaultPlaybackRate);
    slider.value=String(rate);slider.setAttribute('aria-valuetext',format(rate));
    slider.style.setProperty('--rate-fill',((rate-.5)/1.5*100)+'%');
    panel.querySelector('summary').textContent=format(rate);
    panel.querySelector('output').textContent=format(rate);
    panel.querySelector('[data-step="-0.05"]').disabled=rate<=.5;panel.querySelector('[data-step="0.05"]').disabled=rate>=2;
    panel.querySelectorAll('[data-rate]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.rate)===rate)));
   }
   function updateRate(value){preferredRate=normalizeRate(value);save('playbackRate',preferredRate);syncRate();}
   // Position restoration is one-shot; speed must survive every media lifecycle/recovery.
   for(const event of ['video:loadstart','video:loadedmetadata','video:loadeddata','video:seeked','video:canplay','video:play','video:playing','video:ratechange'])instance.on(event,syncRate);
   panel.addEventListener('click',event=>{event.stopPropagation();instance.setting.show=false;const button=event.target.closest('[data-rate]');if(button)updateRate(button.dataset.rate);const step=event.target.closest('[data-step]');if(step)updateRate(Number(slider.value)+Number(step.dataset.step));});
   // Safari may blur details before a non-focusable mouse button dispatches its click.
   panel.addEventListener('mousedown',event=>{if(event.target.closest('[data-rate],[data-step]'))event.preventDefault();});
   // A drag-release click can land outside; a fresh press starts a new dismissal.
   let rangePointer=null,ignoreRangeClick=false;
   const resetRangeClick=()=>{ignoreRangeClick=false;},endRange=event=>{if(event.pointerId===rangePointer)rangePointer=null;};
   slider.addEventListener('pointerdown',event=>{rangePointer=event.pointerId;ignoreRangeClick=true;instance.controls.show=true;});
   document.addEventListener('pointerdown',resetRangeClick,true);document.addEventListener('pointerup',endRange,true);document.addEventListener('pointercancel',endRange,true);
   function fitSpeedPanel(){
    const popup=panel.querySelector?.('.fine-speed-panel');if(!popup||typeof next==='undefined'||!panel.open||rangePointer!==null)return;
    popup.style.maxHeight=Math.max(80,next.clientHeight-66)+'px';popup.style.maxWidth=Math.max(160,next.clientWidth-16)+'px';popup.style.overflowY='auto';popup.style.right='';
    const rect=popup.getBoundingClientRect(),bounds=next.getBoundingClientRect(),right=parseFloat(getComputedStyle(popup).right)||0;
    if(rect.right>bounds.right-8)popup.style.right=(right+rect.right-bounds.right+8)+'px';
    else if(rect.left<bounds.left+8)popup.style.right=(right-(bounds.left+8-rect.left))+'px';
   }
   panel.addEventListener('toggle',()=>{panel.querySelector('summary').setAttribute('aria-expanded',String(panel.open));if(panel.open){tools?.closePanel(false);instance.setting.show=false;instance.controls.show=true;fitSpeedPanel();}});
   instance.on('control',visible=>{if(!visible&&panel.open&&!instance.isDestroy)instance.controls.show=true;});
   instance.on('resize',fitSpeedPanel);
   instance.on('setting',visible=>{if(visible)panel.open=false;});
   const playerElement=instance.template.$player;
   // Keep native fullscreen on the host, including Artplayer double-click entry.
   if(next.requestFullscreen)playerElement.requestFullscreen=()=>next.requestFullscreen();
   let restoreWebFullscreen=webFullscreen&&!!document.fullscreenElement;
   let webScroll=[0,0];
   instance.on('fullscreenWeb',active=>{
    if(active)webScroll=[window.scrollX,window.scrollY];
    document.documentElement.classList.toggle('video-web-fullscreen',active);
    if(!active)window.scrollTo({left:webScroll[0],top:webScroll[1],behavior:'instant'});
   });
   const enterNativeFullscreen=event=>{
    if(!event.target.closest('.art-control-fullscreen')||!next.requestFullscreen)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(document.fullscreenElement){document.exitFullscreen();return;}
    restoreWebFullscreen=instance.fullscreenWeb;
    playerElement.classList.add('fullscreen-transfer');
    next.requestFullscreen().catch(()=>{
     restoreWebFullscreen=false;playerElement.classList.remove('fullscreen-transfer');
     instance.notice.show='当前浏览器无法进入全屏';
    });
   };
   playerElement.addEventListener('click',enterNativeFullscreen,true);
   instance.on('fullscreen',active=>{
    panel.open=false;instance.setting.show=false;
    if(!active&&restoreWebFullscreen){restoreWebFullscreen=false;instance.fullscreenWeb=false;document.documentElement.classList.remove('video-web-fullscreen');window.scrollTo({left:webScroll[0],top:webScroll[1],behavior:'instant'});}
    requestAnimationFrame(()=>playerElement.classList.remove('fullscreen-transfer'));
   });
   instance.on('destroy',()=>{playerElement.removeEventListener('click',enterNativeFullscreen,true);document.documentElement.classList.remove('video-web-fullscreen');});
   // A retained native host has no new fullscreenchange when its player is replaced.
   const retainedNativeHost=document.fullscreenElement||document.webkitFullscreenElement;
   if(!instance.isDestroy&&retainedNativeHost===next){
    playerElement.classList.add('art-fullscreen');
    instance.emit('fullscreen',true);
   }
   if(webFullscreen){instance.fullscreenWeb=true;document.documentElement.classList.add('video-web-fullscreen');}
   panel.addEventListener('keydown',event=>{
    event.stopPropagation();const summary=panel.querySelector('summary');
    if(event.key==='Escape'){event.preventDefault();panel.open=false;summary.focus();return;}
    if(event.key==='Tab'&&panel.open){
     const controls=[summary,...panel.querySelectorAll('button:not(:disabled):not([aria-hidden="true"]),input:not(:disabled)')],index=controls.indexOf(document.activeElement),target=index+(event.shiftKey?-1:1);
     if(index>=0&&target>=0&&target<controls.length){event.preventDefault();controls[target].focus();}
     else{event.preventDefault();summary.focus();panel.open=false;}
    }
   });
   function closeSpeed(){if(!panel.open)return;panel.open=false;instance.controls.show=true;panel.querySelector('summary').focus({preventScroll:true});}
   const outsideSpeed=event=>{if(!panel.open)return;if(ignoreRangeClick){ignoreRangeClick=false;return;}if(!panel.contains(event.target))closeSpeed();},escapeSpeed=event=>{if(panel.open&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeSpeed();}};
   document.addEventListener('click',outsideSpeed,true);document.addEventListener('keydown',escapeSpeed,true);
   const touchTicks=matchMedia('(pointer:coarse)'),syncTickTargets=()=>{for(const button of panel.querySelectorAll('[data-rate]')){button.tabIndex=touchTicks.matches?-1:0;if(touchTicks.matches)button.setAttribute('aria-hidden','true');else button.removeAttribute('aria-hidden');}};
   syncTickTargets();touchTicks.addEventListener('change',syncTickTargets);
   instance.on('destroy',()=>{document.removeEventListener('click',outsideSpeed,true);document.removeEventListener('keydown',escapeSpeed,true);document.removeEventListener('pointerdown',resetRangeClick,true);document.removeEventListener('pointerup',endRange,true);document.removeEventListener('pointercancel',endRange,true);touchTicks.removeEventListener('change',syncTickTargets);});
   slider.addEventListener('input',()=>updateRate(slider.value));
   syncRate();
   function endHold(seek=false){
    clearTimeout(holdTimer);holdTimer=null;
    if(holding){holding=false;syncRate();}
    else if(seek&&Number.isFinite(instance.duration))instance.currentTime=Math.min(instance.duration,instance.currentTime+5);
   }
   function startHold(event){
    if(event.key!=='ArrowRight'||event.altKey||event.ctrlKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||instance.setting?.show||document.querySelector('dialog[open]')||document.querySelector('.player-tool-panel:not([hidden])'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat||holdTimer)return;
    holdTimer=setTimeout(()=>{holding=true;syncRate();},400);
   }
   function releaseHold(event){if(event.key==='ArrowRight'&&holdTimer){event.preventDefault();event.stopImmediatePropagation();endHold(true);}}
   const blurHold=()=>endHold(false);
   document.addEventListener('keydown',startHold,true);document.addEventListener('keyup',releaseHold,true);window.addEventListener('blur',blurHold);
   instance.on('destroy',()=>{endHold();document.removeEventListener('keydown',startHold,true);document.removeEventListener('keyup',releaseHold,true);window.removeEventListener('blur',blurHold);});
   let advancing=false;
   const resetAdvance=()=>{advancing=false;instance.notice.show='切集失败，请重试';};
   document.addEventListener('playback-error',resetAdvance);
   instance.on('destroy',()=>document.removeEventListener('playback-error',resetAdvance));
   function advance(manual=false,trigger='autoplay'){
    if(instance.isDestroy||advancing||!(isSeries(film))||(!manual&&!load('autoplay',true)))return false;
    if(window.LivePlayback?.claimAdvance&&!LivePlayback.claimAdvance(media))return false;
    if(window.OpenStreamPlayerTools&&!OpenStreamPlayerTools.sleep.beforeAdvance(media,manual))return false;
    const state=episodeFor(film),target=window.OpenStreamEpisodes?OpenStreamEpisodes.nextOrdinal(film,state):state.episode+1;if(!target||target>film.episodes)return false;
    const metricStart=window.OpenStreamPlayback?.stamp();
    advancing=true;
    window.LivePlayback?.progress(instance.currentTime,instance.duration,film.id);
    state.episode=target;if(window.OpenStreamEpisodes)state.season=OpenStreamEpisodes.selection(film,state)?.season||1;window.LivePlayback?.continue(manual?'manual':trigger,metricStart);
    if(window.LivePlayback)render();
    else{
     const fragment=document.createRange().createContextualFragment(player(film));
     document.querySelector('.watch-side-column')?.replaceWith(fragment.querySelector('.watch-side-column'));
     mountedMedia=null;host=null;mount();
    }
    return true;
   }
   let restored=false;
   const restorePosition=()=>{
    const duration=instance.duration;
    if(restored||!Number.isFinite(duration)||duration<=0)return;
    restored=true;
    const keep=window.OpenStreamPlayerTools?.overrideFor(media);
    const intro=!keep?.intro&&skip.intro+(keep?.outro?0:skip.outro)<duration?skip.intro:0;
    const ratio=media?.resumeRatio;
    const comparable=!media?.resumeDuration||Math.abs(duration-media.resumeDuration)/media.resumeDuration<=.1;
    const position=Number.isFinite(ratio)&&comparable?duration*ratio:(media?.resume||0);
    const target=Math.max(intro,Math.min(position,duration-.5));
    if(target>0)instance.currentTime=target;
    syncRate();
    if(media?.switched)toast(comparable?'已切线 · 进度已对齐':'当前版本时长不同，已按观看时间续播');
    else if(position>0){
      toast('已续播至 '+playbackTime(target));
      const button=document.createElement('button');button.className='text-button';button.textContent='从头播放';
      button.onclick=()=>{instance.currentTime=0;window.LivePlayback?.progress(0,instance.duration,media.filmId);toast('已从头播放');};
      document.querySelector('#toast')?.append(' ',button);
      clearTimeout(toastTimer);toastTimer=setTimeout(()=>document.querySelector('#toast')?.classList.remove('visible'),5000);
    }
   };
   instance.on('video:loadedmetadata',restorePosition);
   instance.on('video:durationchange',restorePosition);
   instance.on('video:timeupdate',()=>{
    const duration=instance.duration;
    if(!Number.isFinite(duration)||duration<=0||instance.video.paused||!skip.outro)return;
    const keep=window.OpenStreamPlayerTools?.overrideFor(media);
    if(keep?.outro||(keep?.intro?0:skip.intro)+skip.outro>=duration||window.OpenStreamPlayerTools?.sleep.applies(media))return;
    if(window.OpenStreamPlayerTools?.sleep.blocked()){instance.pause();return;}
    if(instance.currentTime>=duration-skip.outro){if(!advance(false,'outro'))instance.pause();}
   });
   instance.on('video:ended',()=>{if(media)window.LivePlayback?.progress(instance.duration,instance.duration,media.filmId);if(window.OpenStreamPlayerTools?.sleep.ended(media)){instance.pause();return;}advance();});
   const stopFailedPlayback=event=>{if(event.detail?.filmId!==film.id||media!==window.LivePlayback?.current())return;instance.pause();hls?.stopLoad();instance.video.removeAttribute('src');instance.video.load();};
   document.addEventListener('playback-failed',stopFailedPlayback);instance.on('destroy',()=>document.removeEventListener('playback-failed',stopFailedPlayback));
   let recoveryPosition=null;
   instance.on('video:loadedmetadata',()=>{if(recoveryPosition===null||instance.isDestroy)return;const saved=recoveryPosition;recoveryPosition=null;instance.currentTime=Math.min(saved.position,Math.max(0,instance.duration-.5));syncRate();if(saved.playing&&!window.OpenStreamPlayerTools?.sleep.blocked())instance.play=true;});
   tools=window.OpenStreamPlayerTools?.attach({instance,host:next,film,media,skip:configuredSkip,onSkipChange(change){if(change?.origin!=='mark'&&['intro','outro'].includes(change?.which))skip[change.which]=configuredSkip[change.which];save(skipKey,configuredSkip);},cancelRecovery(){recoveryPosition=null;window.LivePlayback?.cancelRecovery(media);},recover(){
    if(instance.isDestroy||media!==window.LivePlayback?.current())return;
    recoveryPosition={position:instance.currentTime,playing:!instance.video.paused};session?.recovery();syncRate();
    try{if(hls)hls.startLoad(-1);else instance.video.load();if(recoveryPosition?.playing&&!window.OpenStreamPlayerTools?.sleep.blocked())instance.video.play()?.catch(()=>{});}catch{fail();}
   }});
  }catch{metric?.error('engine_load_failed');if(next.isConnected)next.innerHTML='<div class="watch-empty" role="alert">播放器加载失败，请刷新重试</div>';}
 }
 document.addEventListener('playback-ready',mount);
 new MutationObserver(mount).observe(document.querySelector('#main'),{childList:true});
 mount();
})();

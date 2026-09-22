(() => {
 let art=null;
 let host=null;
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
 async function mount(){
  const next=document.querySelector('#watch-player');
  if(next===host)return;
  if(art){art.destroy(false);art=null;}
  host=next;if(!host)return;
  try{
   await loadPlayer();if(host!==next||!next.isConnected)return;
   const film=films.find(f=>f.id===location.hash.split('/')[1]);
   const media=window.LivePlayback?.current();
   const mediaUrl=media?.url||'';
   const isHls=!!mediaUrl&&!/\.mp4(?:[?#]|$)/i.test(mediaUrl);
   if(isHls){
    try{await loadHls();}catch(error){
     if(!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'))throw error;
    }
    if(host!==next||!next.isConnected)return;
   }
   let hls=null,guard=null,recoveries=0,failed=false,nativePlayback=false,overlayNotice=null,overlayTimer;
   const reportHealth=health=>{if(media)document.dispatchEvent(new CustomEvent('playback-health',{detail:{filmId:media.filmId,lineKey:media.lineKey,health}}));};
   const fail=()=>{if(failed||media!==window.LivePlayback?.current())return;failed=true;reportHealth('slow');window.LivePlayback?.failed(media);};
   const skipKey='skip_'+film.id;
   const storedSkip=load(skipKey,{});
   const skip={intro:Math.min(300,Math.max(0,Number(storedSkip.intro)||0)),outro:Math.min(300,Math.max(0,Number(storedSkip.outro)||0))};
   const skipSetting=(key,label)=>({html:label,tooltip:skip[key]?skip[key]+' 秒':'关闭',range:[skip[key],0,300,5],onChange(item){skip[key]=Number(item.range[0]);save(skipKey,skip);return skip[key]?skip[key]+' 秒':'关闭';}});
   // Reparenting a native-fullscreen element exits fullscreen in Chromium.
   Artplayer.FULLSCREEN_WEB_IN_BODY=false;
   art=new Artplayer({container:next,url:mediaUrl,type:isHls?'m3u8':'',theme:'#ef692e',lang:'zh-cn',autoplay:!!media?.autoplay,
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
       if(recoveries++<1&&error.type===Hls.ErrorTypes.MEDIA_ERROR)hls.recoverMediaError();else fail();
      });
      hls.loadSource(url);hls.attachMedia(video);
     }else if(!startNative())next.innerHTML='<div class="watch-empty">当前浏览器不支持此视频格式</div>';
     }catch(error){if(!startNative())throw error;}
    }},
    volume:.8,setting:true,airplay:true,aspectRatio:true,pip:true,fullscreen:true,fullscreenWeb:true,playsInline:true,
    hotkey:true,fastForward:false,playbackRate:false,autoPlayback:false,
    settings:[...(isSeries(film)?[{html:'自动连播',switch:load('autoplay',true),onSwitch(item){const enabled=!item.switch;save('autoplay',enabled);document.querySelectorAll('#autoplay,[data-watch-autoplay]').forEach(el=>el.checked=enabled);return enabled;}}]:[]),skipSetting('intro','跳过片头'),skipSetting('outro','跳过片尾')],
    controls:[{name:'fine-speed',position:'right',html:'<details class="fine-speed"><summary aria-label="调整播放速度">1×</summary><div class="fine-speed-panel"><div class="fine-speed-heading"><span>播放速度</span><div class="rate-stepper"><button type="button" data-step="-0.05" aria-label="减慢 0.05 倍">−</button><output>1×</output><button type="button" data-step="0.05" aria-label="加快 0.05 倍">＋</button></div></div><input type="range" min="0.5" max="2" step="0.05" value="1" aria-label="播放速度" aria-valuetext="1 倍"><div class="fine-speed-presets">'+[.5,.75,1,1.25,1.5,1.75,2].map(n=>'<button type="button" style="--tick:'+((n-.5)/1.5*100)+'%" data-rate="'+n+'">'+n+'×</button>').join('')+'</div></div></details>'}],
    layers:mediaUrl?[]:[{name:'empty-media',html:'<div class="watch-empty"><span>暂未获取到播放地址</span><p>请选择其他线路，或返回影片详情</p></div>',style:{inset:'0',display:'grid',placeItems:'center',pointerEvents:'none'}}]
   });
   const instance=art;
   instance.on('destroy',()=>{clearTimeout(overlayTimer);overlayNotice?.remove();guard?.();hls?.destroy();});
   let progressAt=0;
   instance.on('video:timeupdate',()=>{if(media&&restored&&Date.now()-progressAt>5000&&!instance.video.paused){progressAt=Date.now();window.LivePlayback?.progress(instance.currentTime,instance.duration,media.filmId);}});
   instance.on('video:pause',()=>{if(media&&restored)window.LivePlayback?.progress(instance.currentTime,instance.duration,media.filmId);});
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
   function updateRate(value){
    const rate=Math.max(.5,Math.min(2,Math.round(Number(value)*20)/20));
    instance.playbackRate=rate;save('playbackRate',rate);
    slider.value=String(rate);slider.setAttribute('aria-valuetext',format(rate));
    slider.style.setProperty('--rate-fill',((rate-.5)/1.5*100)+'%');
    panel.querySelector('summary').textContent=format(rate);
    panel.querySelector('output').textContent=format(rate);
    panel.querySelector('[data-step="-0.05"]').disabled=rate<=.5;panel.querySelector('[data-step="0.05"]').disabled=rate>=2;
    panel.querySelectorAll('[data-rate]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.rate)===rate)));
   }
   panel.addEventListener('click',event=>{event.stopPropagation();instance.setting.show=false;const button=event.target.closest('[data-rate]');if(button)updateRate(button.dataset.rate);const step=event.target.closest('[data-step]');if(step)updateRate(Number(slider.value)+Number(step.dataset.step));});
   panel.addEventListener('toggle',()=>{if(panel.open)instance.setting.show=false;});
   instance.on('setting',visible=>{if(visible)panel.open=false;});
   const playerElement=instance.template.$player;
   let restoreWebFullscreen=false;
   let webScroll=[0,0];
   instance.on('fullscreenWeb',active=>{
    if(active)webScroll=[window.scrollX,window.scrollY];
    document.documentElement.classList.toggle('video-web-fullscreen',active);
    if(!active)window.scrollTo({left:webScroll[0],top:webScroll[1],behavior:'instant'});
   });
   const enterNativeFullscreen=event=>{
    if(!event.target.closest('.art-control-fullscreen')||!instance.fullscreenWeb||!playerElement.requestFullscreen)return;
    event.preventDefault();event.stopImmediatePropagation();
    restoreWebFullscreen=true;
    playerElement.classList.add('fullscreen-transfer');
    playerElement.requestFullscreen().catch(()=>{
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
   panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){panel.open=false;panel.querySelector('summary').focus();}});
   panel.addEventListener('focusout',event=>{if(!panel.contains(event.relatedTarget))panel.open=false;});
   slider.addEventListener('input',()=>updateRate(slider.value));
   updateRate(Number(load('playbackRate',1))||1);
   let holdTimer=null,holding=false,heldRate=1;
   function endHold(seek=false){
    clearTimeout(holdTimer);holdTimer=null;
    if(holding){instance.playbackRate=heldRate;holding=false;}
    else if(seek&&Number.isFinite(instance.duration))instance.currentTime=Math.min(instance.duration,instance.currentTime+5);
   }
   function startHold(event){
    if(event.key!=='ArrowRight'||event.altKey||event.ctrlKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||document.querySelector('dialog[open]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat||holdTimer)return;
    heldRate=instance.playbackRate;
    holdTimer=setTimeout(()=>{holding=true;instance.playbackRate=2;},400);
   }
   function releaseHold(event){if(event.key==='ArrowRight'&&holdTimer){event.preventDefault();event.stopImmediatePropagation();endHold(true);}}
   const blurHold=()=>endHold(false);
   document.addEventListener('keydown',startHold,true);document.addEventListener('keyup',releaseHold,true);window.addEventListener('blur',blurHold);
   instance.on('destroy',()=>{endHold();document.removeEventListener('keydown',startHold,true);document.removeEventListener('keyup',releaseHold,true);window.removeEventListener('blur',blurHold);});
   let advancing=false;
   function advance(){
    if(advancing||!(isSeries(film))||!load('autoplay',true))return false;
    const state=episodeFor(film);if(state.episode>=film.episodes)return false;
    advancing=true;state.episode++;window.LivePlayback?.continue();render();return true;
   }
   let restored=false;
   const restorePosition=()=>{
    const duration=instance.duration;
    if(restored||!Number.isFinite(duration)||duration<=0)return;
    restored=true;
    const intro=skip.intro+skip.outro<duration?skip.intro:0;
    const ratio=media?.resumeRatio;
    const position=Number.isFinite(ratio)?duration*ratio:(media?.resume||0);
    const target=Math.max(intro,Math.min(position,duration-.5));
    if(target>0)instance.currentTime=target;
    instance.playbackRate=Number(load('playbackRate',1))||1;
    if(media?.switched)toast('已切线 · 进度已对齐');
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
    if(!Number.isFinite(duration)||duration<=0||instance.video.paused||!skip.outro||skip.intro+skip.outro>=duration)return;
    if(instance.currentTime>=duration-skip.outro){if(!advance())instance.pause();}
   });
   instance.on('video:ended',()=>{if(media)window.LivePlayback?.progress(instance.duration,instance.duration,media.filmId);advance();});
  }catch{if(next.isConnected)next.innerHTML='<div class="watch-empty" role="alert">播放器加载失败，请刷新重试</div>';}
 }
 new MutationObserver(mount).observe(document.querySelector('#main'),{childList:true});
 mount();
})();

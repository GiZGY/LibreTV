(() => {
 const samples=[],mediaSessions=new WeakMap(),LIMIT=20,VERIFY_MS=2000,MAX_TICK_GAP=2000;
 let active=null,pendingIntent=null;
 const clock=()=>performance.now(),ms=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):0;
 const engine=()=>/Edg\//.test(navigator.userAgent)?'Edge':/Chrome\//.test(navigator.userAgent)?'Chromium':/Safari\//.test(navigator.userAgent)?'WebKit':'other';
 const version=()=>[...document.scripts].map(script=>script.src).join(' ').match(/static\/([a-f0-9]{16})\//)?.[1]||'development';
 const stages={render:'renderMs',access:'accessMs',source:'sourceMs',address:'addressMs',engine:'engineMs',media:'mediaLoadMs'};
 function createSession({now=clock,transition='open',trigger='open',expectedKey=null,startedAt=null}={}){
  active?.dispose('superseded');
  const created=now(),start=Number.isFinite(startedAt)&&startedAt>=0&&startedAt<=created?startedAt:created;let disposed=false,stage='render',stageAt=start,waitingAt=null,hidden=false,last=null,windowSample=null,recovering=trigger==='recovery',expected=expectedKey,bound=null,isCurrent=()=>true,accessDepth=0,resumeStage=null;const accessPromises=new WeakSet();
  const state={version:version(),browser:engine(),transition:['open','episode','line','recovery'].includes(transition)?transition:'open',trigger:['open','manual','autoplay','outro','recovery'].includes(trigger)?trigger:'open',stage:'loading',outcome:'pending',renderMs:0,accessMs:0,sourceMs:0,addressMs:0,engineMs:0,mediaLoadMs:0,firstFrameMs:null,playingMs:0,waitingMs:0,waitingCount:0,recoveryCount:recovering?1:0,recoverySuccessCount:0,progressSamples:0,rateMismatchSamples:0,identityVerified:false,rateVerified:false,verifiedRate:null,selectedRate:1,effectiveRate:1,actualRate:1,defaultRate:1,errorCode:null};
  const current=observation=>!disposed&&(!bound||isCurrent(bound))&&(!observation?.media||observation.media===bound)&&(!expected||!observation?.episodeKey||observation.episodeKey===expected);
  const stopWaiting=()=>{if(waitingAt!==null){state.waitingMs+=now()-waitingAt;waitingAt=null;}};
  const resetWindow=()=>{last=null;windowSample=null;};
  const finishStage=()=>{if(stage){state[stages[stage]]+=Math.max(0,now()-stageAt);stageAt=now();}};
  const guarded=fn=>(...args)=>{if(current())return fn(...args);};
  const session={
   segment:guarded(name=>{if(!stages[name]||state.firstFrameMs!==null)return;if(accessDepth&&name!=='access'){resumeStage=name;return;}finishStage();stage=name;stageAt=now();}),
   observeAccess:guarded(promise=>{if(!promise||typeof promise.then!=='function'||accessPromises.has(promise)||state.firstFrameMs!==null)return;accessPromises.add(promise);if(accessDepth++===0){resumeStage=stage;session.segment('access');}const finish=()=>{if(--accessDepth===0&&!disposed){const name=resumeStage;resumeStage=null;session.segment(name||'render');}};promise.then(finish,finish);}),
   expect:guarded(key=>{if(expected===null&&typeof key==='string')expected=key;}),
   bindMedia(media,key,check=()=>true){if(disposed||!media||typeof media!=='object')return;bound=media;isCurrent=check;if(expected===null&&typeof key==='string')expected=key;mediaSessions.set(media,session);},
   phase:guarded(phase=>{if(!['loading','playing','waiting','paused','seeking','ended','failed'].includes(phase))return;if(['paused','seeking','ended','failed'].includes(phase)){stopWaiting();resetWindow();}state.stage=phase;}),
   frame(observation){if(!current(observation)||hidden||state.firstFrameMs!==null)return;finishStage();stage=null;state.firstFrameMs=ms(now()-start);},
   rates:guarded((selected,effective,actual,defaultRate)=>{const before=[state.selectedRate,state.effectiveRate].join('|');for(const[key,value]of Object.entries({selectedRate:selected,effectiveRate:effective,actualRate:actual,defaultRate}))if(Number.isFinite(value)&&value>=.25&&value<=4)state[key]=value;if(before!==[state.selectedRate,state.effectiveRate].join('|')){resetWindow();state.rateVerified=false;}}),
   waiting:guarded(()=>{resetWindow();if(!hidden&&waitingAt===null){waitingAt=now();state.waitingCount++;}state.stage='waiting';}),
   playing:guarded(()=>{stopWaiting();resetWindow();state.stage='playing';}),
   visibility:guarded(value=>{if(hidden===!!value)return;hidden=!!value;stopWaiting();resetWindow();if(!hidden&&state.stage==='waiting')waitingAt=now();}),
   tick(time,observation={}){
    if(!current(observation))return;
    const stamp=now(),blocked=observation.paused||observation.seeking||observation.hidden||hidden;
    if(blocked||!Number.isFinite(time)){resetWindow();return;}
    if(Number.isFinite(observation.actualRate))state.actualRate=observation.actualRate;
    if(Number.isFinite(observation.defaultRate))state.defaultRate=observation.defaultRate;
    const previous=last;last={at:stamp,time};
    if(!previous)return;
    const elapsed=stamp-previous.at,delta=time-previous.time;
    // Suspended tabs and discontinuous seeks do not become wall-time playback samples.
    if(elapsed<=0||elapsed>MAX_TICK_GAP||delta<=0||delta/(elapsed/1000)>4.5){windowSample=null;return;}
    stopWaiting();state.playingMs+=elapsed;state.progressSamples++;state.stage='playing';session.frame(observation);
    const identity=!!bound&&observation.media===bound&&typeof expected==='string'&&observation.episodeKey===expected;
    state.identityVerified=identity;
    const same=(a,b)=>Math.abs(a-b)<.015,temporary=!same(state.effectiveRate,state.selectedRate);
    const aligned=same(state.actualRate,state.effectiveRate)&&same(state.defaultRate,state.selectedRate);
    if(!identity||!aligned){if(!aligned)state.rateMismatchSamples++;state.rateVerified=false;windowSample=null;return;}
    // Temporary acceleration is legitimate, but it cannot certify ordinary-speed continuity.
    if(temporary){windowSample=null;return;}
    if(!windowSample)windowSample={at:previous.at,time:previous.time};
    const duration=stamp-windowSample.at;if(duration<VERIFY_MS)return;
    const measured=(time-windowSample.time)/(duration/1000),tolerance=Math.max(.1,state.selectedRate*.1);
    state.verifiedRate=Number(measured.toFixed(3));state.rateVerified=Math.abs(measured-state.selectedRate)<=tolerance;
    if(state.rateVerified){state.outcome='success';if(recovering){state.recoverySuccessCount++;recovering=false;}}
    else state.rateMismatchSamples++;
    windowSample={at:stamp,time};
   },
   recovery:guarded(()=>{state.recoveryCount++;recovering=true;resetWindow();}),
   error:guarded(code=>{state.errorCode=/^[a-zA-Z0-9_-]{1,64}$/.test(String(code))?String(code):'playback_error';if(state.outcome!=='success')state.outcome='failed';session.phase('failed');finishStage();stage=null;}),
   cancel(reason='cancelled'){if(disposed)return;if(state.outcome!=='success'&&state.outcome!=='failed')state.outcome='aborted';session.dispose(reason);},
   snapshot(){const wait=state.waitingMs+(waitingAt===null?0:now()-waitingAt),timing={};if(stage)timing[stages[stage]]=ms(state[stages[stage]]+now()-stageAt);return{...state,...timing,resolveMs:ms((timing.sourceMs??state.sourceMs)+(timing.addressMs??state.addressMs)),playingMs:ms(state.playingMs),waitingMs:ms(wait),bufferingRatio:wait/(state.playingMs+wait||1)};},
   dispose(reason='ended'){if(disposed)return;if(state.outcome==='pending')state.outcome=['superseded','cancelled','aborted'].includes(reason)?'aborted':'failed';stopWaiting();finishStage();stage=null;samples.push(session.snapshot());while(samples.length>=LIMIT)samples.shift();disposed=true;if(active===session)active=null;if(pendingIntent===session)pendingIntent=null;if(bound)mediaSessions.delete(bound);}
  };
  active=session;return session;
 }
 function intent(options){const session=createSession(options);pendingIntent=session;return session;}
 function takeIntent(options){const session=pendingIntent;pendingIntent=null;return session||createSession(options);}
 function diagnostic(){
  const current=active?.snapshot()||null,all=[...samples,current].filter(Boolean),transitions=all.filter(sample=>sample.transition!=='open'),frames=all.filter(sample=>sample.firstFrameMs!==null).map(sample=>sample.firstFrameMs).sort((a,b)=>a-b),sum=key=>all.reduce((count,sample)=>count+sample[key],0),count=(list,outcome)=>list.filter(sample=>sample.outcome===outcome).length;
  const successes=count(transitions,'success'),failures=count(transitions,'failed'),recoveryAttempts=sum('recoveryCount'),recoverySuccesses=sum('recoverySuccessCount');
  return{schema:1,current,recent:samples.slice(-3),summary:{sessions:all.length,manualLineChanges:all.filter(sample=>sample.transition==='line'&&sample.trigger==='manual').length,transitionAttempts:transitions.length,transitionSuccesses:successes,transitionFailures:failures,transitionAborted:count(transitions,'aborted'),transitionPending:count(transitions,'pending'),transitionSuccessRate:successes+failures?successes/(successes+failures):null,recoveryAttempts,recoverySuccesses,recoverySuccessRate:recoveryAttempts?recoverySuccesses/recoveryAttempts:null,firstFrameP50:frames.length?frames[Math.ceil(frames.length*.5)-1]:null,firstFrameP95:frames.length?frames[Math.ceil(frames.length*.95)-1]:null}};
 }
 async function copy(){const value=JSON.stringify(diagnostic(),null,2),status=document.querySelector('[data-diagnostics-status]');const report=message=>{if(status)status.textContent=message;else toast(message);};try{await navigator.clipboard.writeText(value);report('诊断信息已复制');}catch{report('复制未完成，请允许剪贴板访问后重试');}}
 window.OpenStreamPlayback={createSession,intent,takeIntent,stamp:clock,observeAccess:promise=>active?.observeAccess(promise),forMedia:media=>media&&mediaSessions.get(media),diagnostic,copy};
 document.addEventListener('click',event=>{if(event.target.closest('[data-copy-diagnostics]'))void copy();});
})();

(() => {
 const samples=[];
 let active=null;
 const engine=()=>/Edg\//.test(navigator.userAgent)?'Edge':/Chrome\//.test(navigator.userAgent)?'Chromium':/Safari\//.test(navigator.userAgent)?'WebKit':'other';
 const version=()=>[...document.scripts].map(s=>s.src).join(' ').match(/static\/([a-f0-9]{16})\//)?.[1]||'development';
 function createSession({now=()=>performance.now(),resolveMs=0,sourceMs=0,accessMs=0,addressMs=0,transition='open',trigger='open'}={}){
  const start=now();let disposed=false,lastTime=null,lastTick=null,waitingAt=null,recovering=false;
  const ms=n=>Number.isFinite(n)?Math.max(0,Math.round(n)):0;
  const state={version:version(),browser:engine(),transition:['open','episode','line','recovery'].includes(transition)?transition:'open',trigger:['open','manual','autoplay','outro','recovery'].includes(trigger)?trigger:'open',stage:'loading',resolveMs:ms(resolveMs),sourceMs:ms(sourceMs),accessMs:ms(accessMs),addressMs:ms(addressMs),firstFrameMs:null,playingMs:0,waitingMs:0,waitingCount:0,recoveryCount:0,recoverySuccessCount:0,progressSamples:0,selectedRate:1,effectiveRate:1,actualRate:1,defaultRate:1,errorCode:null};
  const stopWaiting=()=>{if(waitingAt!==null){state.waitingMs+=now()-waitingAt;waitingAt=null;}};
  const live=fn=>(...args)=>{if(!disposed)fn(...args);};
  const session={
   phase:live(phase=>{if(['loading','playing','waiting','paused','seeking','ended','failed'].includes(phase)){if(['paused','seeking','ended','failed'].includes(phase)){stopWaiting();lastTime=null;}state.stage=phase;}}),
   frame:live(()=>{if(state.firstFrameMs===null)state.firstFrameMs=Math.round(now()-start+state.resolveMs+state.accessMs);}),
   rates:live((selected,effective,actual,defaultRate)=>{for(const [key,value]of Object.entries({selectedRate:selected,effectiveRate:effective,actualRate:actual,defaultRate}))if(Number.isFinite(value)&&value>=.25&&value<=4)state[key]=value;}),
   waiting:live(()=>{if(waitingAt===null){waitingAt=now();state.waitingCount++;}state.stage='waiting';}),
   playing:live(()=>{if(waitingAt!==null){state.waitingMs+=now()-waitingAt;waitingAt=null;}state.stage='playing';lastTick=now();lastTime=null;}),
   tick:live((time,{paused=false,seeking=false,hidden=false}={})=>{const stamp=now();if(!paused&&!seeking&&!hidden&&lastTime!==null&&time>lastTime){state.playingMs+=Math.max(0,stamp-lastTick);state.progressSamples++;if(recovering){state.recoverySuccessCount++;recovering=false;}session.frame();}lastTick=stamp;lastTime=time;}),
   recovery:live(()=>{state.recoveryCount++;recovering=true;lastTime=null;}),
   error:live(code=>{state.errorCode=/^[a-zA-Z0-9_-]{1,64}$/.test(String(code))?String(code):'playback_error';session.phase('failed');}),
   snapshot(){const wait=state.waitingMs+(waitingAt===null?0:now()-waitingAt);return{...state,playingMs:Math.round(state.playingMs),waitingMs:Math.round(wait),bufferingRatio:wait/(state.playingMs+wait||1)};},
   dispose(){if(disposed)return;const final=session.snapshot();samples.push(final);if(samples.length>20)samples.shift();disposed=true;if(active===session)active=null;}
  };active=session;return session;
 }
 function diagnostic(){const current=active?.snapshot()||null,all=[...samples,current].filter(Boolean),transitions=all.filter(s=>s.transition!=='open'),recoveries=all.reduce((n,s)=>n+s.recoveryCount,0),frames=[...samples,current].filter(s=>s?.firstFrameMs!==null&&s?.firstFrameMs!==undefined).map(s=>s.firstFrameMs).sort((a,b)=>a-b);return{schema:1,current,recent:samples.slice(-3),summary:{sessions:all.length,manualLineChanges:all.filter(s=>s.transition==='line'&&s.trigger==='manual').length,transitionAttempts:transitions.length,transitionSuccesses:transitions.filter(s=>s.progressSamples>0).length,recoveryAttempts:recoveries,recoverySuccesses:all.reduce((n,s)=>n+s.recoverySuccessCount,0),firstFrameP50:frames.length?frames[Math.ceil(frames.length*.5)-1]:null,firstFrameP95:frames.length?frames[Math.ceil(frames.length*.95)-1]:null}};}
 async function copy(){const value=JSON.stringify(diagnostic(),null,2);try{await navigator.clipboard.writeText(value);toast('诊断信息已复制');}catch{toast('复制未完成，请允许剪贴板访问后重试');}}
 window.OpenStreamPlayback={createSession,diagnostic,copy};
 document.addEventListener('click',event=>{if(event.target.closest('[data-copy-diagnostics]'))void copy();});
})();

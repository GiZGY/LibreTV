(() => {
 'use strict';
 const STORAGE='openstream_device_sync_v1',RECOVERY='openstream_sync_recovery_pending';
 const local=()=>window.OpenStreamLocalData,stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const token=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
 const id=()=>crypto.randomUUID(),tag=(bucket,key)=>bucket+'|'+key;
 let saved;try{saved=JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{}
 let state=saved&&(/^[\w-]{43}$/.test(saved.credential||'')||saved.pendingAuth||saved.pendingJoinRequest||saved.pendingInvite)?{...saved,known:saved.known||{},dirty:saved.dirty||{},conflicts:saved.conflicts||{},observed:saved.observed||{},inflight:saved.inflight||{},sessions:{}}:{enabled:false,approved:false,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{}};
 let dialog,opener,busy=false,running=null,scheduled,scheduledAt=0,pollTimer,invite=state.pendingInvite||null,joinTicket=state.pendingJoinRequest?{id:state.pendingJoinRequest.id,secret:state.pendingJoinRequest.secret}:null,recoveryCode=null,generation=0,message='',errorMessage=false,available=null,qrPromise;
 try{recoveryCode=sessionStorage.getItem(RECOVERY);}catch{}
 const playingId=()=>/^#player\//.test(location.hash)?location.hash.split('/')[1]:null;
 function persist(){try{const {sessions,...data}=state;localStorage.setItem(STORAGE,JSON.stringify(data));return true;}catch{message='浏览器保存空间不足，请先导出备份';errorMessage=true;return false;}}
 function persistRequired(){if(!persist())throw Error('浏览器暂时无法保存设备凭据，请腾出空间后重试');}
 function portableFilm(f){const result={id:f.id,name:f.name};for(const k of ['en','type','genre','catalogProvider'])if(typeof f[k]==='string')result[k]=f[k].slice(0,160);for(const k of ['year','episodes','seasons'])if(f[k]!==undefined&&Number.isSafeInteger(Number(f[k]))&&Number(f[k])>=0)result[k]=Number(f[k]);if(f.catalogId!==undefined&&/^(?:(?:movie|tv):)?\d{1,12}$/.test(String(f.catalogId)))result.catalogId=String(f.catalogId);return result;}
 function mapLocal(){
  const data=local()?.snapshot().data;if(!data)return{};
  const films=new Map(data.films.map(f=>[f.id,portableFilm(f)])),records={};
  for(const key of data.favorites){const film=films.get(key),p=data.progress[key],series=film&&!['电影','纪录片'].includes(film.type)&&film.episodes>1,completed=p&&(p.completed||p.duration>0&&p.position/p.duration>=.99)&&(!series||(p.episode||1)>=film.episodes),status=data.watchlist[key]?.status||(completed?'completed':p?'watching':'planned');if(film)records[tag('favorite',key)]={bucket:'favorite',key,value:{film,status,updatedAt:data.watchlist[key]?.updatedAt||new Date(0).toISOString()}};}
  for(const key of data.history){const film=films.get(key),p=data.progress[key];if(film&&p)records[tag('progress',key)]={bucket:'progress',key,value:{film,progress:{position:p.position,duration:p.duration,season:p.season,episode:p.episode,watchedAt:p.watchedAt,completed:p.completed===true,totalEpisodes:p.totalEpisodes,...(p.episodeKey?{episodeKey:p.episodeKey}:{}),...(p.completedEpisodes?{completedEpisodes:[...new Set(p.completedEpisodes)].sort()}: {})}}};}
  for(const [key,value]of Object.entries(data.skip))records[tag('skip',key)]={bucket:'skip',key,value};
  if(state.syncPreferences)records[tag('preferences','selected')]={bucket:'preferences',key:'selected',value:data.preferences};
  return records;
 }
 function capture({seed=false}={}){
  if(!state.credential||!state.approved||!local())return;
  try{
  const records=mapLocal(),keys=new Set([...Object.keys(state.observed),...Object.keys(records)]);
  for(const key of keys){
   if(key.startsWith('preferences|')&&!state.syncPreferences)continue;
   const current=records[key],fingerprint=current?stable(current.value):null;
   if(!seed&&state.observed[key]===fingerprint)continue;
   if(seed&&!current)continue;
   const known=state.known[key];
   if(current&&known&&!known.deleted&&stable(known.value)===fingerprint||!current&&known?.deleted){delete state.dirty[key];delete state.conflicts[key];}
   else{
    const [bucket,recordKey]=key.split('|'),before=state.dirty[key];
    state.dirty[key]={bucket,key:recordKey,value:current?.value||null,deleted:!current,baseVersion:before?.baseVersion??known?.version??0,requestId:id()};
    if(state.conflicts[key])state.conflicts[key].local=state.dirty[key];
   }
  }
  state.observed=Object.fromEntries(Object.entries(records).map(([key,value])=>[key,stable(value.value)]));return persist();
  }catch(error){setMessage(userError(error),true);return false;}
 }
 async function api(action,data={},credential=state.credential){
  const request=()=>fetch('/api/sync/device',{method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),body:JSON.stringify({action,...data})});
  let response=await request();
  if(response.status===428&&window.HumanAccess){await response.body?.cancel();await HumanAccess.ensure(true);response=await request();}
  let result;try{result=await response.json();}catch{throw Error('同步响应未完成，请重试；本机数据已保留');}
  if(!response.ok){const error=Error(result.message||'同步暂时不可用，本机数据已保留');error.status=response.status;error.code=result.code;throw error;}
  const valid=({create:()=>typeof result.deviceId==='string',recover:()=>typeof result.deviceId==='string',join:()=>typeof result.approved==='boolean'&&typeof result.deviceId==='string',status:()=>typeof result.approved==='boolean'&&typeof result.deviceId==='string',invite:()=>typeof result.id==='string'&&Number.isFinite(Date.parse(result.expiresAt)),pairing:()=>['waiting','claimed','approved','cancelled','expired'].includes(result.state),confirm:()=>result.approved===true,cancel:()=>result.cancelled===true,withdraw:()=>result.withdrawn===true,devices:()=>typeof result.current==='string'&&Array.isArray(result.devices),revoke:()=>result.revoked===true,close:()=>result.closed===true,pull:()=>Array.isArray(result.records),write:()=>result.conflict===true||Number.isSafeInteger(result.record?.version),claim:()=>result.conflict===true||Number.isSafeInteger(result.record?.version)})[action];
  if(!result||!valid?.())throw Error('同步响应未完成，请重试；本机数据已保留');
  return result;
 }
 function applyRecords(records){
  if(!local())return;
  const backup=local().snapshot(),before=stable(backup.data),data=backup.data,films=new Map(data.films.map(f=>[f.id,f]));
  for(const record of records){
   const key=tag(record.bucket,record.key);if(state.dirty[key]||state.conflicts[key])continue;
   const {bucket,value,deleted}=record,k=record.key;
   if(value?.film)films.set(k,{...films.get(k),...value.film});
   if(bucket==='favorite'){
    if(deleted){data.favorites=data.favorites.filter(id=>id!==k);delete data.watchlist[k];}
    else{if(!data.favorites.includes(k))data.favorites.push(k);data.watchlist[k]={status:value.status,updatedAt:value.updatedAt||record.updatedAt};}
   }else if(bucket==='progress'){
    if(deleted){data.history=data.history.filter(id=>id!==k);delete data.progress[k];}
    else{if(!data.history.includes(k))data.history.unshift(k);data.progress[k]=value.progress;}
   }else if(bucket==='skip'){if(deleted)delete data.skip[k];else data.skip[k]=value;}
   else if(bucket==='preferences'&&state.syncPreferences&&!deleted)Object.assign(data.preferences,value);
  }
  data.films=[...films.values()];data.history.sort((a,b)=>Date.parse(data.progress[b]?.watchedAt||0)-Date.parse(data.progress[a]?.watchedAt||0));
  if(before!==stable(data))local().applyBackup(backup,{mode:'replace',fromSync:true});
  state.observed=Object.fromEntries(Object.entries(mapLocal()).map(([key,value])=>[key,stable(value.value)]));persist();
 }
 function markConflict(key,operation,remote){state.conflicts[key]={local:operation,remote};delete state.sessions[operation.key];persist();}
 function finishOperation(key,sent,result){
  if(result.conflict)markConflict(key,state.dirty[key]||sent,result.current);
  else{
   state.known[key]=result.record;
   if(sent.bucket==='progress'&&!sent.deleted){
    const current=state.sessions[sent.key];
    if(!current||current.id===sent.sessionId)state.sessions[sent.key]={id:sent.sessionId,claimed:true,version:result.record.version,sequence:sent.sequence||0};
   }
   if(state.dirty[key]?.requestId===sent.requestId)delete state.dirty[key];else if(state.dirty[key])state.dirty[key].baseVersion=result.record.version;
  }
  delete state.inflight[key];persist();
 }
 async function sendOperation(key,sent,epoch){
  state.inflight[key]=sent;persistRequired();const result=await api(sent.action,sent);
  if(epoch!==generation||!state.enabled)return false;
  finishOperation(key,sent,result);return true;
 }
 async function sync(){
  if(running)return running;if(!state.enabled||!state.approved||!state.credential||!local())return;
  const epoch=generation;
  running=(async()=>{
   if(!capture())return;
   for(const[key,sent]of Object.entries(state.inflight)){if(!await sendOperation(key,sent,epoch))return;}
   const pull=await api('pull');if(epoch!==generation||!state.enabled)return;
   for(const record of pull.records){
    const key=tag(record.bucket,record.key),known=state.known[key],active=state.sessions[record.key];
    if(record.bucket==='progress'&&playingId()===record.key&&active?.claimed&&record.sessionId!==active.id&&record.version>(known?.version||0)&&!state.conflicts[key])markConflict(key,state.dirty[key]||{...mapLocal()[key],baseVersion:known?.version||0,requestId:id()},record);
    state.known[key]=record;
   }
   applyRecords(pull.records);
   let processed=0;
   for(const key of Object.keys(state.dirty)){
    if(epoch!==generation||!state.enabled)break;
    if(state.conflicts[key])continue;
    const operation=state.dirty[key];if(!operation)continue;
    let sent={...operation,action:'write'};
    if(operation.bucket==='progress'&&!operation.deleted){
     let session=state.sessions[operation.key];
     if(!session)session=state.sessions[operation.key]={id:id(),claimed:false,sequence:0};
     sent={...operation,action:session.claimed?'write':'claim',baseVersion:session.claimed?session.version:operation.baseVersion,sessionId:session.id,sequence:session.claimed?++session.sequence:0};
    }
    if(!await sendOperation(key,sent,epoch))return;
    persist();if(++processed>=20)break;
   }
   const pending=Object.keys(state.dirty).filter(key=>!state.conflicts[key]).length,conflicts=Object.keys(state.conflicts).length;
   message=conflicts?`${conflicts} 项记录需要确认`:pending?`还有 ${pending} 项记录等待同步`:'已同步';errorMessage=false;
   if(pending)schedule(15000);
  })().catch(error=>{
   if(epoch!==generation)return;
   message=userError(error);errorMessage=true;
   if(error.code==='device_unauthorized'){state.enabled=false;state.approved=false;}
   persist();
  }).finally(()=>{running=null;if(epoch!==generation&&state.enabled)schedule(100);renderStatus();if(dialog?.open&&!busy&&!invite&&!joinTicket)render();});
  return running;
 }
 function schedule(delay=2500){if(!state.enabled||!state.approved)return;const deadline=Date.now()+delay;if(scheduled&&scheduledAt<=deadline)return;clearTimeout(scheduled);scheduledAt=deadline;scheduled=setTimeout(()=>{scheduled=null;if(!document.hidden)void sync();},delay);}
 function userError(error){return error instanceof TypeError||error instanceof SyntaxError?'连接未完成，请重试；本机数据已保留':error?.name==='NotAllowedError'?'复制未完成，请允许剪贴板访问后重试':error?.name==='TimeoutError'||error?.name==='AbortError'?'连接超时，请重试；本机数据已保留':error?.message||'操作未完成，请重试';}
 function setMessage(text,error=false){message=text;errorMessage=error;renderStatus();}
 function renderStatus(){const target=dialog?.querySelector('[data-sync-status]');if(target){target.textContent=message;target.setAttribute('role',errorMessage?'alert':'status');}}
 async function loadQr(){
  if(window.qrcode)return;
  await(qrPromise||=(new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='libs/qrcode-generator-1.4.4.min.js';script.onload=resolve;script.onerror=()=>{qrPromise=null;reject(Error('二维码暂时未生成，请复制邀请链接'));};document.head.append(script);})));
 }
 function pairUrl(){return location.origin+location.pathname+'#sync-pair/'+invite.id+'.'+invite.secret;}
 async function drawQr(){
  if(!invite||!dialog?.open)return;
  try{await loadQr();const target=dialog.querySelector('[data-sync-qr]');if(!target||!invite)return;const code=qrcode(0,'M');code.addData(pairUrl());code.make();const count=code.getModuleCount(),canvas=document.createElement('canvas');canvas.width=canvas.height=(count+8)*4;canvas.className='sync-qr';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','设备配对二维码，五分钟内有效');const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#000';for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(code.isDark(y,x))context.fillRect((x+4)*4,(y+4)*4,4,4);target.replaceChildren(canvas);}catch{setMessage('二维码暂时未生成，请复制邀请链接',true);}
 }
 function parseTicket(value){
  let ticket=String(value||'').trim();try{ticket=new URL(ticket).hash.replace(/^#sync-pair\//,'');}catch{ticket=ticket.replace(/^#sync-pair\//,'');}
  const match=/^([\da-f-]{36})\.([\w-]{43})$/i.exec(ticket);if(!match)throw Error('请粘贴完整的配对邀请');return{id:match[1],secret:match[2]};
 }
 function fields(){return `<label for="sync-device-name">此设备名称</label><input id="sync-device-name" maxlength="40" autocomplete="off" value="${escape(state.name||'我的设备')}">`;}
 function conflictsMarkup(){return Object.entries(state.conflicts).map(([key,conflict])=>{
  const value=conflict.local?.value||conflict.remote?.value,film=value?.film?.name||'播放偏好',labels={favorite:'收藏分类',progress:'观看进度',skip:'跳过设置',preferences:'播放偏好'};
  const position=entry=>entry?.deleted?'已移除':entry?.value?.progress?`第 ${entry.value.progress.episode} 集 · ${Math.floor(entry.value.progress.position/60)}:${String(Math.floor(entry.value.progress.position%60)).padStart(2,'0')}`:entry?.value?.status?({watching:'在追',planned:'想看',completed:'已看完'}[entry.value.status]):'已修改';
  return `<section class="sync-conflict"><b>${escape(film)} · ${labels[conflict.local?.bucket]||'记录'}</b><p>此设备：${position(conflict.local)}<br>同步记录：${position(conflict.remote)}</p><div class="sync-actions"><button class="secondary" data-sync="local" data-key="${escape(key)}">保留此设备</button><button class="secondary" data-sync="remote" data-key="${escape(key)}">使用同步记录</button></div></section>`;
 }).join('');}
 function render(){
  if(!dialog)return;
  const head=`<div class="modal-head"><h2 id="sync-heading">设备同步</h2><button class="icon-button" data-sync="close" aria-label="关闭设备同步">×</button></div>`,status='<div class="sync-status" data-sync-status role="status" aria-live="polite"></div>';
  let body='';
  if(available===false)body='<p>设备同步暂未开放。收藏和观看进度仍保存在此设备，可在“数据备份”中导出。</p><button class="secondary" data-sync="retry-availability">重新检查</button>';
  else if(state.pending&&state.credential&&!state.approved)body=`<p>请在原设备确认此设备，核对两边的数字是否相同。</p><p class="sync-code">${escape(state.matchCode||'等待连接')}</p><p>配对邀请五分钟后失效。</p><button class="secondary" data-sync="cancel-join">取消加入</button>`;
  else if(joinTicket&&!state.approved)body=`<p>加入后，此设备将同步收藏和观看进度。原设备确认后才会开始。</p>${fields()}<div class="sync-actions"><button class="primary" data-sync="join">请求加入</button><button class="secondary" data-sync="cancel-join">取消</button></div>`;
  else if(!state.credential||!state.approved)body=`<p>无需账号。收藏和观看进度默认只保存在此设备；开启后，可通过配对在其他设备继续观看。</p>${fields()}<div class="sync-actions"><button class="primary" data-sync="create">开启同步</button></div><hr class="sync-divider"><label for="sync-invitation">已有设备的邀请</label><input id="sync-invitation" autocomplete="off" spellcheck="false" placeholder="粘贴配对链接"><div class="sync-actions"><button class="secondary" data-sync="prepare-join">加入已有设备</button></div><details ${state.pendingAuth?.action==='recover'?'open':''}><summary>使用恢复码</summary><p>恢复后，原有设备将全部退出，需要重新配对。</p><label for="sync-recovery-input">恢复码</label><input id="sync-recovery-input" type="password" autocomplete="off"><button class="secondary" data-sync="recover">恢复同步数据</button></details>`;
  else if(invite)body=`<p>${invite.state==='claimed'?`“${escape(invite.deviceName)}”正在请求加入。请确认新设备显示相同的核对码。`:'在另一台设备扫描二维码，或复制邀请链接。链接五分钟内有效，仅使用一次。'}</p>${invite.state==='claimed'?`<p class="sync-code">${escape(invite.matchCode)}</p><div class="sync-actions"><button class="primary" data-sync="confirm">确认此设备加入</button></div>`:'<div data-sync-qr></div><label for="sync-invite-link">配对邀请</label><input id="sync-invite-link" data-sync-invite-link readonly value="'+escape(pairUrl())+'"><div class="sync-actions"><button class="secondary" data-sync="copy-invite">复制邀请链接</button></div>'}<div class="sync-actions"><button class="secondary" data-sync="cancel-invite">取消邀请</button></div>`;
  else body=`<p>已配对。每台设备独立授权，可随时移除。</p>${recoveryCode?'<section><h3>保存恢复码</h3><p>浏览器数据被清除且其他设备都遗失时，需要用它恢复。普通备份不包含恢复码。</p><div class="sync-actions"><button class="secondary" data-sync="copy-recovery">复制恢复码</button><button class="secondary" data-sync="reveal-recovery">显示恢复码</button></div><div data-recovery></div><button class="text-button" data-sync="saved-recovery">我已妥善保存</button></section>':''}<label class="sync-option"><input type="checkbox" data-sync="enabled" ${state.enabled?'checked':''}>自动同步</label><label class="sync-option"><input type="checkbox" data-sync="preferences" ${state.syncPreferences?'checked':''}>同时同步倍速、连播与外观偏好</label><div class="sync-actions"><button class="primary" data-sync="sync">立即同步</button><button class="secondary" data-sync="invite">添加设备</button></div>${Object.keys(state.conflicts).length?'<h3>确认不同的记录</h3>'+conflictsMarkup():''}<h3>已配对设备</h3><ul class="sync-device-list" data-sync-devices><li>正在读取…</li></ul><hr class="sync-divider"><div class="sync-actions"><button class="text-button" data-sync="leave">解除此设备配对</button><button class="text-button" data-sync="delete">删除全部同步数据</button></div><p class="sync-secondary-copy">停止同步、解除配对或删除全部同步数据均保留此设备的收藏和观看进度。</p>`;
  const expanded=[...dialog.querySelectorAll('details')].map(item=>item.open);
  const active=dialog.contains(document.activeElement)?document.activeElement:null,focused=active?.dataset.sync,focusedId=active?.id;
  const inputs=new Map([...dialog.querySelectorAll('input[id]:not([type=checkbox])')].map(input=>[input.id,{value:input.value,start:input.selectionStart,end:input.selectionEnd}]));
  dialog.innerHTML=head+body+status;renderStatus();if(busy)dialog.querySelectorAll('button:not([data-sync=close]),input').forEach(el=>el.disabled=true);
  [...dialog.querySelectorAll('details')].forEach((item,index)=>{if(expanded[index])item.open=true;});
  for(const[key,input]of inputs){const target=dialog.querySelector('#'+key);if(target){target.value=input.value;try{target.setSelectionRange(input.start,input.end);}catch{}}}
  if(focusedId)dialog.querySelector('#'+focusedId)?.focus({preventScroll:true});
  else if(focused)dialog.querySelector(`[data-sync="${focused}"]`)?.focus({preventScroll:true});
  if(invite?.state!=='claimed'&&invite)void drawQr();
  if(state.approved&&!invite&&available!==false)void renderDevices();
 }
 async function renderDevices(){
  try{const result=await api('devices');const target=dialog?.querySelector('[data-sync-devices]');if(!target)return;target.innerHTML=result.devices.map(device=>`<li><span>${escape(device.name)}${device.id===result.current?'<small>此设备</small>':''}</span>${device.id===result.current?'':`<button class="text-button" data-sync="revoke" data-id="${escape(device.id)}">移除</button>`}</li>`).join('');}catch(error){const target=dialog?.querySelector('[data-sync-devices]');if(target)target.innerHTML='<li>暂未读取设备，请稍后重试</li>';}
 }
 async function checkAvailability(){try{const response=await fetch('/api/sync/device',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error();const result=await response.json();available=result.enabled===true;}catch{available=null;setMessage('连接未完成，请重试；本机数据不受影响',true);}}
 async function open(trigger){
  opener=trigger||document.activeElement;
  if(!dialog){dialog=document.createElement('dialog');dialog.className='device-sync-dialog';dialog.setAttribute('aria-labelledby','sync-heading');document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});dialog.addEventListener('close',()=>{clearTimeout(pollTimer);opener?.focus?.({preventScroll:true});});dialog.addEventListener('click',click);dialog.addEventListener('change',change);}
  render();if(!dialog.open)dialog.showModal();await checkAvailability();render();if(invite||state.pending&&state.credential&&!state.approved)poll();
 }
 function rememberRecovery(value){recoveryCode=value;try{sessionStorage.setItem(RECOVERY,value);}catch{}}
 async function authorize(action){
  let pending=state.pendingAuth;
  if(pending&&pending.action!==action||state.pendingJoinRequest)throw Error('上一次连接尚未完成，请先重试该操作');
  if(!pending||pending.action!==action){
   const name=dialog.querySelector('#sync-device-name')?.value.trim()||state.name||'我的设备';
   pending={action,name,credential:token(),recoveryCode:token()};
   if(action==='recover'){const old=dialog.querySelector('#sync-recovery-input').value.trim();if(!/^[\w-]{43}$/.test(old))throw Error('恢复码格式不正确');pending.oldRecoveryCode=old;}
   state.pendingAuth=pending;persistRequired();
  }
  const {name,credential,recoveryCode:recovery}=pending;
  try{if(action==='recover')await api('recover',{name,credential,recoveryCode:pending.oldRecoveryCode,newRecoveryCode:recovery},null);
  else await api('create',{name,credential,recoveryCode:recovery},null);}
  catch(error){if([400,403,410].includes(error.status)){delete state.pendingAuth;persist();}throw error;}
  state={name,credential,approved:true,enabled:true,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{}};rememberRecovery(recovery);capture({seed:true});persist();setMessage('已开启同步');await sync();
 }
 async function requestJoin(){
  if(state.pendingAuth)throw Error('上一次连接尚未完成，请先重试该操作');
  if(!joinTicket)throw Error('请重新打开邀请');
  if(!state.pendingJoinRequest||state.pendingJoinRequest.id!==joinTicket.id||state.pendingJoinRequest.secret!==joinTicket.secret)state.pendingJoinRequest={...joinTicket,name:dialog.querySelector('#sync-device-name')?.value.trim()||'我的设备',credential:token()};
  persistRequired();const {name,credential}=state.pendingJoinRequest;
  let result;try{result=await api('join',state.pendingJoinRequest,null);}catch(error){if([400,410].includes(error.status)){delete state.pendingJoinRequest;persist();}throw error;}
  state={name,credential,approved:result.approved,enabled:false,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{},matchCode:result.matchCode,pending:!result.approved};persist();
  if(result.approved){state.enabled=true;joinTicket=null;capture({seed:true});await sync();}else poll();
 }
 function poll(){
  clearTimeout(pollTimer);if(!dialog?.open||document.hidden||!(invite||state.pending))return;
  pollTimer=setTimeout(async()=>{
   try{
    if(invite){if(!invite.expiresAt){const created=await api('invite',invite);invite={...invite,...created};state.pendingInvite=invite;persist();}const result=await api('pairing',{id:invite.id});if(!dialog?.open)return;if(result.state==='approved'){invite=null;delete state.pendingInvite;persist();setMessage('新设备已加入');render();return;}if(['expired','cancelled'].includes(result.state)){invite=null;delete state.pendingInvite;persist();setMessage('邀请已过期或取消，请重新添加设备',true);render();return;}if(invite.state!==result.state){invite={...invite,...result};state.pendingInvite=invite;persist();render();}}
    else if(state.pending&&state.credential&&!state.approved){const result=await api('status');if(result.approved){state.approved=true;state.enabled=true;joinTicket=null;delete state.matchCode;delete state.pending;capture({seed:true});persist();setMessage('配对成功');render();await sync();return;}}
    else return;
   }catch(error){setMessage(userError(error),true);if([401,410].includes(error.status)){if(!state.approved){state={enabled:false,approved:false,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{}};persist();}invite=null;joinTicket=null;render();return;}}
   poll();
  },2500);
 }
 async function click(event){
  const button=event.target.closest('[data-sync]');if(!button||button.tagName!=='BUTTON')return;const action=button.dataset.sync;
  if(action==='close'){dialog.close();return;}if(busy)return;
  if(action==='reveal-recovery'){const target=dialog.querySelector('[data-recovery]');if(target&&recoveryCode){target.className='sync-recovery';target.textContent=recoveryCode;button.textContent='恢复码已显示';}return;}
  busy=true;button.disabled=true;try{
   if(action==='create'||action==='recover')await authorize(action);
   else if(action==='retry-availability')await checkAvailability();
   else if(action==='prepare-join'){joinTicket=parseTicket(dialog.querySelector('#sync-invitation').value);message='';}
   else if(action==='join')await requestJoin();
   else if(action==='cancel-join'){if(state.pending&&state.credential)await api('withdraw');else if(state.pendingJoinRequest)await api('withdraw',{},state.pendingJoinRequest.credential);joinTicket=null;if(!state.approved&&!state.pendingAuth){state={enabled:false,approved:false,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{}};persist();}}
   else if(action==='invite'){const fresh=state.pendingInvite||{id:id(),secret:token(),state:'waiting'};state.pendingInvite=fresh;invite=fresh;persistRequired();poll();const result=await api('invite',fresh);invite={...fresh,...result};state.pendingInvite=invite;persist();message='';}
   else if(action==='copy-invite'){await navigator.clipboard.writeText(pairUrl());setMessage('邀请链接已复制');}
   else if(action==='cancel-invite'){await api('cancel',{id:invite.id});invite=null;delete state.pendingInvite;persist();clearTimeout(pollTimer);setMessage('邀请已取消');}
   else if(action==='confirm'){await api('confirm',{id:invite.id,joinId:invite.joinId,matchCode:invite.matchCode});invite=null;delete state.pendingInvite;persist();delete state.pendingInvite;persist();setMessage('新设备已加入');}
   else if(action==='sync'){if(!state.enabled)throw Error('请先开启自动同步');await sync();}
   else if(action==='copy-recovery'){if(recoveryCode){await navigator.clipboard.writeText(recoveryCode);setMessage('恢复码已复制，请保存在其他位置');}}
   else if(action==='saved-recovery'){recoveryCode=null;try{sessionStorage.removeItem(RECOVERY);}catch{}}
   else if(action==='revoke'){if(confirm('移除此设备？移除后需重新配对才能读取同步数据。')){await api('revoke',{id:button.dataset.id});setMessage('设备已移除');}}
   else if(action==='leave'){if(confirm('解除此设备配对？此设备的收藏和进度将保留。')){await api('revoke',{id:(await api('devices')).current});reset();setMessage('已解除配对，本机数据已保留');}}
   else if(action==='delete'){if(confirm('删除全部同步数据并解除所有设备的配对？此设备的收藏和进度将保留。')){await api('close',{confirm:true});reset();setMessage('同步数据已删除，本机数据已保留');}}
   else if(action==='remote'||action==='local'){
    const key=button.dataset.key,conflict=state.conflicts[key];if(!conflict)return;
    if(conflict.local?.bucket==='progress'){const completed=[...new Set([...(conflict.local.value?.progress?.completedEpisodes||[]),...(conflict.remote?.value?.progress?.completedEpisodes||[])])].sort().slice(0,1000);for(const entry of [conflict.local,conflict.remote])if(entry?.value?.progress)entry.value.progress.completedEpisodes=completed;}
    if(action==='remote'){
     if(playingId()===conflict.local.key){document.querySelector('#watch-player video')?.pause();location.hash='detail/'+conflict.local.key;}
     delete state.dirty[key];delete state.conflicts[key];delete state.sessions[conflict.local.key];if(conflict.remote){state.known[key]=conflict.remote;applyRecords([conflict.remote]);}
    }else{state.dirty[key]={...conflict.local,baseVersion:conflict.remote?.version||0,requestId:id()};delete state.conflicts[key];delete state.sessions[conflict.local.key];persist();await sync();}
    setMessage('已采用所选记录');persist();
   }
  }catch(error){setMessage(userError(error),true);}
  finally{busy=false;render();}
 }
 function reset(){generation++;clearTimeout(scheduled);scheduled=null;clearTimeout(pollTimer);invite=joinTicket=null;state={enabled:false,approved:false,syncPreferences:false,known:{},dirty:{},conflicts:{},observed:{},inflight:{},sessions:{}};localStorage.removeItem(STORAGE);try{sessionStorage.removeItem(RECOVERY);}catch{}recoveryCode=null;}
 function change(event){
  const action=event.target.dataset.sync;
  if(action==='enabled'){state.enabled=event.target.checked;generation++;persist();if(state.enabled){capture();schedule(100);}else{clearTimeout(scheduled);scheduled=null;setMessage('自动同步已暂停，本机数据继续保存');}}
  if(action==='preferences'){state.syncPreferences=event.target.checked;if(!state.syncPreferences){delete state.dirty[tag('preferences','selected')];delete state.conflicts[tag('preferences','selected')];}capture();persist();schedule();}
 }
 function route(){
  if(location.hash.startsWith('#sync-pair/')){try{if(state.approved){setMessage('此设备已配对，请在未配对的新设备打开邀请',true);}else joinTicket=parseTicket(location.hash);window.history.replaceState(null,'',location.pathname+location.search+'#home');void open();}catch(error){setMessage(userError(error),true);void open();}}
  const filmId=playingId();if(filmId&&state.approved)state.sessions[filmId]={id:id(),claimed:false,sequence:0};
 }
 document.addEventListener('openstream:data-change',event=>{
  const key=event.detail?.key;
  if(key&&!['all','favorites','history','historyMetadataV2','filmRecords','watchlist','autoplay','motion','darkMode','mobileAutoTheme','playbackRate'].includes(key)&&!key.startsWith('skip_'))return;
  if(capture()&&Object.keys(state.dirty).some(key=>!state.conflicts[key]))schedule(playingId()?30000:2500);
 });
 document.addEventListener('pause',event=>{if(event.target.tagName==='VIDEO'&&playingId())schedule(500);},true);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){schedule(500);if(dialog?.open&&(invite||state.pending))poll();}else{clearTimeout(scheduled);scheduled=null;clearTimeout(pollTimer);}});
 window.addEventListener('focus',()=>schedule(500));
 window.addEventListener('hashchange',()=>schedule(500));
 window.addEventListener('online',()=>schedule(500));window.addEventListener('hashchange',route);
 window.addEventListener('pageshow',event=>{if(event.persisted){schedule(500);if(dialog?.open&&(invite||state.pending))poll();}});
 window.addEventListener('pagehide',()=>{clearTimeout(scheduled);scheduled=null;clearTimeout(pollTimer);});
 document.addEventListener('click',event=>{const trigger=event.target.closest('[data-device-sync]');if(trigger)void open(trigger);});
 function mountEntry(){const settings=document.querySelector('#settings');if(!settings||settings.querySelector('[data-device-sync]'))return;const row=document.createElement('div');row.className='setting-row';row.innerHTML='<div><b>设备同步</b><p>无需账号，在已配对的设备间续播</p></div><button class="secondary sync-entry" data-device-sync>管理设备</button>';const reference=settings.querySelector('.settings-sources');if(reference)reference.before(row);else settings.append(row);}
 mountEntry();route();if(state.credential&&state.approved){capture();schedule(1500);}
 window.OpenStreamDeviceSync={open,sync,get status(){return{enabled:state.enabled,approved:state.approved,pending:Object.keys(state.dirty).length,conflicts:Object.keys(state.conflicts).length};}};
})();

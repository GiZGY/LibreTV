import {test,expect} from '@playwright/test';
import {startDeviceSyncAcceptance} from '../../scripts/device-sync-acceptance.mjs';
let fixture;
const origin='http://127.0.0.1:18450';
const storagePrefix='openstream_live_';
async function mute(context){await context.addInitScript(()=>{const silence=()=>document.querySelectorAll('video').forEach(video=>{video.muted=true;video.volume=0;});new MutationObserver(silence).observe(document,{subtree:true,childList:true});silence();});}
async function openSync(page){await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('button',{name:'管理设备',exact:true}).click();await expect(page.locator('.device-sync-dialog')).toBeVisible();}
async function localData(page,change){await page.evaluate(change=>{const backup=OpenStreamLocalData.snapshot();for(const[k,v]of Object.entries(change))backup.data[k]=v;OpenStreamLocalData.applyBackup(backup,{mode:'replace'});},change);}
const film={id:'film-syncshow',name:'配对验收剧',type:'电视剧',year:2025,episodes:8,seasons:1,catalogProvider:'tmdb',catalogId:'tv:321'};
const progress={position:12,duration:60,season:1,episode:2,totalEpisodes:8,completed:false,watchedAt:'2026-11-06T01:00:00.000Z'};
test.beforeAll(async()=>{fixture=await startDeviceSyncAcceptance();});
test.afterAll(async()=>{await fixture?.close();});

test('two independent devices explicitly pair, continue progress, resolve offline conflict and revoke',async({browser})=>{
 test.setTimeout(90000);
 const a=await browser.newContext(),b=await browser.newContext();await mute(a);await mute(b);
 const pageA=await a.newPage(),pageB=await b.newPage();
 try{
  await pageA.addInitScript(({prefix,film,progress})=>{localStorage.setItem(prefix+'filmRecords',JSON.stringify([film,{...film,id:'film-planned',name:'未开始的收藏'}]));localStorage.setItem(prefix+'favorites',JSON.stringify([film.id,'film-planned']));localStorage.setItem(prefix+'history',JSON.stringify([film.id]));localStorage.setItem(prefix+'historyMetadataV2',JSON.stringify({[film.id]:progress}));},{prefix:storagePrefix,film,progress});
  await pageA.goto(origin);await openSync(pageA);await pageA.locator('#sync-device-name').fill('电脑');await pageA.getByRole('button',{name:'开启同步',exact:true}).click();
  await expect(pageA.getByRole('button',{name:'添加设备',exact:true})).toBeVisible();
  await expect.poll(()=>pageA.evaluate(()=>OpenStreamDeviceSync.status.pending)).toBe(0);
  await pageA.getByRole('button',{name:'添加设备',exact:true}).click();await expect(pageA.locator('.sync-qr')).toBeVisible();
  const ticket=await pageA.locator('[data-sync-invite-link]').inputValue();expect(ticket).toContain('#sync-pair/');
  await pageB.goto(ticket);await expect(pageB.getByRole('button',{name:'请求加入',exact:true})).toBeVisible();await pageB.locator('#sync-device-name').fill('平板');await pageB.getByRole('button',{name:'请求加入',exact:true}).click();
  await expect(pageB.locator('.sync-code')).toBeVisible();await expect(pageA.locator('.sync-code')).toBeVisible();expect(await pageB.locator('.sync-code').textContent()).toBe(await pageA.locator('.sync-code').textContent());
  const denied=await pageB.evaluate(async()=>{const state=JSON.parse(localStorage.getItem('openstream_device_sync_v1'));return(await fetch('/api/sync/device',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.credential},body:JSON.stringify({action:'pull'})})).status;});expect(denied).toBe(401);
  await pageA.getByRole('button',{name:'确认此设备加入',exact:true}).click();await expect(pageB.getByRole('button',{name:'立即同步',exact:true})).toBeVisible();
  await expect.poll(()=>pageB.evaluate(()=>OpenStreamLocalData.snapshot().data.progress['film-syncshow']?.position)).toBe(12);
  expect(await pageB.evaluate(()=>OpenStreamLocalData.snapshot().data.favorites)).toContain('film-syncshow');
  expect(await pageB.evaluate(()=>OpenStreamLocalData.snapshot().data.watchlist['film-planned'].status)).toBe('planned');expect(await pageB.evaluate(()=>OpenStreamLocalData.snapshot().data.films.find(f=>f.id==='film-syncshow').catalogId)).toBe('tv:321');
  await localData(pageB,{progress:{[film.id]:{...progress,position:25,watchedAt:'2026-11-06T02:00:00.000Z'}}});await pageB.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>pageB.evaluate(()=>OpenStreamDeviceSync.status.pending)).toBe(0);
  await pageA.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>pageA.evaluate(()=>OpenStreamLocalData.snapshot().data.progress['film-syncshow']?.position)).toBe(25);
  // A committed response can be lost; a later local update must retry the same frozen operation first.
  let lost=true;await pageB.route('**/api/sync/device',async route=>{const body=route.request().postDataJSON();if(lost&&route.request().method()==='POST'&&body.action==='write'&&body.bucket==='progress'){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await localData(pageB,{progress:{[film.id]:{...progress,position:28,watchedAt:'2026-11-06T02:10:00.000Z'}}});await pageB.getByRole('button',{name:'立即同步',exact:true}).click();
  await expect.poll(()=>pageB.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('openstream_device_sync_v1')).inflight||{}).length)).toBe(1);
  await localData(pageB,{progress:{[film.id]:{...progress,position:29,watchedAt:'2026-11-06T02:20:00.000Z'}}});await pageB.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>pageB.evaluate(()=>OpenStreamDeviceSync.status.pending)).toBe(0);
  expect(await pageB.evaluate(()=>OpenStreamDeviceSync.status.conflicts)).toBe(0);await pageB.unroute('**/api/sync/device');
  await pageA.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>pageA.evaluate(()=>OpenStreamLocalData.snapshot().data.progress['film-syncshow']?.position)).toBe(29);
  // Pause A's network synchronization, then move both devices from the same baseline.
  await pageA.locator('[data-sync=enabled]').uncheck();await localData(pageA,{progress:{[film.id]:{...progress,position:40,watchedAt:'2026-11-06T04:00:00.000Z'}}});
  await localData(pageB,{progress:{[film.id]:{...progress,position:30,watchedAt:'2026-11-06T03:00:00.000Z'}}});await pageB.getByRole('button',{name:'立即同步',exact:true}).click();
  await pageA.locator('[data-sync=enabled]').check();await pageA.getByRole('button',{name:'立即同步',exact:true}).click();await expect(pageA.getByRole('button',{name:'使用同步记录',exact:true})).toBeVisible();
  await pageA.getByRole('button',{name:'使用同步记录',exact:true}).click();await expect.poll(()=>pageA.evaluate(()=>OpenStreamLocalData.snapshot().data.progress['film-syncshow']?.position)).toBe(30);
  expect(await pageA.evaluate(()=>OpenStreamDeviceSync.status.conflicts)).toBe(0);
  pageA.once('dialog',dialog=>dialog.accept());await pageA.locator('[data-sync=revoke]').click();await pageB.getByRole('button',{name:'立即同步',exact:true}).click();
  await expect.poll(()=>pageB.evaluate(()=>OpenStreamDeviceSync.status.approved)).toBe(false);expect(await pageB.evaluate(()=>OpenStreamLocalData.snapshot().data.progress['film-syncshow'].position)).toBe(30);
 }finally{await a.close();await b.close();}
});


test('create, invitation and join survive a lost response and reload without orphan authorization',async({browser})=>{
 test.setTimeout(90000);const a=await browser.newContext(),b=await browser.newContext();await mute(a);await mute(b);const pageA=await a.newPage(),pageB=await b.newPage();
 try{
  const before=(await fixture.query('SELECT count(*)::int AS n FROM openstream_sync.spaces'))[0].n;
  const dropped=new Set();await pageA.route('**/api/sync/device',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const body=route.request().postDataJSON();if(['create','invite'].includes(body.action)&&!dropped.has(body.action)){dropped.add(body.action);await route.fetch();if(body.action==='create')await route.fulfill({status:200,contentType:'application/json',body:'{truncated'});else await route.abort('failed');}else await route.continue();});
  await pageA.goto(origin);await openSync(pageA);await pageA.getByRole('button',{name:'开启同步',exact:true}).click();await expect.poll(()=>pageA.evaluate(()=>!!JSON.parse(localStorage.getItem('openstream_device_sync_v1'))?.pendingAuth)).toBe(true);
  await pageA.reload();await openSync(pageA);await pageA.getByRole('button',{name:'开启同步',exact:true}).click();await expect(pageA.getByRole('button',{name:'添加设备',exact:true})).toBeVisible();
  expect((await fixture.query('SELECT count(*)::int AS n FROM openstream_sync.spaces'))[0].n-before).toBe(1);
  await pageA.getByRole('button',{name:'添加设备',exact:true}).click();await expect(pageA.locator('.sync-qr')).toBeVisible();await pageA.reload();await openSync(pageA);await expect(pageA.locator('.sync-qr')).toBeVisible();
  const ticket=await pageA.locator('[data-sync-invite-link]').inputValue();
  let lost=true;await pageB.route('**/api/sync/device',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='join'&&lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await pageB.goto(ticket);await pageB.getByRole('button',{name:'请求加入',exact:true}).click();await expect.poll(()=>pageB.evaluate(()=>!!JSON.parse(localStorage.getItem('openstream_device_sync_v1'))?.pendingJoinRequest)).toBe(true);
  await pageB.reload();await openSync(pageB);await pageB.getByRole('button',{name:'请求加入',exact:true}).click();await expect(pageB.locator('.sync-code')).toBeVisible();await expect(pageA.locator('.sync-code')).toBeVisible();
  await pageA.getByRole('button',{name:'确认此设备加入',exact:true}).click();await expect(pageB.getByRole('button',{name:'立即同步',exact:true})).toBeVisible();
  expect(await pageB.evaluate(()=>OpenStreamDeviceSync.status.approved)).toBe(true);
 }finally{await a.close();await b.close();}
});

test('credential storage failure sends no authorization request; delayed settings keep typed input',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844}});await mute(context);const page=await context.newPage();
 try{
  let creates=0;await page.route('**/api/sync/device',async route=>{if(route.request().method()==='GET')await new Promise(resolve=>setTimeout(resolve,400));else if(route.request().postDataJSON().action==='create')creates++;await route.continue();});
  await page.goto(origin);await openSync(page);await page.locator('#sync-device-name').fill('窄屏设备');await page.waitForTimeout(600);await expect(page.locator('#sync-device-name')).toHaveValue('窄屏设备');
  await page.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='openstream_device_sync_v1')throw new DOMException('quota','QuotaExceededError');return write.call(this,key,value);};});
  await page.getByRole('button',{name:'开启同步',exact:true}).click();await expect(page.locator('[data-sync-status]')).toContainText('保存设备凭据');expect(creates).toBe(0);
  expect(await page.locator('.device-sync-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.getByRole('button',{name:'关闭设备同步',exact:true}).click();await expect(page.getByRole('button',{name:'管理设备',exact:true})).toBeFocused();
 }finally{await context.close();}
});

test('an invalid local snapshot keeps initialization, device controls and local records intact',async({browser})=>{
 const context=await browser.newContext();await mute(context);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
 try{
  await page.goto(origin);await openSync(page);await page.getByRole('button',{name:'开启同步',exact:true}).click();await expect(page.getByRole('button',{name:'添加设备',exact:true})).toBeVisible();
  await page.addInitScript(()=>{const records=Array.from({length:501},(_,index)=>({id:'film-too'+index,name:'本机收藏 '+index,episodes:1,seasons:1}));localStorage.setItem('openstream_live_filmRecords',JSON.stringify(records));localStorage.setItem('openstream_live_favorites',JSON.stringify(records.map(f=>f.id)));});
  let dataRequests=0;await page.route('**/api/sync/device',async route=>{if(route.request().method()==='POST'&&['pull','write','claim'].includes(route.request().postDataJSON().action))dataRequests++;await route.continue();});
  await page.reload();await openSync(page);await expect(page.locator('[data-sync-status]')).toContainText('500');await page.waitForTimeout(1700);expect(dataRequests).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>favorites.size)).toBe(501);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'解除此设备配对',exact:true}).click();await expect(page.getByRole('button',{name:'开启同步',exact:true})).toBeVisible();expect(await page.evaluate(()=>favorites.size)).toBe(501);
 }finally{await context.close();}
});

test('dialog recomposes in light/dark, reduced motion and unavailable states without overflow',async({browser},testInfo)=>{
 const context=await browser.newContext({reducedMotion:'reduce'});await mute(context);await context.addInitScript(()=>localStorage.setItem('openstream_live_mobileAutoTheme','false'));const page=await context.newPage();
 try{
  await page.goto(origin);await openSync(page);
  for(const width of [1440,834,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>{save('darkMode',false);document.documentElement.dataset.theme='light';});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
   expect(await page.locator('.device-sync-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   const tiny=await page.locator('.device-sync-dialog').evaluate(el=>[...el.querySelectorAll('button,input:not([type=checkbox]),summary')].filter(item=>{const rect=item.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.height<43.5;}).map(item=>item.tagName));expect(tiny).toEqual([]);
   if(width===1440||width===390)await page.locator('.device-sync-dialog').screenshot({path:testInfo.outputPath('sync-'+width+'-light.png')});
   await page.evaluate(()=>{save('darkMode',true);document.documentElement.dataset.theme='dark';});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');expect(await page.locator('.device-sync-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   if(width===390)await page.locator('.device-sync-dialog').screenshot({path:testInfo.outputPath('sync-mobile-dark.png')});
  }
  await page.getByRole('button',{name:'关闭设备同步',exact:true}).click();await page.route('**/api/sync/device',async route=>{if(route.request().method()==='GET')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})});else await route.continue();});
  await page.getByRole('button',{name:'管理设备',exact:true}).click();await expect(page.locator('.device-sync-dialog')).toContainText('设备同步暂未开放');await expect(page.getByRole('button',{name:'重新检查',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.device-sync-dialog')).not.toBeVisible();await expect(page.getByRole('button',{name:'管理设备',exact:true})).toBeFocused();
 }finally{await context.close();}
});

test('invalid recovery code can be corrected; committed recovery survives a lost response and revokes old devices',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();await mute(a);await mute(b);const owner=await a.newPage(),replacement=await b.newPage();
 try{
  await owner.goto(origin);await openSync(owner);await owner.getByRole('button',{name:'开启同步',exact:true}).click();await expect(owner.getByRole('button',{name:'添加设备',exact:true})).toBeVisible();
  const recovery=await owner.evaluate(()=>sessionStorage.getItem('openstream_sync_recovery_pending'));
  await replacement.goto(origin);await openSync(replacement);await replacement.getByText('使用恢复码',{exact:true}).click();await replacement.locator('#sync-recovery-input').fill('a'.repeat(43));await replacement.getByRole('button',{name:'恢复同步数据',exact:true}).click();await expect(replacement.locator('[data-sync-status]')).toContainText('恢复码无效');
  expect(await replacement.evaluate(()=>!!JSON.parse(localStorage.getItem('openstream_device_sync_v1'))?.pendingAuth)).toBe(false);
  let lost=true;await replacement.route('**/api/sync/device',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='recover'&&lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await replacement.locator('#sync-recovery-input').fill(recovery);await replacement.getByRole('button',{name:'恢复同步数据',exact:true}).click();await expect.poll(()=>replacement.evaluate(()=>!!JSON.parse(localStorage.getItem('openstream_device_sync_v1'))?.pendingAuth)).toBe(true);
  await replacement.reload();await openSync(replacement);await replacement.getByRole('button',{name:'恢复同步数据',exact:true}).click();await expect(replacement.getByRole('button',{name:'添加设备',exact:true})).toBeVisible();expect(await replacement.evaluate(()=>OpenStreamDeviceSync.status.approved)).toBe(true);
  await owner.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>owner.evaluate(()=>OpenStreamDeviceSync.status.approved)).toBe(false);
 }finally{await a.close();await b.close();}
});

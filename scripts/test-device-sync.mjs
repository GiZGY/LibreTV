import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createDeviceSyncStore,syncRecordValue} from '../server/device-sync.mjs';
import {createDeviceSyncHandler} from '../api/sync/device.mjs';

const db=new PGlite(),query=async(sql,args=[])=>(await db.query(sql,args)).rows;
let clock=Date.now();const now=()=>clock;
const schema=await readFile(new URL('../server/device-sync-schema.sql',import.meta.url),'utf8');
await db.exec('CREATE TABLE catalog_sentinel(id integer PRIMARY KEY, payload text);INSERT INTO catalog_sentinel VALUES(1,\'untouched\')');
await db.exec(schema);await db.exec(schema);
const store=createDeviceSyncStore({query,now});
const secret=()=>randomBytes(32).toString('base64url');
const device=()=>({name:'测试设备',credential:secret(),recoveryCode:secret()});
const film={id:'film-123',name:'测试剧',year:2025,episodes:8,seasons:1};
const favorite={film,status:'watching',updatedAt:new Date(clock).toISOString()};
const progress=(position=10)=>({film,progress:{position,duration:60,episode:2,season:1,watchedAt:new Date(clock).toISOString(),totalEpisodes:8}});
const change=(bucket,value,extra={})=>({bucket,key:film.id,value,requestId:randomUUID(),baseVersion:0,...extra});
test.after(()=>db.close());

async function paired(){
  const owner=device();await store.create(owner);
  const invite={id:randomUUID(),secret:secret()};await store.invite(owner.credential,invite);
  const second={...invite,credential:secret(),name:'第二台设备'};
  const joined=await store.join(second);const pending=await store.pairing(owner.credential,invite.id);
  assert.equal(pending.joinId,joined.deviceId);assert.equal(pending.matchCode,joined.matchCode);
  await store.confirm(owner.credential,{id:invite.id,joinId:pending.joinId,matchCode:pending.matchCode});
  return {owner,second};
}

test('private migration is repeatable and does not touch catalogue data',async()=>{
  assert.deepEqual(await query('SELECT * FROM catalog_sentinel'),[{id:1,payload:'untouched'}]);
  assert.equal((await query("SELECT has_schema_privilege('public','openstream_sync','USAGE') AS allowed"))[0].allowed,false);
  assert.equal((await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='openstream_sync'"))[0].n,8);
});

test('no-account create is idempotent; unapproved devices cannot read; explicit owner match required',async()=>{
  const owner=device(),created=await store.create(owner);assert.equal((await store.create(owner)).deviceId,created.deviceId);
  const invite={id:randomUUID(),secret:secret()};await store.invite(owner.credential,invite);
  const second={...invite,credential:secret(),name:'客厅平板'};
  const joined=await store.join(second);assert.equal(joined.approved,false);
  assert.equal((await store.join(second)).deviceId,joined.deviceId);
  await assert.rejects(store.pull(second.credential),{status:401});
  const pending=await store.pairing(owner.credential,invite.id);
  await assert.rejects(store.confirm(owner.credential,{id:invite.id,joinId:pending.joinId,matchCode:'000000'===pending.matchCode?'111111':'000000'}),{status:409});
  await store.confirm(owner.credential,{id:invite.id,joinId:pending.joinId,matchCode:pending.matchCode});
  await store.confirm(owner.credential,{id:invite.id,joinId:pending.joinId,matchCode:pending.matchCode});
  assert.equal((await store.status(second.credential)).approved,true);
  assert.equal((await store.devices(owner.credential)).devices.length,2);
  await assert.rejects(store.join({...invite,credential:secret(),name:'不明设备'}),{status:410});
});

test('expired/cancelled invitations cannot authorize, and unrelated devices cannot approve',async()=>{
  const owner=device();await store.create(owner);const outsider=device();await store.create(outsider);
  let invite={id:randomUUID(),secret:secret()};await store.invite(owner.credential,invite);
  let second={...invite,credential:secret(),name:'待定设备'};await store.join(second);
  await assert.rejects(store.pairing(outsider.credential,invite.id),{status:404});
  await store.cancel(owner.credential,invite.id);await assert.rejects(store.status(second.credential),{status:401});
  invite={id:randomUUID(),secret:secret()};await store.invite(owner.credential,invite);clock+=300001;
  await assert.rejects(store.join({...invite,credential:secret(),name:'超时设备'}),{status:410});
});

test('records are whitelisted, versioned, idempotent and deletions propagate without resurrection',async()=>{
  const {owner,second}=await paired();
  const input=change('favorite',{...favorite,mediaUrl:'https://secret.example/?token=private',cookie:'secret',film:{...film,url:'https://secret'}});
  const first=await store.write(owner.credential,input);assert.equal(first.record.version,1);
  assert.deepEqual(first.record.value,favorite);assert.deepEqual(await store.write(owner.credential,input),first);
  await assert.rejects(store.write(owner.credential,{...input,value:{...favorite,status:'planned'}}),{status:409});
  const remote=await store.pull(second.credential);assert.equal(remote.records.length,1);assert.equal(remote.records[0].value.status,'watching');
  const conflict=await store.write(second.credential,change('favorite',{...favorite,status:'planned'}));assert.equal(conflict.conflict,true);
  const removed=await store.write(second.credential,change('favorite',null,{deleted:true,baseVersion:1}));assert.equal(removed.record.deleted,true);
  const late=await store.write(owner.credential,change('favorite',favorite,{baseVersion:1}));assert.equal(late.conflict,true);assert.equal(late.current.deleted,true);
});

test('new playback session and monotonic sequence defeat late old-session writes',async()=>{
  const {owner,second}=await paired(),session1=randomUUID(),session2=randomUUID();
  const started=await store.claim(owner.credential,change('progress',progress(),{sessionId:session1}));
  const one=await store.write(owner.credential,change('progress',progress(20),{baseVersion:started.record.version,sessionId:session1,sequence:1}));
  const two=await store.claim(second.credential,change('progress',progress(25),{baseVersion:one.record.version,sessionId:session2}));
  assert.equal(two.record.sessionId,session2);
  const late=await store.write(owner.credential,change('progress',progress(40),{baseVersion:two.record.version,sessionId:session1,sequence:9}));assert.equal(late.conflict,true);
  const saved=await store.write(second.credential,change('progress',progress(30),{baseVersion:two.record.version,sessionId:session2,sequence:1}));
  assert.equal(saved.record.value.progress.position,30);
  assert.equal((await store.write(second.credential,change('progress',progress(29),{baseVersion:saved.record.version,sessionId:session2,sequence:1}))).conflict,true);
  assert.equal((await store.claim(owner.credential,change('progress',progress(12),{baseVersion:1,sessionId:randomUUID()}))).conflict,true);
});

test('individual device revocation, space isolation and recovery rotate all credentials',async()=>{
  const {owner,second}=await paired();
  await store.write(owner.credential,change('favorite',favorite));
  const devices=await store.devices(owner.credential);await store.revoke(owner.credential,devices.devices.find(v=>v.id!==devices.current).id);
  await assert.rejects(store.pull(second.credential),{status:401});assert.equal((await store.pull(owner.credential)).records.length,1);
  const outsider=device();await store.create(outsider);assert.deepEqual((await store.pull(outsider.credential)).records,[]);
  const recovered={name:'恢复设备',credential:secret(),recoveryCode:owner.recoveryCode,newRecoveryCode:secret()};await store.recover(recovered);await store.recover(recovered);
  await assert.rejects(store.pull(owner.credential),{status:401});assert.equal((await store.pull(recovered.credential)).records.length,1);
  await assert.rejects(store.recover({...recovered,credential:secret(),newRecoveryCode:secret()}),{status:403});
  await store.close(recovered.credential);await assert.rejects(store.pull(recovered.credential),{status:401});
});

test('invalid secrets/metadata/ranges and excessive anonymous requests are rejected',async()=>{
  await assert.rejects(store.create({name:'x',credential:'weak',recoveryCode:'weak'}),{status:400});
  await assert.rejects(store.create({...device(),name:'<b></b>'}),{status:400});
  assert.throws(()=>syncRecordValue('favorite',{...favorite,updatedAt:'invalid'}),{status:400});
  for(const p of [{position:-1},{duration:Infinity},{episode:0}])assert.throws(()=>syncRecordValue('progress',{...progress(),progress:{...progress().progress,...p}}),{status:400});
  assert.throws(()=>syncRecordValue('preferences',{playbackRate:7}),{status:400});
  for(let i=0;i<12;i++)await assert.rejects(store.recover({name:'bad',credential:secret(),newRecoveryCode:secret(),recoveryCode:secret()}),error=>[403,429].includes(error.status));
  await assert.rejects(store.recover({name:'bad',credential:secret(),newRecoveryCode:secret(),recoveryCode:secret()}),{status:429});
});

function response(){return {headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.code=value;return this;},json(value){this.data=value;return this;}};}
const request=body=>({method:'POST',headers:{host:'tv.test',origin:'https://tv.test','sec-fetch-site':'same-origin'},body});
test('repeated create conflicts and concurrent creates never consume phantom storage slots',async()=>{
  clock+=60001;const owner=device();await store.create(owner);
  await store.write(owner.credential,change('favorite',favorite));
  for(let i=0;i<100;i++)assert.equal((await store.write(owner.credential,change('favorite',favorite))).conflict,true);
  const duplicates=await Promise.all(Array.from({length:8},()=>store.write(owner.credential,change('skip',{intro:10,outro:20}))));
  assert.equal(duplicates.filter(value=>value.record).length,1);
  await Promise.all(Array.from({length:8},(_,index)=>store.write(owner.credential,change('skip',{intro:10,outro:20},{key:'different-'+index}))));
  const [row]=await query('SELECT s.slots,(SELECT count(*)::int FROM openstream_sync.records r WHERE r.space_id=s.id) AS count FROM openstream_sync.spaces s JOIN openstream_sync.devices d ON d.space_id=s.id WHERE d.id=$1',[(await store.devices(owner.credential)).current]);
  assert.equal(row.slots,10);assert.equal(row.slots,row.count);
});

test('concurrent joins consume an invitation once; cancelled pending device can withdraw',async()=>{
  clock+=60001;const owner=device();await store.create(owner);const ticket={id:randomUUID(),secret:secret()};await store.invite(owner.credential,ticket);
  const attempts=await Promise.allSettled(Array.from({length:3},(_,index)=>store.join({...ticket,credential:secret(),name:'candidate-'+index})));
  assert.equal(attempts.filter(v=>v.status==='fulfilled').length,1);
  const secondTicket={id:randomUUID(),secret:secret()};await store.invite(owner.credential,secondTicket);const second={...secondTicket,credential:secret(),name:'withdrawn'};await store.join(second);await store.withdraw(second.credential);
  await assert.rejects(store.status(second.credential),{status:401});assert.equal((await store.pairing(owner.credential,secondTicket.id)).state,'cancelled');
});

test('transport failure after commit retries the original operation without duplicating writes',async()=>{
  clock+=60001;const owner=device();await store.create(owner);let broken=true;
  const flaky=createDeviceSyncStore({now,query:async(sql,args)=>{const rows=await query(sql,args);if(broken&&sql.includes('INSERT INTO openstream_sync.requests')){broken=false;throw Error('transport closed after commit');}return rows;}});
  const operation=change('favorite',favorite);await assert.rejects(flaky.write(owner.credential,operation));
  const result=await flaky.write(owner.credential,operation);assert.equal(result.record.version,1);assert.equal((await store.pull(owner.credential)).records.length,1);
});

test('completed episode evidence survives a new session with an older local completion set',async()=>{
  clock+=60001;const {owner,second}=await paired();
  const first=await store.claim(owner.credential,change('progress',{...progress(),progress:{...progress().progress,episodeKey:'s1:e2',completedEpisodes:['s1:e1']}},{sessionId:randomUUID()}));
  const next=await store.claim(second.credential,change('progress',{...progress(),progress:{...progress().progress,episodeKey:'s1:e3',completedEpisodes:['s1:e2']}},{sessionId:randomUUID(),baseVersion:first.record.version}));
  assert.deepEqual(next.record.value.progress.completedEpisodes.sort(),['s1:e1','s1:e2']);
});

test('500-work limit is atomic across record types, keeps updates/deletes and frees fully removed works',async()=>{
  clock+=60001;const owner=device();await store.create(owner);
  for(let index=0;index<499;index++){if(index===300)clock+=60001;await store.write(owner.credential,change('skip',{intro:1,outro:2},{key:'film-work'+index}));}
  const race=await Promise.allSettled(['film-capA','film-capB'].map(key=>store.write(owner.credential,change('skip',{intro:1,outro:2},{key}))));
  assert.equal(race.filter(v=>v.status==='fulfilled').length,1);assert.equal(race.find(v=>v.status==='rejected').reason.status,507);
  await assert.rejects(store.write(owner.credential,change('skip',{intro:1,outro:2},{key:'film-work501'})),{status:507});
  const existing=await store.write(owner.credential,change('favorite',{film:{...film,id:'film-work0'},status:'watching'},{key:'film-work0'}));assert.equal(existing.record.version,1);
  await store.write(owner.credential,change('skip',null,{key:'film-work498',baseVersion:1,deleted:true}));
  assert.equal((await store.write(owner.credential,change('skip',{intro:3,outro:4},{key:'film-work501'}))).record.version,1);
  const [counts]=await query('SELECT (SELECT count(*)::int FROM openstream_sync.works w WHERE w.space_id=d.space_id) AS works,(SELECT count(*)::int FROM openstream_sync.records r WHERE r.space_id=d.space_id) AS records,s.slots FROM openstream_sync.devices d JOIN openstream_sync.spaces s ON s.id=d.space_id WHERE d.id=$1',[(await store.devices(owner.credential)).current]);
  assert.equal(counts.works,500);assert.equal(counts.records,502);assert.equal(counts.slots,502);
});

test('database/schema soft limits and atomic global quotas reject growth without damaging existing data',async()=>{
  clock+=60001;const owner=device();await store.create(owner);await store.write(owner.credential,change('favorite',favorite));
  const limited=createDeviceSyncStore({now,capacityTTL:0,query:async(sql,args)=>sql.includes('pg_database_size')?[{database_bytes:String(350*1024*1024),sync_bytes:'0'}]:query(sql,args)});
  await assert.rejects(limited.write(owner.credential,change('skip',{intro:1,outro:2})),{status:507});assert.equal((await limited.pull(owner.credential)).records.length,1);
  const schemaFull=createDeviceSyncStore({now,capacityTTL:0,query:async(sql,args)=>sql.includes('pg_database_size')?[{database_bytes:'100',sync_bytes:String(32*1024*1024)}]:query(sql,args)});
  await assert.rejects(schemaFull.invite(owner.credential,{id:randomUUID(),secret:secret()}),{status:507});
  const [before]=await query('SELECT * FROM openstream_sync.budget');await query('UPDATE openstream_sync.budget SET record_count=20000');
  await assert.rejects(store.write(owner.credential,change('skip',{intro:1,outro:2})),{status:507});
  assert.equal((await store.pull(owner.credential)).records.length,1);
  await query('UPDATE openstream_sync.budget SET record_count=$1,payload_bytes=20971520',[before.record_count]);
  await assert.rejects(store.write(owner.credential,change('skip',{intro:1,outro:2})),{status:507});
  await query('UPDATE openstream_sync.budget SET payload_bytes=$1',[before.payload_bytes]);
  const removed=await schemaFull.write(owner.credential,change('favorite',null,{baseVersion:1,deleted:true}));assert.equal(removed.record.deleted,true);
  await schemaFull.close(owner.credential);await assert.rejects(store.pull(owner.credential),{status:401});
});

test('opportunistic cleanup is rate-limited, bounded and keeps active rows',async()=>{
  clock+=60001;const owner=device();await store.create(owner);const deviceId=(await store.devices(owner.credential)).current;
  await query("INSERT INTO openstream_sync.requests(device_id,request_id,request_hash,result,created_at) SELECT $1,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'x','{}'::jsonb,$2::timestamptz-interval '8 days' FROM generate_series(1,250) n",[deviceId,new Date(clock).toISOString()]);
  await query("INSERT INTO openstream_sync.rate_limits(key,window_at,count) SELECT 'old-'||n,$1::timestamptz-interval '2 days',1 FROM generate_series(1,250)n",[new Date(clock).toISOString()]);
  await query('UPDATE openstream_sync.budget SET next_cleanup=$1',[new Date(clock-1).toISOString()]);
  const cleaner=createDeviceSyncStore({now,capacityTTL:0,query});await cleaner.invite(owner.credential,{id:randomUUID(),secret:secret()});
  assert.equal((await query('SELECT count(*)::int AS n FROM openstream_sync.requests WHERE device_id=$1',[deviceId]))[0].n,50);
  assert.equal((await query("SELECT count(*)::int AS n FROM openstream_sync.rate_limits WHERE key LIKE 'old-%'"))[0].n,50);
  await cleaner.invite(owner.credential,{id:randomUUID(),secret:secret()});assert.equal((await query('SELECT count(*)::int AS n FROM openstream_sync.requests WHERE device_id=$1',[deviceId]))[0].n,50);
});

test('invitation and device slots remain bounded under concurrent approval and revocation',async()=>{
  clock+=60001;const owner=device();await store.create(owner);
  async function pending(name){const ticket={id:randomUUID(),secret:secret()};await store.invite(owner.credential,ticket);const joined=await store.join({...ticket,credential:secret(),name});return {id:ticket.id,joinId:joined.deviceId,matchCode:joined.matchCode};}
  for(let index=0;index<8;index++)await store.confirm(owner.credential,await pending('device-'+index));
  const a=await pending('tenth-a'),b=await pending('tenth-b');
  await assert.rejects(store.invite(owner.credential,{id:randomUUID(),secret:secret()}),{status:409});
  const approved=await Promise.allSettled([store.confirm(owner.credential,a),store.confirm(owner.credential,b)]);assert.equal(approved.filter(v=>v.status==='fulfilled').length,1);
  const list=await store.devices(owner.credential);assert.equal(list.devices.length,10);
  await store.revoke(owner.credential,list.devices.find(d=>d.id!==list.current).id);
  const waiting=approved[0].status==='rejected'?a:b;await store.confirm(owner.credential,waiting);assert.equal((await store.devices(owner.credential)).devices.length,10);
});

test('HTTP boundary keeps access protections, origin checks and secrets out of failures',async()=>{
  let res=response();await createDeviceSyncHandler({env:{},store})(request({action:'create'}),res);assert.equal(res.code,503);
  const handler=createDeviceSyncHandler({env:{DEVICE_SYNC_ENABLED:'1'},store});
  res=response();await handler({...request({action:'create'}),headers:{host:'tv.test',origin:'https://evil.test'}},res);assert.equal(res.code,403);
  res=response();await createDeviceSyncHandler({env:{DEVICE_SYNC_ENABLED:'1',TURNSTILE_ENABLED:'true'},store})(request({action:'create'}),res);assert.equal(res.code,503);assert.match(res.data.code,/human/);
  res=response();await handler(request({action:'pull'}),res);assert.equal(res.code,401);
  res=response();await handler(request('{broken'),res);assert.equal(res.code,503);assert.doesNotMatch(JSON.stringify(res.data),/SQL|postgres|Bearer|credential/);
  res=response();await handler(request({action:'close',confirm:false}),res);assert.equal(res.code,400);
  res=response();await handler({...request({}),method:'GET'},res);assert.equal(res.data.enabled,true);assert.equal(res.headers['Cache-Control'],'private, no-store');
});

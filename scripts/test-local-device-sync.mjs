import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,symlink,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createLocalDeviceSyncPreview} from './local-device-sync.mjs';
import {createSessionToken} from '../server/auth-session.mjs';

const secret=()=>randomBytes(32).toString('base64url');
const device=name=>({name,credential:secret(),recoveryCode:secret()});
const roots=[];
async function directory(){const root=await mkdtemp(path.join(os.tmpdir(),'openstream-local-sync-'));roots.push(root);return path.join(root,'state');}
test.after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
async function serve(preview,port=0){
 const server=http.createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};
  if(new URL(req.url,'http://localhost').pathname!=='/api/sync/device')return res.status(404).json({});
  const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)return res.status(413).json({});chunks.push(chunk);}req.body=Buffer.concat(chunks).toString()||undefined;
  try{await preview.handler(req,res);}catch{res.status(500).json({message:'Local test request failed'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 let closing;return {origin,port:server.address().port,close(){if(!closing)closing=(async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await preview.close();})();return closing;}};
}
async function post(site,body,credential,headers={}){
 const response=await fetch(site.origin+'/api/sync/device',{method:'POST',headers:{'Content-Type':'application/json',Origin:site.origin,...(credential?{Authorization:'Bearer '+credential}:{}),...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};
}
async function direct(preview,body,headers={}){
 let status=200,value;const res={setHeader(){},status(code){status=code;return this;},json(data){value=data;return this;}};
 await preview.handler({method:'POST',headers:{host:'127.0.0.1:18888',origin:'http://127.0.0.1:18888',...headers},socket:{remoteAddress:'127.0.0.1'},body},res);return {status,body:value};
}

test('sync is disabled without a private directory despite inherited deployment database flags',async()=>{
 const preview=await createLocalDeviceSyncPreview({env:{DEVICE_SYNC_ENABLED:'1',CATALOG_DATABASE_URL:'postgresql://unused:unused@127.0.0.1:9/never'}}),site=await serve(preview);
 try{assert.equal(preview.enabled,false);assert.equal(preview.dataDir,null);assert.deepEqual(await(await fetch(site.origin+'/api/sync/device')).json(),{enabled:false});assert.equal((await post(site,{action:'create',...device('本机')})).status,503);}finally{await site.close();await preview.close();}
});

test('real loopback HTTP pairing and versioned progress survive a normal restart, revoke and close',async()=>{
 const dataDir=await directory(),owner=device('电脑'),second=device('另一个浏览器');let site=await serve(await createLocalDeviceSyncPreview({dataDir,env:{}}));
 const restart=async()=>{const port=site.port;await site.close();site=await serve(await createLocalDeviceSyncPreview({dataDir,env:{}}),port);};
 try{
  assert.equal((await stat(dataDir)).mode&0o777,0o700);assert.deepEqual(await(await fetch(site.origin+'/api/sync/device')).json(),{enabled:true});
  const first=await post(site,{action:'create',...owner});assert.equal(first.status,200);assert.equal((await post(site,{action:'create',...owner})).body.deviceId,first.body.deviceId);
  const invitation={id:randomUUID(),secret:secret()};assert.equal((await post(site,{action:'invite',...invitation},owner.credential)).status,200);
  const joined=await post(site,{action:'join',...invitation,credential:second.credential,name:second.name});assert.equal(joined.status,200);assert.equal(joined.body.approved,false);assert.equal((await post(site,{action:'pull'},second.credential)).status,401);
  await restart();assert.equal((await post(site,{action:'status'},second.credential)).body.approved,false);
  const pending=await post(site,{action:'pairing',id:invitation.id},owner.credential);assert.equal(pending.status,200);assert.equal(pending.body.matchCode,joined.body.matchCode);
  assert.equal((await post(site,{action:'confirm',id:invitation.id,joinId:joined.body.deviceId,matchCode:joined.body.matchCode},owner.credential)).status,200);
  const film={id:'film-local-pair',name:'星河深处',type:'电视剧',episodes:8,seasons:2},request={action:'write',requestId:randomUUID(),baseVersion:0,bucket:'progress',key:film.id,sessionId:randomUUID(),sequence:1,value:{film,progress:{position:125,duration:2400,season:2,episode:3,episodeKey:'s2:e3',totalEpisodes:8,watchedAt:new Date().toISOString()}}};
  const written=await post(site,request,owner.credential);assert.equal(written.status,200);assert.equal(written.body.record.version,1);assert.deepEqual((await post(site,request,owner.credential)).body,written.body);
  assert.equal((await post(site,{action:'write',requestId:randomUUID(),baseVersion:0,bucket:'preferences',key:'selected',value:{autoplay:true,playbackRate:1.75}},owner.credential)).status,200);
  await restart();
  assert.equal((await post(site,{action:'status'},second.credential)).body.approved,true);const pulled=await post(site,{action:'pull'},second.credential);assert.equal(pulled.status,200);const progress=pulled.body.records.find(record=>record.bucket==='progress');assert.equal(progress.value.progress.position,125);assert.equal(progress.value.progress.episodeKey,'s2:e3');assert.equal(pulled.body.records.find(record=>record.bucket==='preferences').value.playbackRate,1.75);
  const conflict=await post(site,{...request,requestId:randomUUID(),value:{...request.value,progress:{...request.value.progress,position:300}}},second.credential);assert.equal(conflict.status,200);assert.equal(conflict.body.conflict,true);assert.equal(conflict.body.current.value.progress.position,125);
  assert.equal((await post(site,{action:'revoke',id:joined.body.deviceId},owner.credential)).status,200);assert.equal((await post(site,{action:'pull'},second.credential)).status,401);
  assert.equal((await post(site,{action:'close',confirm:true},owner.credential)).status,200);assert.equal((await post(site,{action:'pull'},owner.credential)).status,401);
 }finally{await site.close();}
 const db=new PGlite(path.join(dataDir,'database'));
 try{assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='openstream_sync'")).rows[0].n,8);assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM openstream_sync.spaces')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM openstream_sync.records')).rows[0].n,0);}finally{await db.close();}
});

test('the persistent local backend never falls through to a catalogue URL or outbound fetch',async()=>{
 const dataDir=await directory(),original=globalThis.fetch;let network=0,preview;
 try{globalThis.fetch=(...args)=>{network++;throw Error('Unexpected outbound request');};preview=await createLocalDeviceSyncPreview({dataDir,env:{DEVICE_SYNC_ENABLED:'1',CATALOG_DATABASE_URL:'postgresql://unused:unused@127.0.0.1:9/never'}});assert.equal((await direct(preview,{action:'create',...device('隔离测试')})).status,200);assert.equal(network,0);}finally{globalThis.fetch=original;await preview?.close();}
});

test('the local handler preserves Origin, site-access and human-verification requirements',async()=>{
 const dataDir=await directory();let preview=await createLocalDeviceSyncPreview({dataDir,env:{PASSWORD:'local-test-only-password'}}),site=await serve(preview);
 try{
  assert.equal((await post(site,{action:'create',...device('拒绝访问')})).status,401);
  assert.equal((await post(site,{action:'create',...device('跨站')},null,{Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await post(site,{action:'create',...device('伪装主机')},null,{Host:'foreign.invalid',Origin:'http://foreign.invalid'})).status,403);let remoteStatus;await preview.handler({method:'GET',headers:{host:'127.0.0.1:18888'},socket:{remoteAddress:'192.168.1.20'}},{status(value){remoteStatus=value;return this;},json(){}});assert.equal(remoteStatus,403);
  assert.equal((await post(site,{action:'create',...device('已验证本机')},null,{Cookie:'openstream_session='+createSessionToken({PASSWORD:'local-test-only-password'})})).status,200);
 }finally{await site.close();}
 preview=await createLocalDeviceSyncPreview({dataDir,env:{TURNSTILE_ENABLED:'true'}});site=await serve(preview);
 try{const result=await post(site,{action:'create',...device('人机保护')});assert.equal(result.status,503);assert.equal(result.body.code,'human_verification_unavailable');}finally{await site.close();}
});

test('one filesystem database has one owner, idempotent close unlocks it, and stale owned locks recover',async()=>{
 const dataDir=await directory(),first=await createLocalDeviceSyncPreview({dataDir,env:{}});
 await assert.rejects(createLocalDeviceSyncPreview({dataDir,env:{}}),{code:'LOCAL_SYNC_LOCKED'});await first.close();await first.close();
 await writeFile(path.join(dataDir,'session.lock'),JSON.stringify({format:'openstream-local-sync-lock',pid:2147483647,nonce:randomUUID()}));
 const next=await createLocalDeviceSyncPreview({dataDir,env:{}});await next.close();assert.equal((await readdir(dataDir)).includes('session.lock'),false);
});

test('unrelated files, symlinks, checkout paths and deployment mode are rejected without touching originals',async()=>{
 const dataDir=await directory();await mkdir(dataDir);await writeFile(path.join(dataDir,'original.txt'),'keep unchanged');await assert.rejects(createLocalDeviceSyncPreview({dataDir,env:{}}),{code:'LOCAL_SYNC_DIRECTORY'});assert.equal(await readFile(path.join(dataDir,'original.txt'),'utf8'),'keep unchanged');assert.deepEqual(await readdir(dataDir),['original.txt']);
 const link=path.join(path.dirname(dataDir),'linked');await symlink(dataDir,link);await assert.rejects(createLocalDeviceSyncPreview({dataDir:link,env:{}}),{code:'LOCAL_SYNC_DIRECTORY'});
 await assert.rejects(createLocalDeviceSyncPreview({dataDir:path.resolve('web/local-sync-database'),env:{}}),{code:'LOCAL_SYNC_DIRECTORY'});await assert.rejects(createLocalDeviceSyncPreview({dataDir:await directory(),env:{VERCEL:'1'}}),{code:'LOCAL_SYNC_ENVIRONMENT'});await assert.rejects(createLocalDeviceSyncPreview({dataDir:'relative-state',env:{}}),{code:'LOCAL_SYNC_DIRECTORY'});
});

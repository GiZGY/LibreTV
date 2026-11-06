import {mkdir,lstat,readdir,readFile,writeFile,open,unlink,realpath,chmod} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createDeviceSyncStore} from '../server/device-sync.mjs';
import {createDeviceSyncHandler} from '../api/sync/device.mjs';

const format='openstream-local-sync',lockFormat=format+'-lock';
const failure=(code,message)=>Object.assign(new Error(message),{code});
const absent=error=>{if(error.code==='ENOENT')return null;throw error;};
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
function loopbackRequest(req){
 try{const url=new URL('http://'+req.headers?.host);return loopback(req.socket?.remoteAddress)&&!url.username&&!url.password&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);}catch{return false;}
}
const localOnly=handler=>async(req,res)=>{
 if(!loopbackRequest(req))return res.status(403).json({message:'此同步服务仅用于本机预览'});
 return handler(req,res);
};
async function canonical(target){
 try{return await realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;return path.join(await canonical(path.dirname(target)),path.basename(target));}
}
async function location(input){
 if(typeof input!=='string'||!path.isAbsolute(input))throw failure('LOCAL_SYNC_DIRECTORY','Local sync requires an absolute private data directory');
 const directory=await canonical(path.resolve(input)),checkout=await realpath(fileURLToPath(new URL('../',import.meta.url))),relative=path.relative(checkout,directory);
 if(relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw failure('LOCAL_SYNC_DIRECTORY','Local sync data must stay outside the checkout');
 const info=await lstat(input).catch(absent);if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw failure('LOCAL_SYNC_DIRECTORY','Local sync directory must not be a symlink or file');
 if(info){
  const names=await readdir(directory);if(names.some(name=>!['owner.json','database','session.lock'].includes(name)))throw failure('LOCAL_SYNC_DIRECTORY','Selected directory contains unrelated files');
  for(const name of names){const stat=await lstat(path.join(directory,name));if(stat.isSymbolicLink())throw failure('LOCAL_SYNC_DIRECTORY','Local sync state must not use symlinks');}
  if(names.includes('owner.json')){let owner;try{owner=JSON.parse(await readFile(path.join(directory,'owner.json'),'utf8'));}catch{}if(owner?.format!==format||owner.version!==1)throw failure('LOCAL_SYNC_DIRECTORY','Selected directory belongs to another data format');}
  else if(names.includes('database'))throw failure('LOCAL_SYNC_DIRECTORY','Existing database has no local sync ownership marker');
 }
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);return directory;
}
async function exclusive(directory){
 const file=path.join(directory,'session.lock'),nonce=randomUUID();
 for(let attempt=0;attempt<2;attempt++){
  let handle;
  try{handle=await open(file,'wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const raw=await readFile(file,'utf8');let lock;try{lock=JSON.parse(raw);}catch{}
   if(lock?.format!==lockFormat||!Number.isInteger(lock.pid)||lock.pid<1||typeof lock.nonce!=='string')throw failure('LOCAL_SYNC_LOCKED','Local sync has an unrecognized lock; use another private directory');
   let alive=true;try{process.kill(lock.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
   if(alive)throw failure('LOCAL_SYNC_LOCKED','Local sync database is already open in another preview');
   if(raw===await readFile(file,'utf8'))await unlink(file);continue;
  }
  try{await handle.writeFile(JSON.stringify({format:lockFormat,pid:process.pid,nonce}));}catch(error){await handle.close();await unlink(file);throw error;}await handle.close();
  return async()=>{let lock;try{lock=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}if(lock.nonce===nonce)await unlink(file);};
 }
 throw failure('LOCAL_SYNC_LOCKED','Local sync lock changed; retry after the other preview exits');
}

// No dataDir means disabled, even when the shell carries production sync/database flags.
export async function createLocalDeviceSyncPreview({dataDir,env=process.env}={}){
 const securityKeys=['PASSWORD','AUTH_SESSION_TTL_SECONDS','TURNSTILE_ENABLED','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_SESSION_SECRET','TURNSTILE_HOSTNAMES'];
 const localEnv=Object.fromEntries(securityKeys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
 if(!dataDir)return {enabled:false,storage:'disabled',dataDir:null,handler:localOnly(createDeviceSyncHandler({env:{...localEnv,DEVICE_SYNC_ENABLED:'0'},store:{}})),close:async()=>{}};
 if(env.VERCEL==='1')throw failure('LOCAL_SYNC_ENVIRONMENT','Local sync preview is not a deployment database');
 const directory=await location(dataDir),release=await exclusive(directory);let db;
 try{
  await writeFile(path.join(directory,'owner.json'),JSON.stringify({format,version:1}),{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const {PGlite}=await import('@electric-sql/pglite');db=new PGlite(path.join(directory,'database'));
  const schema=await readFile(new URL('../server/device-sync-schema.sql',import.meta.url),'utf8');
  try{await db.exec('BEGIN;\n'+schema+'\nCOMMIT;');}catch(error){await db.exec('ROLLBACK;').catch(()=>{});throw error;}
  // Explicit injection is essential: the production store defaults to the catalogue connection.
  const store=createDeviceSyncStore({query:async(sql,args=[])=>(await db.query(sql,args)).rows});
  const handler=createDeviceSyncHandler({env:{...localEnv,DEVICE_SYNC_ENABLED:'1'},store});let closing;
  return {enabled:true,storage:'pglite',dataDir:directory,
   handler:localOnly((req,res)=>closing?res.status(503).json({message:'同步服务正在关闭，本机记录已保留'}):handler(req,res)),
   close(){if(!closing)closing=(async()=>{await db.close();await release();})();return closing;}
  };
 }catch(error){let stopped=!db;try{if(db){await db.close();stopped=true;}}catch{}if(stopped)await release();throw error;}
}

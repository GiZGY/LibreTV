import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createDeviceSyncStore} from '../server/device-sync.mjs';
import {createDeviceSyncHandler} from '../api/sync/device.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startDeviceSyncAcceptance(port=18450){
 const sourceMode=process.env.SYNC_ACCEPTANCE_SOURCE==='1';
 const built=await readFile(path.join(root,'public/index.html'),'utf8');
 if(!sourceMode&&(!built.includes('device-sync.js')||!built.includes('local-data.js')))throw Error('Production sync modules missing; build the complete UI before acceptance');
 const db=new PGlite();await db.exec(await readFile(path.join(root,'server/device-sync-schema.sql'),'utf8'));
 const query=async(sql,args)=>(await db.query(sql,args)).rows,store=createDeviceSyncStore({query});
 const handler=createDeviceSyncHandler({env:{DEVICE_SYNC_ENABLED:'1'},store});
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
 const server=http.createServer(async(req,res)=>{
  res.status=value=>{res.statusCode=value;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};
  try{
   const url=new URL(req.url,'http://127.0.0.1:'+port),pathname=url.pathname;
   if(pathname==='/api/sync/device'){
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){res.status(413).json({message:'too large'});return;}chunks.push(chunk);}req.body=Buffer.concat(chunks).toString()||undefined;await handler(req,res);return;
   }
   if(pathname==='/api/auth/status'){res.status(200).json({authenticated:true,publicAccess:true});return;}
   if(pathname==='/api/security/human'){res.status(200).json({enabled:false,ready:true,verified:true});return;}
   if(pathname.startsWith('/api/catalog/')){res.status(200).json({items:[],total:0});return;}
   let file;
   if(sourceMode&&pathname.startsWith('/libs/qrcode-generator'))file=path.resolve(root,'web',pathname.slice(1));
   else if(sourceMode&&pathname.startsWith('/acceptance/'))file=path.resolve(root,'web',pathname.slice('/acceptance/'.length));
   else file=path.resolve(root,'public','.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(root+path.sep))throw Error();
   let content=await readFile(file);
   if(file.endsWith('index.html')){
    let html=content.toString();if(sourceMode&&!html.includes('device-sync.js'))html=html.replace('</head>','<link rel="stylesheet" href="/acceptance/device-sync.css"><script defer src="/acceptance/local-data.js"></script><script defer src="/acceptance/device-sync.js"></script></head>');content=Buffer.from(html);
   }
   res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(content);
  }catch{res.statusCode=404;res.end('Not found');}
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(error){await db.close();throw error;}
 return {store,query,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}

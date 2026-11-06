import http from 'node:http';
import {createHumanHandler} from '../api/security/human.mjs';
import fs from 'node:fs/promises';
import {existsSync,rmSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const media=mkdtempSync(path.join(os.tmpdir(),'openstream-player-'));
process.on('exit',()=>rmSync(media,{recursive:true,force:true}));
process.once('SIGTERM',()=>process.exit(0));process.once('SIGINT',()=>process.exit(0));
const ffmpeg=process.env.FFMPEG||'ffmpeg';
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-c:a','aac','-movflags','+faststart',path.join(media,'sample.mp4')]);
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',path.join(media,'sample.mp4'),'-c','copy','-hls_time','2','-hls_list_size','0',path.join(media,'sample.m3u8')]);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const human=createHumanHandler({env:{TURNSTILE_ENABLED:'true',TURNSTILE_SITE_KEY:'isolated-fixture',TURNSTILE_SECRET_KEY:'s'.repeat(32),TURNSTILE_SESSION_SECRET:'k'.repeat(32),TURNSTILE_HOSTNAMES:'127.0.0.1'},fetchImpl:async()=>({ok:true,json:async()=>({success:true,action:'browse',hostname:'127.0.0.1'})})});
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/security/human'&&req.headers.cookie?.includes('__qa_human_mode=1')){if(req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Error('body');}req.body=body;}res.status=code=>{res.statusCode=code;return res;};res.json=value=>res.end(JSON.stringify(value));return await human(req,res);}
 if(u.pathname==='/api/auth/status'||u.pathname==='/api/security/human'||u.pathname.startsWith('/api/catalog/')){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  return res.end(JSON.stringify(u.pathname.includes('/human')?{enabled:false,ready:false,verified:true}:u.pathname.includes('/auth/')?{authenticated:true,configured:false,publicAccess:true}:{items:[],total:0}));
 }
 const base=u.pathname.startsWith('/media/')?media:path.join(root,'public');
 const relative=u.pathname.startsWith('/media/')?u.pathname.slice(7):u.pathname==='/'?'index.html':u.pathname.slice(1);
 const file=path.resolve(base,relative);if(!file.startsWith(base+path.sep))throw Error('path');
 const ref=process.env.ACCEPTANCE_PLAYER_REF;
 const bytes=ref&&/^[a-f0-9]{7,40}$/.test(ref)&&file.endsWith('/player-preview.js')?execFileSync('git',['show',ref+':web/player-preview.js'],{cwd:root}):await fs.readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range){const start=Number(range[1]),end=Math.min(bytes.length-1,range[2]?Number(range[2]):bytes.length-1);if(start>end){res.writeHead(416);return res.end();}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});return res.end(bytes.subarray(start,end+1));}
 res.setHeader('Content-Length',bytes.length);res.end(bytes);
}catch{res.writeHead(404);res.end();}}).listen(18448,'127.0.0.1',()=>console.log('Isolated full-UI player acceptance :18448'));

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const password=randomBytes(24).toString('base64url');
const base='http://127.0.0.1:18442';
const child=spawn(process.execPath,['scripts/serve-new-ui.mjs'],{cwd:root,env:{...process.env,PASSWORD:password,NEW_UI_PORT:'18442'},stdio:'ignore'});
try{
 let ready=false;
 for(let i=0;i<40;i++){try{await fetch(base+'/api/auth/status');ready=true;break;}catch{await sleep(100);}}
 assert.ok(ready,'local server starts');
 const status=await(await fetch(base+'/api/auth/status')).json();assert.equal(status.configured,true);assert.equal(status.authenticated,false);
 const denied=await fetch(base+'/api/tvbox/health');assert.equal(denied.status,401);
 const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
 assert.equal(response.status,200);const session=await response.json();assert.equal(session.authenticated,true);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const logged=await(await fetch(base+'/api/auth/status',{headers:{cookie}})).json();assert.equal(logged.authenticated,true);
 for(const url of ['/.env.local','/server.mjs','/js/app.js'])assert.equal((await fetch(base+url)).status,404);
 const html=await(await fetch(base)).text();assert.ok(html.includes('live-ui.js'));assert.ok(!html.includes('compiled/index.min.js'));
 const auth=new URLSearchParams({auth:session.proxy.token,t:session.proxy.bucket});
 const internal=await fetch(base+'/proxy/'+encodeURIComponent('http://127.0.0.1:8080/')+'?'+auth,{headers:{cookie}});assert.ok(internal.status>=400,'private target remains blocked');
 console.log('PASS: auth, protected bridge, secret-file isolation, new UI entry, private-address blocking');
 if(process.argv.includes('--network')){
  for(const [name,url] of [['douban','https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=3&page_start=0'],['bfzy','https://bfzyapi.com/api.php/provide/vod?ac=videolist&wd=%E6%98%9F%E9%99%85%E7%A9%BF%E8%B6%8A'],['jisu','https://jszyapi.com/api.php/provide/vod?ac=videolist&wd=%E6%98%9F%E9%99%85%E7%A9%BF%E8%B6%8A']]){
   const started=Date.now();try{const result=await fetch(base+'/proxy/'+encodeURIComponent(url)+'?'+auth,{headers:{cookie},signal:AbortSignal.timeout(15000)});const body=await result.json();console.log(JSON.stringify({source:name,status:result.status,count:(body.subjects||body.list||[]).length,ms:Date.now()-started}));}catch(error){console.log(JSON.stringify({source:name,error:error.name,ms:Date.now()-started}));}
  }
 }
 await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie}});
}finally{child.kill('SIGTERM');}

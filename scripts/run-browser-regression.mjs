import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const lock=path.resolve('node_modules/.cache/openstream-browser.lock');await mkdir(path.dirname(lock),{recursive:true});
let handle;
for(let attempt=0;attempt<2;attempt++){
 try{handle=await open(lock,'wx');break;}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(await readFile(lock,'utf8').catch(()=>0));let alive=false;
  if(pid>0)try{process.kill(pid,0);alive=true;}catch{}
  if(alive)throw Error('Browser regression is already running for this workspace');
  await unlink(lock).catch(()=>{});
 }
}
if(!handle)throw Error('Browser regression lock unavailable');await handle.writeFile(String(process.pid));
async function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});const stop=signal=>child.kill(signal);const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);child.once('error',reject);child.once('exit',code=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);resolve(code??1);});});}
try{const args=process.argv.slice(2),reuse=args.includes('--no-build');if(reuse)await readFile('public/index.html');const built=reuse?0:await run(['scripts/build-new-ui.mjs']);process.exitCode=built||await run(['node_modules/@playwright/test/cli.js','test',...args.filter(arg=>arg!=='--no-build')]);}finally{await handle.close();await unlink(lock);}

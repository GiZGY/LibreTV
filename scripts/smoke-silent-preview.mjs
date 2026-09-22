import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const child=spawn(process.execPath,['scripts/serve-new-ui.mjs'],{
 cwd:fileURLToPath(new URL('..',import.meta.url)),
 env:{...process.env,NEW_UI_PORT:'18444',NEW_UI_TEST_MUTED:'1',NEW_UI_TEST_NATIVE:'1'},stdio:'ignore'
});
try{
 let response;
 for(let attempt=0;attempt<40;attempt++){
  if(child.exitCode!==null)throw Error('Silent preview did not start');
  try{response=await fetch('http://127.0.0.1:18444/player-preview.js');break;}catch{await sleep(100);}
 }
 assert.ok(response?.ok,'silent preview responds');
 const source=await response.text();
 assert.ok(source.includes('volume:0,muted:true,setting:true'));
 assert.ok(!source.includes('volume:.8,setting:true'));
 assert.ok(source.includes('customType:{m3u8(video,url){video.muted=true;video.defaultMuted=true;video.volume=0;'));
 assert.ok(source.includes('const instance=art;instance.video.muted=true;instance.video.defaultMuted=true;instance.video.volume=0;'));
 assert.ok(!source.includes('if(window.Hls?.isSupported())'));
 const html=await (await fetch('http://127.0.0.1:18444/')).text();
 const modules=['native-ad-timelines.js','native-ad-evidence.js','native-ad-guard.js','native-ad-verifier.js','native-ad-transport.js','native-ad-session.js'];
 let previous=-1;
 for(const file of modules){
  const index=html.indexOf('src="core/'+file+'"');assert.ok(index>previous);previous=index;
  const response=await fetch('http://127.0.0.1:18444/core/'+file);assert.ok(response.ok);
  assert.match(response.headers.get('content-type'),/javascript/);
 }
 assert.ok(html.indexOf('src="player-preview.js"')>previous);
 console.log('Silent local QA: initial and replacement player constructors muted; production source unchanged');
}finally{
 const exited=new Promise(resolve=>child.once('exit',resolve));
 if(child.exitCode===null){child.kill('SIGTERM');await exited;}
}

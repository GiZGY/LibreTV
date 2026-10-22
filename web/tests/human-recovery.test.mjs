import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../human-access.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const dialogs=[],callbacks=[],timers=new Map();let seq=0,verified=false,posts=0;
 const element=()=>({children:[],textContent:'',focus(){},append(x){this.children.push(x);}});
 const document={activeElement:{focus(){}},documentElement:{dataset:{}},head:{append(){}},body:{append(d){dialogs.push(d);}},createElement(tag){if(tag!=='dialog')return element();const parts={'.human-title':element(),'.human-widget':element(),'.human-message':element(),button:element()};return {parts,setAttribute(){},addEventListener(n,f){this[n]=f;},querySelector:k=>parts[k],showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};}};
 const window={OPENSTREAM_LIVE:true,matchMedia:()=>({matches:true}),turnstile:{render(el,opts){callbacks.push(opts);return callbacks.length;},remove(){},reset(){}},fetch:async(url,opts)=>{if(opts?.method==='POST'){posts++;verified=true;return {ok:true,json:async()=>({verified:true})};}return {ok:true,json:async()=>({enabled:true,ready:true,siteKey:'fixture',verified})};}};
 vm.runInNewContext(source,{window,document,location:{href:'https://fixture.test/',origin:'https://fixture.test'},URL,AbortSignal,setTimeout:(f,ms)=>{timers.set(++seq,{f,ms});return seq;},clearTimeout:id=>timers.delete(id)});
 return {window,dialogs,callbacks,timers,posts:()=>posts};
}
test('hung widget stays open and explicit retry restores verification',async()=>{
 const f=fixture(),p=f.window.HumanAccess.ensure();await flush();
 [...f.timers.values()].find(t=>t.ms===45000).f();await flush();
 assert.equal(f.dialogs[0].open,true);assert.equal(f.posts(),0);
 f.dialogs[0].parts['.human-message'].children[0].onclick();await flush();
 await f.callbacks[0].callback('stale');assert.equal(f.posts(),0);
 await f.callbacks[1].callback('fresh');await p;assert.equal(f.posts(),1);assert.equal(f.dialogs[0].open,false);
});
test('failure then close then a fresh verification does not retain a rejected promise',async()=>{
 const f=fixture(),p=f.window.HumanAccess.ensure();const rejected=assert.rejects(p,/验证已取消/);await flush();
 f.callbacks[0]['error-callback']();await flush();assert.equal(f.dialogs[0].open,true);
 f.dialogs[0].parts.button.onclick();await rejected;
 const next=f.window.HumanAccess.ensure();await flush();await f.callbacks[1].callback('fresh');await next;
 assert.equal(f.posts(),1);assert.equal(f.dialogs[1].open,false);
});

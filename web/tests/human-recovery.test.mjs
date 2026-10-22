import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../human-access.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({retainCookie=true}={}){
 const dialogs=[],callbacks=[],timers=new Map();let seq=0,verified=false,posts=0;
 const element=()=>({children:[],textContent:'',focus(){},append(x){this.children.push(x);}});
 const document={activeElement:{focus(){}},documentElement:{dataset:{}},head:{append(){}},body:{append(d){dialogs.push(d);}},createElement(tag){if(tag!=='dialog')return element();const parts={'.human-title':element(),'.human-widget':element(),'.human-message':element(),button:element()};return {parts,setAttribute(){},addEventListener(n,f){this[n]=f;},querySelector:k=>parts[k],showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};}};
 const window={OPENSTREAM_LIVE:true,matchMedia:()=>({matches:true}),turnstile:{render(el,opts){callbacks.push(opts);return callbacks.length;},remove(){},reset(){}},fetch:async(url,opts)=>{if(opts?.method==='POST'){posts++;verified=retainCookie;return {ok:true,json:async()=>({verified:true})};}return {ok:true,json:async()=>({enabled:true,ready:true,siteKey:'fixture',verified})};}};
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
test('failed first verification blocks Escape and retries in the same dialog',async()=>{
 const f=fixture(),p=f.window.HumanAccess.ensure();await flush();
 f.callbacks[0]['error-callback']();await flush();
 let prevented=false;f.dialogs[0].cancel({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(f.dialogs[0].open,true);assert.equal(f.posts(),0);
 f.dialogs[0].parts['.human-message'].children[0].onclick();await flush();
 await f.callbacks[1].callback('fresh');await p;
 assert.equal(f.dialogs.length,1);assert.equal(f.posts(),1);assert.equal(f.dialogs[0].open,false);
});

test('successful POST without a retained cookie never releases protected requests',async()=>{
 const f=fixture({retainCookie:false});let released=false;
 void f.window.HumanAccess.ensure().then(()=>{released=true;});await flush();
 await f.callbacks[0].callback('token');await flush();
 assert.equal(released,false);assert.equal(f.dialogs[0].open,true);
 assert.match(f.dialogs[0].parts['.human-message'].textContent,/验证尚未生效/);
});

test('legacy negative cache migration is one-time and preserves personal records',()=>{
 const ui=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
 const code=ui.slice(ui.indexOf('  function recoverLegacyAvailability()'),ui.indexOf('  async function authorize()'));
 const store=new Map([['missingSources',{film:9999999999999}],['sourceRetryDays',{film:'today'}],['favorites',['film']],['history',['film']],['preferences',{theme:'dark'}]]);
 const context={load:(k,d)=>store.get(k)??d,save:(k,v)=>store.set(k,v)};
 vm.createContext(context);vm.runInContext(code+';recoverLegacyAvailability();',context);
 assert.equal(Object.keys(store.get('missingSources')).length,0);
 assert.equal(Object.keys(store.get('sourceRetryDays')).length,0);
 assert.deepEqual(store.get('favorites'),['film']);assert.deepEqual(store.get('history'),['film']);
 assert.deepEqual(store.get('preferences'),{theme:'dark'});
 store.set('missingSources',{confirmed:123});vm.runInContext('recoverLegacyAvailability()',context);
 assert.deepEqual(store.get('missingSources'),{confirmed:123});
 assert.match(ui,/if \(authenticated\) \{ ProxyAuth.setSession\(session\); recoverLegacyAvailability\(\);/);
});

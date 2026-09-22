import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  function sourceRetryDay('),source.indexOf('  async function updateRelated('));
function harness(resolveFilm){
  const notes=[];const storage={};
  const element=()=>({dataset:{},textContent:'',children:[],setAttribute(){},append(...children){this.children.push(...children)},remove(){},addEventListener(_name,callback){this.retry=callback}});
  const attrs=new Map([['href','#player/test']]);
  const button={innerHTML:'立即观看',textContent:'',getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),closest:()=>({after:note=>notes.push(note)})};
  const context=vm.createContext({document:{querySelector:()=>button,createElement:element},load:(key,fallback)=>storage[key]||fallback,save:(key,value)=>storage[key]=value,generation:1,newEpisode:()=>0,historyMetadata:{},resolveFilm,refreshDetailText(){},AbortController,AbortSignal,setTimeout,clearTimeout});
  vm.runInContext(fn,context);
  return {context,button,attrs,notes,storage};
}
test('detail checks sources before enabling playback',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve}));
  const task=h.context.checkAvailability({catalogProvider:'tmdb',lines:[{}]},new AbortController().signal,1);
  assert.equal(h.attrs.has('href'),false);assert.equal(h.button.textContent,'正在查找来源…');
  finish();await task;
  assert.equal(h.attrs.get('href'),'#player/test');assert.match(h.notes[0].textContent,/已找到 1 条/);
});
test('source failure leaves playback disabled and offers recovery',async()=>{
  const h=harness(async()=>{throw Error('network')});
  await h.context.checkAvailability({},new AbortController().signal,1);
  assert.equal(h.attrs.has('href'),false);assert.equal(h.button.textContent,'暂无片源');
  assert.equal(h.notes[0].children[1].textContent,'重新查找');
});
test('navigation cancellation cannot enable the old playback link',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve}));const controller=new AbortController();
  const task=h.context.checkAvailability({lines:[{}]},controller.signal,1);
  controller.abort();finish();await task;
  assert.equal(h.attrs.has('href'),false);
});
test('confirmed missing source has only a short label',async()=>{
 const h=harness(async()=>{throw Object.assign(Error('missing'),{code:'no_result'})});
 await h.context.checkAvailability({},new AbortController().signal,1);
 assert.equal(h.button.textContent,'暂无片源');assert.equal(h.notes[0].textContent,'');assert.equal(h.notes[0].children[1].textContent,'重新查找');
});

test('manual retry is consumed once per film and bypasses negative cache',async()=>{
 const calls=[];const h=harness(async(...args)=>{calls.push(args);throw Object.assign(Error('missing'),{code:'no_result'});});
 const film={id:'a'},signal=new AbortController().signal;
 await h.context.checkAvailability(film,signal,1);
 h.notes[0].children[1].retry();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls.length,2);assert.equal(calls[1][2],true);
 assert.equal(h.context.sourceRetryUsed(film),true);
 assert.equal(h.context.consumeSourceRetry(film),false);
 assert.equal(h.context.sourceRetryUsed({id:'b'}),false);
 assert.equal(h.notes[1].children[1].disabled,true);
 await h.context.checkAvailability(film,signal,1);
 assert.equal(h.notes[2].children[1].disabled,true);
 h.storage.sourceRetryDays.a='2000-1-1';
 assert.equal(h.context.sourceRetryUsed(film),false);
});

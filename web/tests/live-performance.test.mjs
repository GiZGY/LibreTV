import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../live-data.js',import.meta.url),'utf8');
function runtime(fetch,storage=new Map()){
 const context={window:{},URL,AbortSignal,AbortController,DOMException,setTimeout,clearTimeout,fetch,
 localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
 ProxyAuth:{addAuthToProxyUrl:async url=>url},API_SITES:{a:{api:'https://a.example/api'},b:{api:'https://b.example/api'},c:{api:'https://c.example/api'}},
 OpenStreamSourceAdapter:{isBridgeSource:()=>false,isLoginRequiredUrl:()=>false,isLoginRequiredSource:()=>false}};
 vm.runInNewContext(source,context);return context.window.LiveData;
}
const ok=data=>({ok:true,status:200,json:async()=>data});
const url='https://movie.douban.com/j/new_search_subjects?tags=电影&start=0';
test('Douban concurrent consumers share work, cancellation does not restart it, reload uses cache',async()=>{
 let calls=0,finish;const storage=new Map();
 const data=runtime(async()=>{calls++;return new Promise(resolve=>finish=()=>resolve(ok({data:[{title:'电影'}]})));},storage);
 const controller=new AbortController();
 const first=data.proxied(url,controller.signal);const second=data.proxied(url);
 const rejected=assert.rejects(first);controller.abort();
 await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls,1);finish();
 await rejected;assert.equal((await second).data.length,1);
 await data.proxied(url);assert.equal(calls,1);
 const reloaded=runtime(()=>{throw new Error('Unexpected upstream request');},storage);
 assert.equal((await reloaded.proxied(url)).data.length,1);
});
test('business rate-limit errors are not cached and requests enter cooldown',async()=>{
 let calls=0;const storage=new Map();
 const data=runtime(async()=>{calls++;return ok({r:1,msg:'异常请求，请登录'});},storage);
 await assert.rejects(data.proxied(url),/限制/);
 await assert.rejects(data.proxied(url),/限制/);
 assert.equal(calls,1);assert.equal(storage.has('openstream_douban_data_v1'),false);
});
test('detail races bounded sources and cancels a slow loser',async()=>{
 let aborted=false,active=0,peak=0;
 const data=runtime(async(target,{signal})=>{
  active++;peak=Math.max(peak,active);
  const upstream=decodeURIComponent(target.slice('/proxy/'.length));
  if(upstream.includes('a.example'))return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;active--;reject(signal.reason);},{once:true}));
  active--;return ok({list:[{vod_id:1,vod_name:'电影',vod_play_url:'正片$https://media.example/a.m3u8'}]});
 });
 const result=await data.firstDetail(['a','b','c'].map(source_code=>({source_code,vod_id:1})));
 assert.equal(result.lines.length,1);assert.equal(aborted,true);assert.ok(peak<=3);
});
test('commentary is excluded without hiding real titles containing 解说',()=>{
 const data=runtime(()=>{});
 for(const item of [{type_name:'电影解说'},{vod_name:'星际穿越【解说】'},{vod_class:'影视解说'}])assert.equal(data.allowed(item),false);
 assert.equal(data.allowed({vod_name:'解说员',type_name:'剧情片'}),true);
});
test('7.0 inclusive rating threshold',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const code=app.match(/function scoreClass\(value\)\{[^\n]+/)[0];
 const context={};vm.runInNewContext(code,context);
 assert.equal(context.scoreClass(7),'score-high');assert.equal(context.scoreClass(6.9),'score-neutral');assert.equal(context.scoreClass(5),'score-neutral');
});

test('expired catalog remains visible when its background refresh is limited',async()=>{
 const storage=new Map([['openstream_douban_data_v1',JSON.stringify([[url,{expires:Date.now()-1000,data:{data:[{title:'已缓存影片'}]}}]])]]);
 let calls=0;
 const data=runtime(async()=>{calls++;return {ok:false,status:429};},storage);
 assert.equal((await data.proxied(url)).data[0].title,'已缓存影片');
 await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(calls,1);
 assert.equal((await data.proxied(url)).data.length,1);
 const reloaded=runtime(()=>{throw Error('cooldown must survive refresh');},storage);
 await assert.rejects(reloaded.proxied(url+'&start=20'),/限制/);
});
test('pagination uses upstream length rather than filtered length and never invents a total',async()=>{
 const data=runtime(async()=>ok({data:Array.from({length:20},(_,i)=>({title:i===0?'电影解说':'电影'+i}))}));
 const result=await data.discover({type:'电影',genre:'全部',year:'全部',sort:'精选',page:1});
 assert.equal(result.items.length,19);assert.equal(result.rawCount,20);assert.equal(result.hasNext,true);assert.equal(result.total,null);
});
test('cancelled queued filters do not fetch upstream',async()=>{
 let calls=0;const data=runtime(async()=>{calls++;return ok({data:[]});});
 const controller=new AbortController();
 const task=data.proxied(url,controller.signal);controller.abort();
 await assert.rejects(task);await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls,0);
});

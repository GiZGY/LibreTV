import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const context={window:{},crypto:webcrypto,URL,AbortSignal,API_SITES:{good:{name:'Good',api:'https://example.com/api'},adult:{adult:true}},OpenStreamSourceAdapter:{isLoginRequiredUrl:url=>url.includes('pan.quark.cn'),isLoginRequiredSource:()=>false}};
vm.runInNewContext(readFileSync(new URL('../live-data.js',import.meta.url),'utf8'),context);
const data=context.window.LiveData;
test('TMDB consumers share a request and cancellation does not cancel other consumers',async()=>{
 let calls=0,release;
 const ctx={...context,URLSearchParams,window:{},fetch:async()=>{calls++;await new Promise(resolve=>release=resolve);return{ok:true,status:200,json:async()=>({filtered:true,items:[],total:0})};}};
 vm.runInNewContext(readFileSync(new URL('../live-data.js',import.meta.url),'utf8'),ctx);
 const controller=new AbortController();
 const params={type:'电影',genre:'全部',year:'2024',sort:'精选',page:1};
 const first=ctx.window.LiveData.discoverTMDB({...params,signal:controller.signal});
 const second=ctx.window.LiveData.discoverTMDB(params);
 const rejected=assert.rejects(first);controller.abort();release();await rejected;await second;
 await ctx.window.LiveData.discoverTMDB(params);assert.equal(calls,1);
});
test('CMS detail retains independent flags and episode labels',()=>{
 const lines=data.parseLines({vod_id:10,vod_play_from:'HD$$$SD',vod_play_url:'第一集$https://media.example/a.m3u8#第二集$https://media.example/b.m3u8$$$正片$https://media.example/a.mp4'},'good');
 assert.equal(lines.length,2);assert.equal(lines[0].episodes.length,2);assert.equal(lines[0].episodes[1].name,'第二集');assert.equal(lines[1].flag,'SD');
});
test('rejects executable URLs and login-only netdisk episodes',()=>{
 assert.equal(data.safeURL('javascript:alert(1)'),'');
 assert.equal(data.parseLines({vod_play_url:'广告$javascript:alert(1)#网盘$https://pan.quark.cn/s/test'},'good').length,0);
 assert.equal(data.allowed({type_name:'伦理片'}),false);
 assert.equal(data.sources().includes('adult'),false);
});
test('missing episode cannot silently play first episode',async()=>{
 await assert.rejects(data.resolveEpisode({episodes:[{url:'https://example.com/1.mp4'}],sourceKey:'good'},4),/没有当前集/);
});
test('rejects internal media targets and credential-bearing URLs',()=>{
 for(const url of ['http://127.0.0.1/a.mp4','http://192.168.1.1/a.mp4','http://10.1.2.3/a.mp4','http://172.16.0.1/a.mp4','http://[::1]/a.mp4','https://u:p@example.com/a.mp4'])assert.equal(data.safeURL(url),'');
});
test('global discovery policy requires a Chinese title, keeps unrated and excludes rated below five',()=>{
 for(const score of ['',null,undefined,'暂无评分','0','5','6.5'])assert.equal(data.allowed({title:'测试影片',rate:score}),true,String(score));
 for(const score of ['4.9','1','3.2'])assert.equal(data.allowed({title:'测试影片',rate:score}),false);
 for(const title of ['English Film','ภาพยนตร์','日本の映画','한국 영화'])assert.equal(data.allowed({title,rate:'8'}),false);
 assert.equal(data.allowed({title:'星际穿越 Interstellar',rate:'8'}),true);
 assert.equal(data.allowed({name:'旧收藏',rating:'4.5'}),false);
});

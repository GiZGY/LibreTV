import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const code=fs.readFileSync(new URL('../../js/streaming-search.js',import.meta.url),'utf8');
function harness(search){const context={performance,AbortController,AbortSignal,setTimeout,clearTimeout};context.window={OpenStreamSourceAdapter:{search},OpenStreamSourceHealth:{getSearchPlan:keys=>keys.map(sourceKey=>({sourceKey,tier:"B",score:0})),SOURCE_STATUS:{READY:'ready',NO_RESULT:'no_result',ERROR:'error',TIMEOUT:'timeout'},recordSourceEvent(){}}};vm.runInNewContext(code,context);return context.window.OpenStreamStreamingSearch;}
const config={totalBudgetMs:80,sourceConcurrency:2,sourceMaxConcurrency:2,tierTimeoutMs:{B:10},recoveryTimeoutMs:100};
test('slow failed first requests recover with at most two extra source probes',async()=>{
 const counts={};const api=harness(async(key,_q,_f,{signal})=>{counts[key]=(counts[key]||0)+1;await new Promise((resolve,reject)=>{const t=setTimeout(resolve,35);signal.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason);},{once:true});});return {status:'ready',list:[{vod_id:key,vod_name:'电影',source_code:key}]};});
 const result=await api.runStreamingSearch({sources:['a','b','c'],query:'电影',config});assert.equal(result.results.length,2);assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),5);
});
test('confirmed empty results are not retried',async()=>{let calls=0;const api=harness(async()=>{calls++;return {status:'no_result',list:[]};});await api.runStreamingSearch({sources:['a','b'],query:'电影',config});assert.equal(calls,2);});

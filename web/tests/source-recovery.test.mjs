import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
test('all failed sources get two bounded probes without clearing user data',()=>{
 const now=Date.now(),sources=Object.fromEntries(['a','b','c'].map(key=>[key,{status:'dead',consecutiveFailure:8,updatedAt:now}]));
 sources.d={status:'unplayable',updatedAt:now};
 const storage=new Map([['openstreamSourceHealth',JSON.stringify({version:1,sources})],['favorites','preserved']]);
 const window={API_SITES:{},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(new URL('../../js/source-health.js',import.meta.url),'utf8'),{window,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout,clearTimeout,Date});
 const h=window.OpenStreamSourceHealth,keys=['a','b','c','d'];assert.equal(h.getSearchPlan(keys).length,0);
 h.recoverSearchFailures(keys);assert.equal(h.getSearchPlan(keys).length,2);h.recoverSearchFailures(keys);assert.equal(h.getSearchPlan(keys).length,2);
 assert.equal(h.getSourceStatus('d'),'unplayable');assert.equal(storage.get('favorites'),'preserved');
});

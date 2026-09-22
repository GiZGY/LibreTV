import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const live=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
test('history groups respect local calendar boundaries and unknown dates stay older',()=>{
 const context=vm.createContext({});
 vm.runInContext(app.slice(app.indexOf('function historyBucket('),app.indexOf('function historyRow(')),context);
 const now=new Date(2026,8,22,12);
 const bucket=(day)=>context.historyBucket({watchedAt:new Date(2026,8,day,10).toISOString()},now);
 assert.equal(bucket(22),'今天');assert.equal(bucket(21),'昨天');assert.equal(bucket(16),'近 7 天');assert.equal(bucket(15),'7 天以前');
 assert.equal(context.historyBucket({},now),'7 天以前');
});
test('history is progressively disclosed and route restoration waits for content',()=>{
 assert.match(app,/historyOlderOpen=false,historyOlderLimit=20/);
 assert.match(app,/rows.slice\(0,historyOlderLimit\)/);
 assert.match(app,/historyOlderLimit\+=20/);
 assert.match(app,/try\{await render\(\);\}finally/);
 assert.match(live,/if\(retained\).*aria-busy/);
 assert.match(live,/filters=JSON.parse\(previous.condition\)\[1\]/);
 assert.match(live,/shelfPositions.set\(shelf.dataset.shelfKey,shelf.scrollLeft\)/);
 assert.match(live,/recentSearchViews.size>8/);
});

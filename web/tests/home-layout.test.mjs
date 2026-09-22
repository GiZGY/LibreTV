import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
test('home shelves stay at two rows and retain overflow titles',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/grid-template-rows:repeat\(2,auto\);grid-auto-flow:column/);
 assert.match(css,/overflow-x:auto/);
 assert.doesNotMatch(source,/homeGridColumns|scheduleHomeLayout/);
});
test('foreground and prefetch share one request and cache genre data',async()=>{
 let calls=0;
 const context=vm.createContext({recommendations:new Map(),AbortSignal,register:item=>item,data:{discoverTMDB:async()=>{calls++;return {items:[{id:'one'}]}}}});
 vm.runInContext(source.slice(source.indexOf('  const homeGenreTasks='),source.indexOf('  function prefetchHomeGenres(')),context);
 await Promise.all([context.loadHomeGenre('科幻'),context.loadHomeGenre('科幻')]);
 await context.loadHomeGenre('科幻');assert.equal(calls,1);
});
test('prefetch has save-data, slow-network and route cancellation guards',()=>{
 const fn=source.slice(source.indexOf('  function prefetchHomeGenres('),source.indexOf('  const discoveryLastSuccess'));
 assert.match(fn,/connection\?\.saveData/);assert.match(fn,/signal.aborted/);assert.match(fn,/await loadHomeGenre\(genre\)/);
});
test('all home genres use the same twenty-title shelf limit',()=>{
 assert.match(source,/rest=homeRecommendations\(\)/);
 assert.match(source,/grid\(homeRecommendations\(\)\)/);
 assert.match(source,/grid\(entry\.items\.filter\(f=>Number\(f\.rating\)>=6\.5&&!featured\.has\(f\.id\)\)\.slice\(0,20\)\)/);
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/grid-auto-columns:clamp\(165px,12vw,220px\)/);
});

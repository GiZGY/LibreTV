import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../film-metadata.js',import.meta.url),'utf8'),context);
const {merge,related}=context.window.FilmMetadata;
test('blank source updates never erase known year or genres',()=>{
 const value=merge({vod_year:'',vod_class:''},{year:'2024',genre:'科幻 / 冒险'});
 assert.equal(value.year,'2024');assert.equal(value.genre,'科幻 / 冒险');
 assert.equal(merge({year:'2023-10-02',genres:['剧情','喜剧']}).genre,'剧情 / 喜剧');
 assert.equal(merge({types:['剧情'],release_year:'1999'}).year,'1999');
});
test('related titles depend on film genres, not insertion order',()=>{
 const list=[{id:'a',name:'科幻一',type:'电影',genre:'科幻',year:'2024'},{id:'b',name:'爱情一',type:'电影',genre:'爱情',year:'2024'},{id:'c',name:'科幻剧',type:'电视剧',genre:'科幻',year:'2024'}];
 assert.equal(related({id:'x',name:'目标',type:'电影',genre:'科幻'},list)[0].id,'a');
 assert.equal(related({id:'y',name:'目标',type:'电影',genre:'爱情'},list)[0].id,'b');
 assert.equal(related(list[0],list).length,0);
});

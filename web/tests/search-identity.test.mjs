import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../../js/result-aggregator.js',import.meta.url),'utf8'),context);const aggregate=context.window.OpenStreamResultAggregator;
const item=(source,name='中文作品',year='2024',extra={})=>({vod_id:1,source_code:source,vod_name:name,vod_year:year,type_name:'电视剧',...extra});
test('same work season and version combines sources, unlike year and season stay independent',()=>{const results=aggregate.aggregateResults([item('a','中文作品第一季'),item('b','中文作品第一季'),item('c','中文作品第二季'),item('d','中文作品第一季','2020')]);assert.equal(results.length,3);assert.equal(results.find(f=>f.source_count===2).vod_year,'2024');});
test('language and cut edition never silently absorb an unknown version',()=>{const results=aggregate.aggregateResults([item('a','中文作品国语'),item('b','中文作品粤语'),item('c','中文作品'),item('d','中文作品国语')]);assert.equal(results.length,3);assert.equal(results.find(f=>f.vod_name.includes('国语')).source_count,2);assert.notEqual(aggregate.getResultKey(item('a','中文作品加长版')),aggregate.getResultKey(item('b','中文作品院线版')));});
test('same-title ambiguous metadata and different directors are not merged',()=>{const results=aggregate.aggregateResults([item('a','中文作品','2024',{vod_director:'导演甲'}),item('b','中文作品','2024',{vod_director:'导演乙'}),item('c','中文作品','')]);assert.equal(results.length,3);});
test('ordinary identities retain their previous persistent key',()=>{const value=item('a');assert.equal(aggregate.getResultKey(value),aggregate.getLegacyResultKey(value));assert.equal(aggregate.getSeason(item('a','中文作品第二季')),'2');});

test('source tombstones yield to a real cover only within the same result',()=>{
 const missing=['https://p.bfvp26.com/upload/vod/20230619-1/9007664f78954ad2b459626a21ded7b2.png','https://ok.zuidapic.com/upload/vod/20230831-1/67793f92f86c83b19ea44e400a5d9f5e.png'];
 const base=missing.map((vod_pic,i)=>item('mirror'+i,'蜘蛛侠：平行宇宙2','2020',{vod_pic}));
 const newer=item('other','蜘蛛侠：平行宇宙2','2023',{vod_pic:'https://example.org/2023.jpg'});
 const get=items=>aggregate.aggregateResults(items).find(v=>v.vod_year==='2020');
 for(const row of base)assert.ok(aggregate.isUnavailablePoster(row.vod_pic));
 assert.ok(aggregate.isUnavailablePoster(get([...base,newer]).vod_pic));
 const same=item('third','蜘蛛侠：平行宇宙2','2020',{vod_pic:'https://example.org/2020.jpg'});
 for(const rows of [[...base,same,newer],[newer,same,...base]])assert.equal(get(rows).vod_pic,same.vod_pic);
});

test('shared work combines inconsistent CMS languages and credits, not cuts or remakes; conflicting source scores stay blank',()=>{
 const row=(s,lang,score,extra={})=>item(s,'蜘蛛侠：纵横宇宙','2023',{vod_douban_id:30391186,vod_director:'导演甲,导演乙',vod_lang:lang,vod_douban_score:score,...extra});
 const rows=[row('a','英语 / 他加禄语','8.5'),row('b','英语,他加禄语','8.3',{vod_director:'导演甲'}),row('c','其它','0')];
 const keys=[];
 for(const data of [rows,[...rows].reverse()]){
  const [work]=aggregate.aggregateResults(data);assert.equal(work.source_count,3);assert.equal(work.vod_douban_score,'');assert.equal(work.score_conflict,true);
  assert.deepEqual([...work.work_languages].sort(),['他加禄语','英语']);keys.push(aggregate.getResultKey(work));
 }
 assert.equal(keys[0],keys[1]);
 for(const extra of [{vod_name:'蜘蛛侠：纵横宇宙加长版'},{vod_name:'蜘蛛侠：纵横宇宙国语'},{vod_year:'2020'},{vod_douban_id:12345678}]){
  assert.equal(aggregate.aggregateResults([...rows,row('d','英语','7',extra)]).length,2);
 }
});

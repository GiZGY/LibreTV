import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../../js/content-kind.cjs';
import {catalogItemAllowed} from '../../server/filtered-catalog.mjs';
test('only positive trailer evidence excludes a feature from the catalogue',()=>{
 for(const title of ['预告犯','死亡预告','终极预告','预告片制作人']){
   const f={title,type_name:'电影',vod_content:'观看官方预告片'};assert.ok(!policy.trailerItem(f));assert.ok(catalogItemAllowed(f));
 }
 for(const f of [{title:'预告犯【预告片】'},{title:'预告犯',type_name:'预告片'},{title:'影片 中文版预告片'},{title:'影片 Official Trailer'},{title:'某片',vod_remarks:'預告片'}]){
   assert.ok(policy.trailerItem(f));assert.ok(!catalogItemAllowed(f));
 }
 for(const label of ['预告','第12集预告','S02E03預告','Official Trailer','预告片'])assert.ok(policy.trailerEpisode(label));
 for(const label of ['预告犯','死亡预告','第12集','正片','番外'])assert.ok(!policy.trailerEpisode(label));
});

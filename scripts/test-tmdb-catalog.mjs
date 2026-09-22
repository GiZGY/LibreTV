import test from 'node:test';import assert from 'node:assert/strict';
import {catalogQuery,normalizeCatalog,normalizeDetail,createCatalogService} from '../server/tmdb-catalog.mjs';
test('detail includes genres, overview and credits without playback sources',()=>{
 const parsed=catalogQuery({kind:'detail',id:'movie:1'});
  assert.equal(parsed.url.pathname,'/3/movie/1');assert.equal(parsed.url.searchParams.get('append_to_response'),'credits,translations,release_dates');
 const {item}=normalizeDetail({id:1,title:'Film',release_date:'2024-01-01',overview:'Story',genres:[{id:878}],credits:{crew:[{name:'Director',job:'Director'}],cast:[{name:'Actor'}]}},parsed);
 assert.equal(item.vod_director,'Director');assert.equal(item.vod_actor,'Actor');assert.equal(item.vod_content,'Story');assert.equal(item.year,'2024');assert.deepEqual(item.genres,['科幻']);
 assert.throws(()=>catalogQuery({kind:'detail',id:'movie:../1'}));
});
test('shared cache crosses service instances and coalesces 100 local requests',async()=>{
 const store=new Map();let calls=0;
 const options={env:()=>({TMDB_READ_ACCESS_TOKEN:'test'}),sharedCache:{get:async key=>store.get(key),set:async(key,value)=>store.set(key,value)},fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({results:[],total_pages:0,total_results:0})};}};
 const first=createCatalogService(options);await Promise.all(Array.from({length:100},()=>first({year:'2024'})));
 assert.equal(calls,1);
 await createCatalogService(options)({year:'2024'});assert.equal(calls,1);
 await createCatalogService(options)({year:'2023'});assert.equal(calls,2);
});
test('shared cache outage falls back without caching upstream failures',async()=>{
 const service=createCatalogService({env:()=>({TMDB_READ_ACCESS_TOKEN:'test'}),sharedCache:{get:async()=>{throw Error('unavailable')},set:async()=>{throw Error('unavailable')}},fetchImpl:async()=>({ok:true,json:async()=>({results:[],total_pages:0,total_results:0})})});
 assert.equal((await service({})).total,0);
});
test('fixed endpoint, filter mapping, page limits',()=>{
 const q=catalogQuery({type:'电影',year:'2024',genre:'悬疑',sort:'评分最高',page:'2'});
 assert.equal(q.url.hostname,'api.themoviedb.org');assert.equal(q.url.searchParams.get('primary_release_year'),'2024');assert.equal(q.url.searchParams.get('include_adult'),'false');
 assert.throws(()=>catalogQuery({page:501}));assert.throws(()=>catalogQuery({genre:'https://127.0.0.1'}));
 assert.equal(catalogQuery({type:'动漫'}).url.searchParams.get('with_genres'),'16');
});
test('related catalog is title-specific and cannot target arbitrary paths',()=>{
 assert.equal(catalogQuery({kind:'related',id:'movie:123'}).url.pathname,'/3/movie/123/recommendations');
 assert.equal(catalogQuery({kind:'related',id:'tv:123'}).url.pathname,'/3/tv/123/recommendations');
 for(const id of ['https://localhost','movie:../1','person:1','movie:0'])assert.throws(()=>catalogQuery({kind:'related',id}));
});
test('high-score selection filters upstream so totals and pages use the same criteria',()=>{
 for(const type of ['电影','电视剧']){
  const params=catalogQuery({type,sort:'评分最高'}).url.searchParams;
  assert.equal(params.get('sort_by'),'vote_average.desc');
  assert.equal(params.get('vote_average.gte'),'6.5');
  assert.equal(params.get('vote_count.gte'),'50');
 }
 for(const sort of ['精选','最新上映']){
  const params=catalogQuery({sort}).url.searchParams;
  assert.equal(params.has('vote_average.gte'),false);
  assert.equal(params.get('vote_count.gte'),sort==='最新上映'?'20':null);
 }
});
test('catalog includes actual release year and translated genre ids',()=>{
 const r=normalizeCatalog({results:[{id:1,title:'Film',release_date:'2024-09-10',genre_ids:[878,12]}],total_pages:1,total_results:1},{type:'电影',media:'movie',page:1});
 assert.equal(r.items[0].year,'2024');assert.deepEqual(r.items[0].genres,['科幻','冒险']);
});
test('total pages capped and movie/tv identities separated',()=>{
 const r=normalizeCatalog({results:[{id:1,title:'示例',poster_path:'/x.jpg',vote_count:5,vote_average:8}],total_pages:800,total_results:16000},{type:'电影',media:'movie',page:1});
 assert.equal(r.totalPages,500);assert.equal(r.capped,true);assert.equal(r.items[0].id,'movie:1');assert.equal(r.items[0].rating_source,'TMDB');
});
test('missing credentials never fetch; requests coalesce and secret stays server-side',async()=>{
 let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer test-only');return {ok:true,status:200,json:async()=>({results:[],total_pages:0,total_results:0})};};
 await assert.rejects(createCatalogService({fetchImpl,env:()=>({})})({}),{status:503});assert.equal(calls,0);
 const service=createCatalogService({fetchImpl,env:()=>({TMDB_READ_ACCESS_TOKEN:'test-only'})});
 const result=await Promise.all([service({}),service({})]);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('test-only'));await service({});assert.equal(calls,1);
});
test('upstream failures are explicit and not cached as empty results',async()=>{
 let calls=0;const service=createCatalogService({env:()=>({TMDB_READ_ACCESS_TOKEN:'test-only'}),fetchImpl:async()=>{calls++;return {status:429,ok:false};}});
 await assert.rejects(service({}),{status:429});await assert.rejects(service({}),{status:429});assert.equal(calls,1);
});
test('last page stops navigation and empty catalog is explicit',()=>{
 const last=normalizeCatalog({results:[{id:1,title:'Last'}],total_pages:2,total_results:21},{type:'电影',media:'movie',page:2});
 assert.equal(last.hasNext,false);assert.equal(last.totalPages,2);
 const empty=normalizeCatalog({results:[],total_pages:0,total_results:0},{type:'电影',media:'movie',page:1});
 assert.equal(empty.hasNext,false);assert.equal(empty.total,0);
});
test('network failure does not poison cache and can recover',async()=>{
 let calls=0;
 const service=createCatalogService({env:()=>({TMDB_READ_ACCESS_TOKEN:'test-only'}),fetchImpl:async()=>{
  if(++calls===1)throw new Error('network failure');
  return {ok:true,status:200,json:async()=>({results:[],total_pages:0,total_results:0})};
 }});
 await assert.rejects(service({}),{status:504});
 assert.equal((await service({})).total,0);assert.equal(calls,2);
});
test('Chinese translations take precedence over English fallback',()=>{
 const parsed=catalogQuery({kind:'detail',id:'movie:1'});
 const raw={id:1,title:'English',original_title:'English',translations:{translations:[{iso_639_1:'zh',iso_3166_1:'CN',data:{title:'中文片名'}}]}};
 assert.equal(normalizeDetail(raw,parsed).item.title,'中文片名');
 assert.equal(normalizeDetail({...raw,translations:undefined},parsed).item.title,'English');
 assert.equal(normalizeDetail({...raw,title:'已有中文'},parsed).item.title,'已有中文');
});
test('regions filter origin countries independently from language and release region',()=>{
 for(const type of ['电影','电视剧','动漫','综艺']){
  const params=catalogQuery({type,region:'日本',year:'2024',genre:'全部',page:2}).url.searchParams;
  assert.equal(params.get('with_origin_country'),'JP');assert.equal(params.get('page'),'2');
  assert.equal(params.has('region'),false);assert.equal(params.get('language'),'zh-CN');
 }
 assert.equal(catalogQuery({}).url.searchParams.has('with_origin_country'),false);
 assert.equal(catalogQuery({region:'中国香港'}).url.searchParams.get('with_origin_country'),'HK');
 assert.throws(()=>catalogQuery({region:'invalid'}));
 assert.notEqual(catalogQuery({region:'美国'}).url.href,catalogQuery({region:'英国'}).url.href);
});
test('movie certificates use explicit US data, not inferred ratings or TV labels',()=>{
 const raw={id:1,title:'测试',release_dates:{results:[{iso_3166_1:'GB',release_dates:[{certification:'15',type:3}]},{iso_3166_1:'US',release_dates:[{certification:'R',type:3}]}]}};
 assert.deepEqual(normalizeDetail(raw,catalogQuery({kind:'detail',id:'movie:1'})).item.certification,{label:'R',country:'US'});
 assert.equal(normalizeDetail(raw,catalogQuery({kind:'detail',id:'tv:1'})).item.certification,undefined);
 assert.equal(normalizeDetail({id:1,title:'测试'},catalogQuery({kind:'detail',id:'movie:1'})).item.certification,undefined);
});
test('documentaries have their own category and are excluded upstream from movies',()=>{
 const movie=catalogQuery({type:'电影'}).url;
 assert.equal(movie.searchParams.get('without_genres'),'99');
 const docs=catalogQuery({type:'纪录片',genre:'历史',region:'日本',year:'2024'}).url;
 assert.equal(docs.pathname,'/3/discover/movie');
 assert.equal(docs.searchParams.get('with_genres'),'99,36');
 assert.equal(docs.searchParams.get('without_genres'),null);
 assert.equal(docs.searchParams.get('with_origin_country'),'JP');
});
test('latest filters translated titles and vote counts upstream without restricting original language',()=>{
 for(const type of ['电影','纪录片','电视剧','动漫','综艺']){
  const p=catalogQuery({type,sort:'最新上映',region:'泰国'}).url.searchParams;
  const movie=['电影','纪录片'].includes(type);
  assert.equal(p.get('vote_count.gte'),'20');
  assert.equal(p.get(movie?'with_title_translation':'with_name_translation'),'zh-CN');
  assert.equal(p.get('sort_by'),movie?'primary_release_date.desc':'first_air_date.desc');
  assert.equal(p.get('with_origin_country'),'TH');assert.equal(p.has('with_original_language'),false);
 }
 assert.equal(catalogQuery({sort:'精选'}).url.searchParams.has('vote_count.gte'),false);
 assert.equal(catalogQuery({sort:'评分最高'}).url.searchParams.get('vote_count.gte'),'50');
});
test('home rating floor is applied upstream without changing normal discovery',()=>{
 assert.equal(catalogQuery({minRating:'6.5'}).url.searchParams.get('vote_average.gte'),'6.5');
 assert.equal(catalogQuery({minRating:'7'}).url.searchParams.get('vote_average.gte'),'7');
 assert.equal(catalogQuery({}).url.searchParams.has('vote_average.gte'),false);
 assert.throws(()=>catalogQuery({minRating:'garbage'}));
});
test('filtered opt-in preserves legacy API and uses logical 40-item pages',async()=>{
 const service=createCatalogService({env:()=>({TMDB_READ_ACCESS_TOKEN:'test'}),fetchImpl:async url=>{
  const page=Number(url.searchParams.get('page'));return {ok:true,json:async()=>({results:Array.from({length:20},(_,i)=>({id:(page-1)*20+i+1,title:'影片'+((page-1)*20+i+1),vote_count:10,vote_average:i===0?4:7})),total_pages:4,total_results:80})};
 }});
 const raw=await service({kind:'discover',page:'1'});assert.equal(raw.items.length,20);assert.equal(raw.filtered,undefined);
 const first=await service({kind:'discover',filtered:'1',page:'1',pageSize:'40',snapshot:'test-session'});
 const second=await service({kind:'discover',filtered:'1',page:'2',pageSize:'40',snapshot:'test-session'});
 assert.equal(first.items.length,40);assert.equal(second.items.length,36);assert.equal(second.hasNext,false);
 assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,76);
});

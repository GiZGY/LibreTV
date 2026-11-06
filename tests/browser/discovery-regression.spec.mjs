import {test,expect} from '@playwright/test';

const chip=(page,key,value)=>page.locator(`button[data-filter="${key}"][data-value="${value}"]`);
test('discover keeps the requested filters on failure and retries them; late results cannot replace newer choices',async({page})=>{
 let first=true,release;const slow=new Promise(resolve=>{release=resolve});
 await page.route('**/api/catalog/tmdb?**',async route=>{
  const q=new URL(route.request().url()).searchParams;
  const genre=q.get('genre'),type=q.get('type');
  if(genre==='犯罪'&&first){first=false;return route.fulfill({status:503,json:{message:'稍后再试'}});}
  if(genre==='悬疑')await slow;
  const id=genre==='全部'?1:genre==='犯罪'?2:3;
  return route.fulfill({json:{indexed:true,filtered:true,rawCount:1,items:[{provider:'tmdb',id,title:type+genre,year:'2022'}],total:1,totalPages:1,hasNext:false}});
 });
 await page.goto('/#discover');
 const cards=page.locator('#discovery-cards');
 await expect(cards.getByRole('heading',{name:'电影全部'})).toBeVisible();
 await chip(page,'genre','犯罪').click();await expect(cards.getByRole('button',{name:'重试'})).toBeVisible();
 await expect(chip(page,'genre','犯罪')).toHaveAttribute('aria-pressed','true');
 await expect(cards.getByText('电影全部')).toHaveCount(0);
 await cards.getByRole('button',{name:'重试'}).click();await expect(cards.getByRole('heading',{name:'电影犯罪'})).toBeVisible();
 const pending=page.waitForRequest(r=>new URL(r.url()).searchParams.get('genre')==='悬疑');await chip(page,'genre','悬疑').click();await pending;
 await chip(page,'genre','剧情').click();await expect(cards.getByRole('heading',{name:'电影剧情'})).toBeVisible();
 const finished=page.waitForResponse(r=>new URL(r.url()).searchParams.get('genre')==='悬疑');release();await finished;
 await expect(cards.getByRole('heading',{name:'电影剧情'})).toBeVisible();await expect(chip(page,'genre','剧情')).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(cards.getByRole('heading',{name:'电影剧情'})).toBeVisible();
 await page.getByRole('button',{name:'重置筛选'}).click();await expect(cards.getByRole('heading',{name:'电影全部'})).toBeVisible();
});

test('later exact search titles go first without replacing the focused card, and its visible year updates',async({page})=>{
 await page.goto('/#discover');
 await page.evaluate(()=>{
  window.OpenStreamStreamingSearch.runStreamingSearch=async opts=>{
   const partial={vod_id:9,vod_name:'星河外传',source_code:'a',type_name:'电影'};
   opts.onUpdate({results:[partial]});
   await new Promise(resolve=>window.deliverNextSearchBatch=resolve);
   opts.onSourceDone({status:'ready'});
   return{results:[{...partial,vod_year:'2022'},{...partial,vod_id:10,vod_name:'星河',vod_year:'2020'}]};
  };location.hash='search/'+encodeURIComponent('星河');
 });
 const titles=page.locator('#live-results h3');
 await expect(titles).toHaveText(['星河外传']);
 const original=page.getByRole('link',{name:/星河外传/});await original.focus();
 await page.evaluate(()=>window.deliverNextSearchBatch());
 await expect(titles).toHaveText(['星河','星河外传']);await expect(original).toBeFocused();
 await expect(original.locator('.poster-meta')).toContainText('2022');
});

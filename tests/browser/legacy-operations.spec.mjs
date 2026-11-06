import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function seed(page){await page.addInitScript(()=>{if(localStorage.getItem('legacy-review-seeded'))return;const p='openstream_live_',film=(id,name)=>({id,name,type:'电影',episodes:1,seasons:1,year:2024,genre:'剧情',rating:8,length:'60秒',director:'—',cast:'—',description:'',cover:'',candidatesComplete:true,lines:[{key:id+':line',sourceKey:'qa',name:'测试线路',health:'fast',episodes:[{name:'正片',url:'/media/sample.mp4?f='+id}]}]});localStorage.setItem(p+'filmRecords',JSON.stringify([film('film-review-a','审查甲'),film('film-review-b','审查乙')]));localStorage.setItem(p+'favorites',JSON.stringify(['film-review-a','film-review-b']));localStorage.setItem(p+'history',JSON.stringify(['film-review-a','film-review-b']));localStorage.setItem(p+'historyMetadataV2',JSON.stringify(Object.fromEntries(['film-review-a','film-review-b'].map((id,i)=>[id,{position:10+i,duration:60,episode:1,season:1,watchedAt:'2026-11-06T00:00:00Z'}]))));localStorage.setItem(p+'recentQueries',JSON.stringify(['审查']));localStorage.setItem(p+'darkMode','false');localStorage.setItem(p+'mobileAutoTheme','false');localStorage.setItem(p+'availabilityRecoveryV1','true');localStorage.setItem(p+'muted','true');localStorage.setItem('legacy-review-seeded','true');});}
async function preference(page){await page.getByRole('button',{name:'偏好设置',exact:true}).click();await expect(page.locator('#settings')).toBeVisible();}

test('existing manual theme, preference state, reload and navigation controls remain coherent',async({page})=>{
 await seed(page);await page.goto('/#home');await page.locator('.theme-toggle').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await preference(page);await expect(page.locator('#dark-mode')).toBeChecked();await page.locator('#dark-mode').uncheck();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.keyboard.press('Escape');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.locator('.nav-toggle').click();await expect(page.locator('.nav-toggle')).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(page.locator('.nav-toggle')).toHaveAttribute('aria-expanded','false');for(const route of ['library','history','home']){await page.locator(`.sidebar nav a[href="#${route}"]`).click();await expect(page).toHaveURL(new RegExp('#'+route+'$'));await expect(page.locator(`.sidebar nav a[href="#${route}"]`)).toHaveClass(/active/);}
});

test('existing favorite and history removal, clear, undo and reload preserve their records',async({page})=>{
 await seed(page);await page.goto('/#library');await expect(page.locator('.watchlist-item')).toHaveCount(2);await page.locator('.watchlist-item [data-action=favorite]').first().click();await expect(page.locator('.watchlist-item')).toHaveCount(1);await page.locator('[data-action=undo-favorite]').click();await expect(page.locator('.watchlist-item')).toHaveCount(2);
 await page.goto('/#history');await expect(page.locator('.history-item')).toHaveCount(2);await page.locator('[data-action=remove-history]').first().click();await expect(page.locator('.history-item')).toHaveCount(1);await page.locator('[data-action=undo]').click();await expect(page.locator('.history-item')).toHaveCount(2);page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action=clear-history]').click();await expect(page.locator('.history-item')).toHaveCount(0);await page.locator('[data-action=undo]').click();await expect(page.locator('.history-item')).toHaveCount(2);await page.reload();await expect(page.locator('.history-item')).toHaveCount(2);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_favorites')).sort())).toEqual(['film-review-a','film-review-b']);
});

test('existing search shortcuts, recent terms, arrow selection, Enter and Escape retain their keyboard behavior',async({page})=>{
 await seed(page);await page.goto('/#home');await page.locator('#search').focus();await page.keyboard.press('Control+k');await expect(page.locator('#command')).toBeVisible();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.locator('#command-input')).toHaveValue('审查');await page.keyboard.press('Escape');await expect(page.locator('#command')).toBeHidden();await expect(page.locator('#search')).toBeFocused();
 await page.locator('.nav-toggle').focus();await page.keyboard.press('/');await expect(page.locator('#command')).toBeVisible();await page.locator('#command-input').fill('审查');await page.keyboard.press('ArrowDown');await expect(page.locator('#command-input')).toHaveAttribute('aria-activedescendant',/suggestion-/);await page.keyboard.press('ArrowUp');await expect(page.locator('[role=option][aria-selected=true]')).toHaveCount(1);await page.keyboard.press('Enter');await expect(page.locator('#command')).toBeHidden();await expect(page).toHaveURL(/#detail\/film-review-[ab]$/);await expect(page.locator('.detail-content h1')).toHaveText(/审查[甲乙]/);
});

test('backup import and recovery immediately reflect automatic theme in the existing controls',async({page})=>{
 await seed(page);await page.setViewportSize({width:390,height:844});await page.goto('/#home');await preference(page);await expect(page.locator('#auto-theme')).not.toBeChecked();const downloaded=page.waitForEvent('download');await page.locator('[data-backup-export]').click();const download=await downloaded,backup=JSON.parse(await readFile(await download.path(),'utf8'));expect(backup.data.favorites).toHaveLength(2);expect(JSON.stringify(backup)).not.toMatch(/cookie|token|lines/);backup.data.preferences.mobileAutoTheme=true;
 await page.locator('[data-backup-file]').setInputFiles({name:'review-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.locator('#backup-preview')).toBeVisible();await page.locator('[data-backup-confirm]').click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_mobileAutoTheme')))).toBe(true);await expect(page.locator('#auto-theme')).toBeChecked();await expect(page.locator('#dark-mode')).toBeDisabled();const hour=await page.evaluate(()=>new Date().getHours());await expect(page.locator('html')).toHaveAttribute('data-theme',hour<7||hour>=19?'dark':'light');page.once('dialog',dialog=>dialog.accept());await page.locator('[data-backup-restore]').click();await expect(page.locator('#auto-theme')).not.toBeChecked();await expect(page.locator('#dark-mode')).toBeEnabled();await expect(page.locator('html')).toHaveAttribute('data-theme','light');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('openstream_live_favorites')).length)).toBe(2);
});

test('a source-only title can be found from the search box even when catalogue suggestions fail',async({page})=>{
 const title='片源独有作品';
 await page.route('**/api/catalog/tmdb?kind=lookup*',route=>route.fulfill({status:503,body:'{}'}));
 await seed(page);await page.goto('/#home');
 await page.evaluate(()=>{window.OpenStreamStreamingSearch.runStreamingSearch=async({query,onUpdate,onSourceDone})=>{
   const results=[{vod_id:42,source_code:'qa',vod_name:query,type_name:'电影',vod_year:'2025'}];onSourceDone({status:'ready'});onUpdate({results});return {results};
 };});
 for(const byEnter of [true,false]){
   await page.locator('#search').click();const input=page.locator('#command-input');
   await expect(page.locator('#command-search-all')).toBeHidden();
   await input.fill(title);await expect(page.locator('#command-search-all')).toBeVisible();
   await expect(page.locator('#command')).not.toContainText('没有找到');
   if(byEnter){await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.locator('#command')).toBeVisible();await input.press('Enter');}
   else await page.locator('#command-search-all').click();
   await expect(page.locator('#live-results h3').first()).toHaveText(title);
 }
});

test('catalogue suggestions include unseen films, ignore superseded replies and open the chosen detail',async({page})=>{
 let release,started;const waiting=new Promise(r=>{release=r}),request=new Promise(r=>{started=r});
 await page.route('**/api/catalog/tmdb?kind=lookup*',async route=>{
   const params=new URL(route.request().url()).searchParams,title=params.get('title');
   if(title==='先前片名'){started();await waiting;}
   await route.fulfill({json:{items:params.get('type')==='电影'?[{id:'movie:55',provider:'tmdb',title,year:'2024',type_name:'电影',genres:['剧情']}]:[]}});
 });
 await seed(page);await page.goto('/#home');await page.locator('#search').click();
 const input=page.locator('#command-input');await input.fill('先前片名');await request;
 await input.fill('新片名');const option=page.getByRole('option',{name:/新片名/});await expect(option).toBeVisible();release();
 await expect(page.getByRole('option',{name:/先前片名/})).toHaveCount(0);
 await option.click();await expect(page.locator('.detail-content h1')).toHaveText('新片名');
});

test('detail shows line discovery and playback evidence once beside the watch action',async({page})=>{
 await seed(page);await page.addInitScript(()=>localStorage.setItem('openstream_live_playability',JSON.stringify({'film-review-a':{state:'played',checkedAt:Date.now()}})));
 await page.goto('/#detail/film-review-a');const detail=page.locator('.detail-content');
 await expect(detail.locator('.actions + .availability-note')).toHaveText('已找到 1 条播放线路 · 近期播放成功');
 await expect(detail.locator('.playability-note,time')).toHaveCount(0);await expect(detail).not.toContainText('尚未验证');
});

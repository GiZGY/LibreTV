import {test,expect} from '@playwright/test';
async function prepare(context,page,failFirst=false){
 await context.addCookies([{name:'__qa_human_mode',value:'1',url:'http://127.0.0.1:18448'}]);
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={count:0,render(host,options){this.count++;if(${failFirst}&&this.count===1){setTimeout(()=>options['error-callback'](),0);return 1;}const b=document.createElement('button');b.textContent='完成测试验证';b.onclick=()=>options.callback('isolated-fixture-token');host.append(b);return this.count;},remove(){document.querySelector('.human-widget')?.replaceChildren();},reset(){}};`}));
}
test('failed first verification stays gated and retries without losing local data',async({page,context})=>{
 await prepare(context,page,true);
 await page.addInitScript(()=>{localStorage.setItem('openstream_live_favorites','["film-qa1"]');localStorage.setItem('openstream_live_playbackRate','1.75');localStorage.setItem('openstream_live_missingSources','{"old":9999999999999}');});
 await page.goto('/');await expect(page.getByRole('button',{name:'重新验证',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.human-dialog')).toBeVisible();
 await page.getByRole('button',{name:'重新验证',exact:true}).click();await page.getByRole('button',{name:'完成测试验证',exact:true}).click();await expect(page.locator('.human-dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe('1.75');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('openstream_live_missingSources'))).toBe('{}');
});
test('verified cookie lasts seven days and survives a browser-context restart',async({browser,page,context})=>{
 await prepare(context,page);await page.goto('/');await page.getByRole('button',{name:'完成测试验证',exact:true}).click();await expect(page.locator('.human-dialog')).toHaveCount(0);
 const cookie=(await context.cookies()).find(c=>c.name==='openstream_human');expect(cookie.httpOnly).toBe(true);expect(cookie.expires-Date.now()/1000).toBeGreaterThan(604790);expect(cookie.expires-Date.now()/1000).toBeLessThanOrEqual(604800);
 const restored=await browser.newContext({storageState:await context.storageState(),userAgent:await page.evaluate(()=>navigator.userAgent)});const next=await restored.newPage();let challenges=0;await next.route('https://challenges.cloudflare.com/**',r=>{challenges++;return r.abort();});await next.goto('/');await expect(next.getByRole('heading',{name:'推荐影片',exact:true})).toBeVisible();expect(challenges).toBe(0);await restored.close();
});

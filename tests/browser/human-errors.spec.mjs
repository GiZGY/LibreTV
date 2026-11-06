import {test,expect} from '@playwright/test';

async function gatedFixture(context,page){
 await context.addCookies([{name:'__qa_human_mode',value:'1',url:'http://127.0.0.1:18448'}]);
 await page.addInitScript(()=>localStorage.setItem('openstream_live_playbackRate','1.75'));
 const requests={posts:0,protected:0};
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/security/human'&&request.method()==='POST')requests.posts++;if(/^\/(?:api\/(?:catalog|tvbox)\/|proxy\/)/.test(url.pathname))requests.protected++;});
 return requests;
}
async function staysDenied(page,requests,message){
 const dialog=page.getByRole('dialog',{name:'安全验证',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('.human-message')).toContainText(message);
 await expect(dialog.locator('.human-message')).not.toContainText(/600010|300001|200500/);
 await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(page.getByRole('button',{name:'重新验证',exact:true})).toBeVisible();
 expect(requests.posts).toBe(0);expect(requests.protected).toBe(0);expect(await page.evaluate(()=>localStorage.getItem('openstream_live_playbackRate'))).toBe('1.75');
 const status=await page.evaluate(async()=>{const response=await fetch('/api/security/human');return(await response.json()).verified;});expect(status).toBe(false);
}
for(const [code,message]of [['600010','本次验证未通过'],['300001','本次验证未通过'],['200500','安全验证加载失败，请检查网络后重试']]){
 test(`provider error ${code} has accurate copy and retry still requires successful verification`,async({page,context})=>{
  const requests=await gatedFixture(context,page);
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={render(host,options){setTimeout(()=>options['error-callback'](${JSON.stringify(code)}),0);return 1;},remove(){document.querySelector('.human-widget')?.replaceChildren();},reset(){}};`}));
  await page.goto('/');await staysDenied(page,requests,message);
  if(code!=='200500')await expect(page.locator('.human-message')).not.toContainText(/连接失败|检查网络/);
  await page.getByRole('button',{name:'重新验证',exact:true}).click();await staysDenied(page,requests,message);
 });
}

test('a failed SDK request is a loading/network error and never releases the gate on retry',async({page,context})=>{
 const requests=await gatedFixture(context,page);let attempts=0;
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>{attempts++;return route.abort('connectionfailed');});
 await page.goto('/');await staysDenied(page,requests,'检查网络后重试');const before=attempts;
 await page.getByRole('button',{name:'重新验证',exact:true}).click();await staysDenied(page,requests,'检查网络后重试');expect(attempts).toBeGreaterThan(before);
 await expect(page.locator('.human-message')).not.toContainText('本次验证未通过');
});

import {test,expect} from '@playwright/test';
import {expectMediaFrame} from './media-assertions.mjs';

async function mount(page,source){
 await page.evaluate(source=>{
  for(const previous of document.querySelectorAll('video')){previous.pause();previous.removeAttribute('src');previous.load();}
  const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.volume=0;video.preload='auto';
  window.__fixtureFramePresented=false;video.requestVideoFrameCallback?.(()=>{if(video.isConnected)window.__fixtureFramePresented=true;});
  document.body.replaceChildren(video);video.src=source;
 },source);
}

test('first-frame diagnostics reject an undecodable fixture without weakening actual frame acceptance',async({page})=>{
 await page.goto('/frame-fixture');
 await mount(page,'/media/sample.mp4?frame-positive=1');await expectMediaFrame(page);
 await expect.poll(()=>page.evaluate(()=>window.__fixtureFramePresented)).toBe(true);await expect(page.locator('video')).toHaveJSProperty('paused',true);
 await page.route('**/media/frame-corrupt.mp4',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from('invalid MP4: deliberate synthetic negative control')}));await mount(page,'/media/frame-corrupt.mp4');
 // An invalid media container must fail; this bounds only the deliberate negative control.
 await expect(expectMediaFrame(page,{timeout:1000})).rejects.toThrow(/Last media state:.*"ready":\d.*"network":\d.*"error":/);
 expect(await page.evaluate(()=>window.__fixtureFramePresented)).toBe(false);
 console.log(JSON.stringify({path:'undecodable-fixture-rejected',project:test.info().project.name,ready:await page.locator('video').evaluate(v=>v.readyState),defaultFirstFrameTimeout:15000}));
});

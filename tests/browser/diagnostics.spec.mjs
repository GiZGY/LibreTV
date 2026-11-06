import {test,expect} from '@playwright/test';
for(const width of [390,820,1440])test(`diagnostics are explicit, redacted and usable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
 await page.addInitScript(()=>{window.__copiedDiagnostic=null;Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copiedDiagnostic=value;}}});});
 await page.goto('/');await page.locator('.settings-link').click();
 const button=page.getByRole('button',{name:'复制诊断信息',exact:true});await expect(button).toBeVisible();
 const box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>window.__copiedDiagnostic)).toBeNull();await button.click();
 const value=await page.evaluate(()=>JSON.parse(window.__copiedDiagnostic));expect(value.schema).toBe(1);expect(value.current).toBeNull();
 expect(JSON.stringify(value)).not.toMatch(/cookie|token|https?:|filmId|password/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('settings.png')});
 await page.keyboard.press('Escape');await expect(page.locator('#settings')).not.toBeVisible();
});

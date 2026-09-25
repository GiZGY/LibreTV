import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../human-access.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
test('verification dialog starts at its title and has one accessible close action',()=>{
 assert.match(source,/class="human-title" tabindex="-1" autofocus/);
 assert.match(source,/querySelector\('\.human-title'\)\.focus\(\{preventScroll:true\}\)/);
 assert.match(source,/class="human-close" type="button" aria-label="关闭安全验证"/);
 assert.doesNotMatch(source,/>取消<\/button>/);
 assert.match(source,/dialog.addEventListener\('cancel', cancel/);
 assert.match(source,/previous\?\.focus\?\./);
});
test('mouse focus is quiet but keyboard focus remains visible',()=>{
 assert.match(css,/:focus:not\(:focus-visible\)\{outline:none\}/);
 assert.match(css,/button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible\{outline:3px solid/);
 assert.match(css,/\.human-close\{position:absolute;top:14px;right:14px/);
});

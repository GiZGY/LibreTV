import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/search-ui.js', import.meta.url), 'utf8');
const context = {
  console,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  WeakSet
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/search-ui.js' });

const attack = `x');window.__openstreamXss=1;//`;
const html = context.buildSearchResultCards([{
  vod_id: attack,
  vod_name: attack,
  vod_pic: 'https://images.example/poster.jpg',
  source_name: attack,
  source_code: attack,
  type_name: '电影',
  vod_year: '2026',
  vod_remarks: attack
}]);

assert.doesNotMatch(html, /\sonclick\s*=/i);
assert.doesNotMatch(html, /\sonerror\s*=/i);
assert.match(html, /data-vod-id=/);
assert.match(html, /data-vod-name=/);
assert.match(html, /data-source-code=/);
assert.match(html, /role="button"/);
assert.match(html, /tabindex="0"/);

console.log(JSON.stringify({
  ok: true,
  inlineHandlers: false,
  encodedCardData: true,
  keyboardAccessible: true
}, null, 2));

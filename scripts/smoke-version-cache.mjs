import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/version-check.js', import.meta.url), 'utf8');
let cached = { checkedAt: Date.now(), result: { current: '1.1.1' } };
const urls = [];
const context = vm.createContext({
  __OPENSTREAM_VERSION__: '1.1.3',
  document: { addEventListener() {}, createElement: () => ({}) },
  localStorage: { getItem: () => JSON.stringify(cached), setItem: (_key, value) => { cached = JSON.parse(value); } },
  AbortController, setTimeout, clearTimeout,
  fetch: async url => { urls.push(url); return new Response('1.1.3'); }, console
});
vm.runInContext(source, context);
assert.equal(context.readCachedVersionCheck(), null, 'old build cache must not masquerade as current version');
const result = await context.checkForUpdates();
assert.equal(result.current, '1.1.3');
assert.equal(urls.length, 1);
assert.equal(urls[0].includes('raw.githubusercontent.com'), true, 'current version is embedded, not another critical request');
assert.equal(context.readCachedVersionCheck().current, '1.1.3');
cached.checkedAt = Date.now() - 25 * 3600000;
assert.equal(context.readCachedVersionCheck(), null);
assert.equal(context.createVersionElement({ currentFormatted: '1.1.3', checking: true }).textContent, '版本: 1.1.3');
console.log('Version cache follows the loaded build and preserves delayed update checks');

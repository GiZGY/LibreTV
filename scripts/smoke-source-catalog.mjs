import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const storage = new Map();
const context = vm.createContext({
  console, URL, setTimeout, clearTimeout,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  }
});
context.window = context;
const config = read('js/config.js');
vm.runInContext(config.slice(config.indexOf('const API_SITES'), config.indexOf('// 添加聚合搜索')), context);
vm.runInContext(read('js/customer_site.js'), context);
vm.runInContext(read('js/source-catalog.js'), context);
const catalog = context.OpenStreamSourceCatalog;
const sites = context.API_SITES;
const ordinary = Object.keys(sites).filter(key => !sites[key].adult);
assert.equal(ordinary.length, 25);
const plain = value => JSON.parse(JSON.stringify(value));
for (const raw of [null, 'invalid', '{}', 'null', '["removed-source"]']) {
  assert.equal(catalog.reconcileSelection(raw, sites).length, 6);
}
assert.deepEqual(plain(catalog.reconcileSelection('[]', sites)), []);
assert.deepEqual(plain(catalog.reconcileSelection('["baidu","bfzy","jisu","baidu","removed"]', sites)), ['baidu','bfzy','jisu']);
assert.deepEqual(plain(catalog.reconcileSelection('["custom_0","custom_9"]', sites, [{}])), ['custom_0']);
const now = Date.now();
assert.deepEqual(plain(catalog.freshQualities('null', now)), {});
assert.deepEqual(plain(catalog.freshQualities('{"baidu":{"score":0}}', now - 31 * 60000)), {});
assert.deepEqual(plain(catalog.freshQualities('{"baidu":{"score":95}}', now - 25 * 3600000)), {});
assert.equal(catalog.freshQualities('{"baidu":{"score":95}}', now).baidu.score, 95);

class Element {
  children = [];
  textContent = '';
  set innerHTML(value) {
    this.children = [];
    this.html = value;
    this.input = value.includes('data-api=') ? {
      dataset: { api: value.match(/data-api="([^"]+)"/)[1] },
      checked: /\schecked\s/.test(value), addEventListener() {}
    } : null;
  }
  appendChild(child) { this.children.push(child); }
  querySelector() { return this.input; }
}
const elements = new Map(['apiCheckboxes', 'selectedApiCount', 'sourceCatalogCount'].map(id => [id, new Element()]));
context.document = {
  getElementById: id => elements.get(id),
  createElement: () => new Element()
};
Object.assign(context, {
  apiLatencies: {}, apiQualities: {}, selectedAPIs: ['baidu', 'bfzy', 'jisu'],
  addAdultAPI() {}, checkAdultAPIsSelected() {},
  cancelPassiveQualitySampling() {}, renderCustomAPIsList() {},
  updateLatencyTimeDisplay() {}, showToast() {}, qualityStateGeneration: 0
});
const app = read('js/app.js');
vm.runInContext(app.slice(app.indexOf('function initAPICheckboxes()'), app.indexOf('// 添加成人API列表\nfunction')), context);
vm.runInContext(app.slice(app.indexOf('function updateSelectedApiCount()'), app.indexOf('// 全选或取消全选API')), context);
const getRows = () => elements.get('apiCheckboxes').children[0].children.filter(item => item.input);
for (const scenario of ['fresh', 'three-selected', 'all-zero', 'old-hide-setting']) {
  context.selectedAPIs = scenario === 'fresh' ? Array.from(catalog.defaults(sites)) : ['baidu','bfzy','jisu'];
  context.apiQualities = scenario === 'all-zero' || scenario === 'old-hide-setting'
    ? Object.fromEntries(ordinary.map(key => [key, { score: 0 }])) : {};
  storage.set('hideZombieApis', 'true');
  context.initAPICheckboxes();
  assert.equal(getRows().length, 25, `${scenario}: complete catalogue must stay visible`);
  assert.equal(getRows().filter(row => row.input.checked).length, context.selectedAPIs.length);
}
storage.set('viewingHistory', '[{"title":"keep"}]');
storage.set('customAPIs', '[{"name":"keep"}]');
vm.runInContext(read('js/source-health.js'), context);
context.OpenStreamSourceHealth.recordSourceEvent('baidu', { status: 'unplayable' });
assert.equal(context.OpenStreamSourceHealth.getSearchPlan(['baidu']).length, 0);
context.restoreSourceDefaults();
assert.equal(context.OpenStreamSourceHealth.getSearchPlan(['baidu']).length, 1);
assert.equal(context.selectedAPIs.length, 6);
assert.equal(getRows().length, 25);
assert.equal(storage.get('viewingHistory'), '[{"title":"keep"}]');
assert.equal(storage.get('customAPIs'), '[{"name":"keep"}]');
assert.equal(storage.get('hideZombieApis'), undefined);

const qualityFunction = app.slice(app.indexOf('async function testAllApiQuality('), app.indexOf('function createAbortError'));
assert.doesNotMatch(qualityFunction, /selectedAPIs\s*=/, 'quality detection must not overwrite the selection');
assert.match(qualityFunction, /generation !== qualityStateGeneration/, 'reset must invalidate in-flight measurements');
assert.doesNotMatch(app, /if \(hideZombieApis/);
console.log(JSON.stringify({ ok: true, catalogue: ordinary.length, defaults: 6, scenarios: 4, staleCacheExpires: true, resetPreservesPersonalData: true }));

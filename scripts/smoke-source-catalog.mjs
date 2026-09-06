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
assert.equal(ordinary.length, 20);
const plain = value => JSON.parse(JSON.stringify(value));
const retired = ['heimuer', 'wolong', 'wwzy', 'dbzy', 'tyyszy'];
for (const key of retired) assert.equal(sites[key], undefined, `${key}: retired endpoint must not be offered`);
assert.deepEqual(plain(catalog.reconcileSelection(JSON.stringify(retired), sites)), plain(catalog.defaults(sites)));
assert.deepEqual(plain(catalog.reconcileSelection(JSON.stringify([...retired, 'bfzy', 'custom_0']), sites, [{}])), ['bfzy', 'custom_0']);
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
  assert.equal(getRows().length, ordinary.length, `${scenario}: complete catalogue must stay visible`);
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
assert.equal(getRows().length, ordinary.length);
assert.equal(storage.get('viewingHistory'), '[{"title":"keep"}]');
assert.equal(storage.get('customAPIs'), '[{"name":"keep"}]');
assert.equal(storage.get('hideZombieApis'), undefined);

const qualityFunction = app.slice(app.indexOf('async function testAllApiQuality('), app.indexOf('function createAbortError'));
assert.doesNotMatch(qualityFunction, /selectedAPIs\s*=/, 'quality detection must not overwrite the selection');
assert.match(qualityFunction, /generation !== qualityStateGeneration/, 'reset must invalidate in-flight measurements');
assert.doesNotMatch(app, /if \(hideZombieApis/);
assert.doesNotMatch(read('js/douban.js'), /selectedAPIs\.push\('dbzy'\)/, 'recommendation click must not restore retired sources');
const requests = [];
Object.assign(context, {
  AbortController, Request, location: new URL('https://fixture.test'), PROXY_URL: '/proxy/',
  API_CONFIG: { search: { path: '?ac=videolist&wd=', headers: {} } },
  fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ list: [] }) }; },
  console: { ...console, error() {} }
});
vm.runInContext(read('js/api.js'), context);
for (const key of retired) {
  const result = JSON.parse(await context.handleApiRequest(new URL(`https://fixture.test/api/search?source=${key}&wd=test`)));
  assert.notEqual(result.code, 200);
}
assert.equal(requests.length, 0, 'retired source IDs must not make network requests');
assert.equal(JSON.parse(await context.handleApiRequest(new URL('https://fixture.test/api/search?wd=test'))).code, 200);
assert.ok(decodeURIComponent(requests[0]).includes(sites.jisu.api), 'default API must remain in the active catalog');
assert.equal(context.filter360SearchResults([{ vod_name: 'X战警：天启' }, { vod_name: '无关短剧' }], 'X 战警:天启').length, 1);
assert.equal(context.filter360SearchResults([{ vod_name: '无关短剧' }], 'missing').length, 0);
assert.equal(context.filter360SearchResults(null, 'test').length, 0);
context.fetch = async () => ({ ok: true, json: async () => ({ list: [{ vod_name: '飞驰人生2' }, { vod_name: '无关短剧' }] }) });
const recovered360 = JSON.parse(await context.handleApiRequest(new URL('https://fixture.test/api/search?source=zy360&wd=飞驰人生2')));
assert.equal(recovered360.code, 200);
assert.equal(recovered360.list.length, 1);
assert.equal(recovered360.list[0].source_code, 'zy360');
Object.assign(context, { URLSearchParams, SEARCH_FILTERS_CONFIG: { default: { type: 'all', year: '', genre: '' } } });
vm.runInContext(read('js/search.js'), context);
const livePath360 = await context.searchByAPIAndKeyWord('zy360', '飞驰人生2');
assert.equal(livePath360.length, 1);
assert.equal(livePath360[0].vod_name, '飞驰人生2');
console.log(JSON.stringify({ ok: true, catalogue: ordinary.length, defaults: 6, scenarios: 4, staleCacheExpires: true, resetPreservesPersonalData: true }));

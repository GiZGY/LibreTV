import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = new Map();
const htmlUpdates = [];
let abortedRequests = 0;
let searchCall = 0;

const modalContent = {
  _html: '',
  set innerHTML(value) {
    this._html = String(value);
    htmlUpdates.push(this._html);
  },
  get innerHTML() { return this._html; }
};
const elements = {
  modal: { classList: { add() {}, remove() {} } },
  modalTitle: { textContent: '' },
  modalContent
};

function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      abortedRequests += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const context = {
  console,
  performance,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  setTimeout,
  clearTimeout,
  API_SITES: {
    fast: { name: '快速源' }, slow: { name: '慢速源' },
    close: { name: '关闭测试源' }, old: { name: '旧调用' }, fresh: { name: '新调用' },
    timeout: { name: '超时源' }
  },
  PLAYER_CONFIG: {
    resourceSwitch: {
      searchConcurrency: 2,
      speedConcurrency: 1,
      searchTimeout: 200,
      speedTimeout: 100,
      cacheTtl: 300000
    }
  },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  sessionStorage: { getItem() { return null; }, setItem() {} },
  document: { getElementById(id) { return elements[id]; } },
  location: {
    search: '?source=current&id=current-id',
    href: 'https://app.example/player.html?source=current&id=current-id'
  },
  showLoading() {}, hideLoading() {}, showToast() {},
  closeModal() { modalContent.innerHTML = ''; },
  getDefaultSearchFilters() { return {}; },
  async searchByAPIAndKeyWord() { return []; },
  fetch: async () => ({ ok: true, status: 200 }),
  OpenStreamSourceHealth: {
    getSearchPlan(keys) { return keys.map((sourceKey, index) => ({ sourceKey, tier: 'A', score: 100 - index })); }
  }
};
context.window = context;
context.OpenStreamSourceAdapter = {
  async search(sourceKey, _title, _filters, options = {}) {
    searchCall += 1;
    const delay = sourceKey === 'fast' ? 10
      : sourceKey === 'slow' ? 90
      : sourceKey === 'fresh' ? 10
      : 500;
    await waitWithSignal(delay, options.signal);
    return {
      status: 'ready',
      list: [{ vod_id: `${sourceKey}-id`, vod_name: `Demo ${sourceKey}`, vod_pic: '' }]
    };
  },
  async detail(sourceKey, vodId, options = {}) {
    await waitWithSignal(5, options.signal);
    return { status: 'ready', episodes: [`https://media.example/${sourceKey}/${vodId}.m3u8`], data: {} };
  },
  async play() { throw new Error('CMS test should resolve the detail episode directly'); },
  isBridgeSource() { return false; }
};

vm.createContext(context);
vm.runInContext(`
  var selectedAPIs = ['fast', 'slow'];
  var customAPIs = [];
  var currentVideoTitle = 'Demo';
  var currentEpisodeIndex = 0;
  var art = null;
`, context);
for (const relativePath of ['js/player-episodes.js', 'js/player-resource-switch.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

const streamingRun = context.showSwitchResourceModal();
await new Promise((resolve) => setTimeout(resolve, 35));
assert.ok(
  htmlUpdates.some((html) => html.includes('Demo fast')),
  'fast source card should render before the slow source finishes'
);
await streamingRun;
assert.ok(modalContent.innerHTML.includes('Demo fast') && modalContent.innerHTML.includes('Demo slow'));
assert.ok(modalContent.innerHTML.includes('ms'), 'speed results should stream into rendered cards');

vm.runInContext(`selectedAPIs = ['close'];`, context);
const closeRun = context.showSwitchResourceModal();
await new Promise((resolve) => setTimeout(resolve, 20));
context.closeModal();
assert.equal(await closeRun, false, 'closing the modal should cancel the active run');
const abortedAfterClose = abortedRequests;
assert.ok(abortedAfterClose > 0, 'close should abort in-flight requests');

vm.runInContext(`selectedAPIs = ['old'];`, context);
const oldRun = context.showSwitchResourceModal();
await new Promise((resolve) => setTimeout(resolve, 15));
vm.runInContext(`selectedAPIs = ['fresh'];`, context);
const freshRun = context.showSwitchResourceModal();
assert.equal(await oldRun, false, 'a newer invocation should cancel the previous run');
assert.equal(await freshRun, true, 'the newest invocation should complete');
assert.ok(modalContent.innerHTML.includes('Demo fresh'));

context.PLAYER_CONFIG.resourceSwitch.searchTimeout = 30;
vm.runInContext(`selectedAPIs = ['timeout'];`, context);
const timeoutStarted = performance.now();
assert.equal(await context.showSwitchResourceModal(), true);
assert.ok(performance.now() - timeoutStarted < 200, 'per-item timeout should prevent a hanging modal');
assert.ok(modalContent.innerHTML.includes('暂未找到可切换资源'));

console.log(JSON.stringify({
  ok: true,
  htmlUpdates: htmlUpdates.length,
  abortedRequests,
  searchCall
}, null, 2));

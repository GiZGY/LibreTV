import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = new Map();
const session = new Map();
const requests = [];
const episodes = [
  { name: '第1集', flag: 'direct', episode: 0, url: 'tvbox://play?sourceKey=%E7%93%9C%E5%AD%90&id=bridge-id&flag=direct&episode=0' },
  { name: '第2集', flag: 'direct', episode: 1, url: 'tvbox://play?sourceKey=%E7%93%9C%E5%AD%90&id=bridge-id&flag=direct&episode=1' }
];

const elements = new Map();
function getElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      classList: { add() {}, remove() {} },
      innerHTML: '',
      textContent: ''
    });
  }
  return elements.get(id);
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
  API_SITES: { bad: { name: '坏源' } },
  PLAYER_CONFIG: { resourceSwitch: { searchConcurrency: 2, speedConcurrency: 1, cacheTtl: 300000 } },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  sessionStorage: {
    getItem(key) { return session.has(key) ? session.get(key) : null; },
    setItem(key, value) { session.set(key, String(value)); }
  },
  document: { getElementById: getElement },
  showLoading() {},
  hideLoading() {},
  showToast(message) { context.__lastToast = message; },
  closeModal() {},
  getDefaultSearchFilters() { return { type: 'all', year: '', genre: '' }; },
  async searchByAPIAndKeyWord() { return []; }
};
context.window = context;
context.location = {
  origin: 'https://app.example',
  search: '?id=bad-id&source=bad&index=1&title=Demo',
  href: 'https://app.example/player.html?id=bad-id&source=bad&index=1&title=Demo'
};
context.OpenStreamSourceHealth = {
  looksLikeLoginSource() { return false; },
  getSearchPlan(keys) { return keys.map((sourceKey, index) => ({ sourceKey, tier: 'A', score: 100 - index })); }
};

context.fetch = async (input, options = {}) => {
  const value = String(input);
  if (options.signal?.aborted) {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }
  requests.push(value);
  const url = new URL(value, context.location.origin);
  if (url.pathname === '/api/tvbox/search') {
    return response({ status: 'ready', list: [{ vod_id: 'bridge-id', vod_name: 'Demo', vod_pic: 'https://img.example/demo.jpg' }] });
  }
  if (url.pathname === '/api/tvbox/detail') {
    return response({ status: 'ready', episodes, videoInfo: { title: 'Demo' } });
  }
  if (url.pathname === '/api/tvbox/play') {
    const episode = Number(url.searchParams.get('episode') || 0);
    return response({ status: 'ready', url: `https://media.example/episode-${episode + 1}.m3u8` });
  }
  if (url.hostname === 'media.example') return response({}, true);
  throw new Error(`unexpected fetch: ${value}`);
};

function response(data, opaque = false) {
  return {
    ok: true,
    status: 200,
    type: opaque ? 'opaque' : 'basic',
    json: async () => data
  };
}

storage.set('selectedAPIs', JSON.stringify(['bad', 'tvbox:瓜子']));
storage.set('customAPIs', '[]');
vm.createContext(context);
function runFile(relativePath) {
  vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

vm.runInContext(`
  var selectedAPIs = ['bad', 'tvbox:瓜子'];
  var customAPIs = [];
  var currentVideoTitle = 'Demo';
  var currentEpisodeIndex = 1;
  var art = { video: { currentTime: 42 } };
`, context);
runFile('js/source-adapter.js');
runFile('js/player-episodes.js');
runFile('js/player-resource-switch.js');

assert.equal(
  context.OpenStreamPlayerEpisodes.normalizePlaybackUrl(
    'https://vv.jisuzyv.com/play/demo-token',
    'jisu'
  ),
  'https://vv.jisuzyv.com/play/demo-token/index.m3u8'
);
assert.equal(
  context.OpenStreamPlayerEpisodes.normalizePlaybackUrl(
    'https://media.example/demo.m3u8',
    'jisu'
  ),
  'https://media.example/demo.m3u8'
);

const initialResolved = await context.OpenStreamPlayerEpisodes.resolveEpisode(
  episodes[1],
  1,
  { sourceKey: 'tvbox:瓜子', videoId: 'bridge-id' }
);
assert.equal(initialResolved.url, 'https://media.example/episode-2.m3u8');
assert.match(requests.at(-1), /sourceKey=%E7%93%9C%E5%AD%90/);
assert.match(requests.at(-1), /id=bridge-id/);
assert.match(requests.at(-1), /flag=direct/);
assert.match(requests.at(-1), /episode=1/);

let dblclickListeners = 0;
const video = { addEventListener(type) { if (type === 'dblclick') dblclickListeners += 1; } };
context.OpenStreamPlayerEpisodes.bindDblclickOnce(video, () => {});
context.OpenStreamPlayerEpisodes.bindDblclickOnce(video, () => {});
assert.equal(dblclickListeners, 1, 'dblclick should only be bound once per video element');

await context.switchToResource('tvbox:瓜子', 'bridge-id');
const manualUrl = new URL(context.location.href, context.location.origin);
assert.equal(manualUrl.searchParams.get('url'), 'https://media.example/episode-2.m3u8');
assert.ok(!context.location.href.includes('%5Bobject%20Object%5D'), 'manual source switch must not serialize an episode object');
assert.equal(JSON.parse(storage.get('currentEpisodes')).length, 2);

requests.length = 0;
const speed = await context.OpenStreamResourceSwitch.testVideoSourceSpeed('tvbox:瓜子', 'speed-id');
assert.equal(speed.episodes, 2, 'speed result should use episode count from detail');
const detailIndex = requests.findIndex((url) => url.includes('/api/tvbox/detail'));
const playIndex = requests.findIndex((url) => url.includes('/api/tvbox/play'));
assert.ok(detailIndex >= 0 && playIndex > detailIndex, 'bridge speed test must fetch detail before resolving play URL');

context.location.search = '?id=bad-id&source=bad&index=1&title=Demo';
context.location.href = 'https://app.example/player.html?id=bad-id&source=bad&index=1&title=Demo';
const autoSwitched = await context.autoSwitchToBestResource('playback_error');
assert.equal(autoSwitched, true);
const fallbackUrl = new URL(context.location.href, context.location.origin);
assert.equal(fallbackUrl.searchParams.get('source'), 'tvbox:瓜子');
assert.equal(fallbackUrl.searchParams.get('url'), 'https://media.example/episode-2.m3u8');
assert.ok(!context.location.href.includes('%5Bobject%20Object%5D'), 'automatic fallback must not serialize an episode object');

console.log(JSON.stringify({
  ok: true,
  initialUrl: initialResolved.url,
  manualUrl: manualUrl.searchParams.get('url'),
  fallbackUrl: fallbackUrl.searchParams.get('url'),
  speedEpisodes: speed.episodes,
  dblclickListeners
}, null, 2));

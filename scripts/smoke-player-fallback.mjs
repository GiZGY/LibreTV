import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const storage = new Map();
const session = new Map();

const context = {
  console,
  performance,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  API_SITES: {
    bad: { name: '坏源', api: 'https://bad.example/api.php/provide/vod' },
    good: { name: '好源', api: 'https://good.example/api.php/provide/vod' }
  },
  PLAYER_CONFIG: {
    resourceSwitch: {
      searchConcurrency: 2,
      speedConcurrency: 1,
      cacheTtl: 300000
    }
  },
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  },
  sessionStorage: {
    getItem(key) {
      return session.has(key) ? session.get(key) : null;
    },
    setItem(key, value) {
      session.set(key, String(value));
    }
  },
  document: {
    getElementById() {
      return {
        classList: { add() {}, remove() {} },
        innerHTML: ''
      };
    }
  },
  showToast(message) {
    context.__lastToast = message;
  },
  showLoading() {},
  hideLoading() {}
};

context.window = context;
context.location = {
  search: '?id=bad-id&source=bad&index=1&title=Demo',
  href: 'player.html?id=bad-id&source=bad&index=1&title=Demo'
};

storage.set('selectedAPIs', JSON.stringify(['bad', 'good']));
storage.set('customAPIs', '[]');

vm.createContext(context);

function runSource(source, filename) {
  vm.runInContext(source, context, { filename });
}

function runFile(relativePath) {
  runSource(fs.readFileSync(path.join(root, relativePath), 'utf8'), relativePath);
}

runSource(`
  var selectedAPIs = ['bad', 'good'];
  var customAPIs = [];
  var currentVideoTitle = 'Demo';
  var currentEpisodeIndex = 1;
  var art = { video: { currentTime: 88 } };
  function getDefaultSearchFilters() { return { type: 'all', year: '', genre: '' }; }
  async function searchByAPIAndKeyWord(apiId) {
    if (apiId === 'good') {
      return [{ vod_id: 'good-id', vod_name: 'Demo', source_code: 'good', source_name: '好源' }];
    }
    return [];
  }
`, 'test-globals.js');

context.fetch = async (url) => {
  if (!String(url).includes('good-id')) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 200,
      episodes: ['https://cdn.example/ep1.m3u8', 'https://cdn.example/ep2.m3u8'],
      videoInfo: { title: 'Demo' }
    })
  };
};

runFile('js/source-health.js');
runFile('js/source-adapter.js');
runFile('js/player-episodes.js');
runFile('js/player-resource-switch.js');

const switched = await context.autoSwitchToBestResource('smoke_failure');

if (!switched) {
  throw new Error('auto fallback did not switch to a playable source');
}

if (!context.location.href.includes('source=good')) {
  throw new Error(`fallback target did not use good source: ${context.location.href}`);
}

if (!context.location.href.includes('position=88')) {
  throw new Error(`fallback target did not preserve playback position: ${context.location.href}`);
}

console.log(JSON.stringify({
  ok: true,
  href: context.location.href,
  toast: context.__lastToast
}, null, 2));

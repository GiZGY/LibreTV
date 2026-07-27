import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.failOnceKey = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failOnceKey === key) {
      this.failOnceKey = null;
      throw new Error('simulated storage failure');
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const helpersStart = appSource.indexOf('function getPortableConfigKeys()');
const helpersEnd = appSource.indexOf('// 从URL导入配置', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'config import helpers are missing');

const storage = new FakeStorage({
  selectedAPIs: '["old-source"]',
  customAPIs: '[]'
});
const context = {
  URL,
  localStorage: storage,
  SEARCH_FILTERS_CONFIG: {
    storageKey: 'searchFilters',
    types: [
      { value: 'all' },
      { value: 'movie' },
      { value: 'tv' }
    ]
  },
  SEARCH_HISTORY_KEY: 'searchHistory'
};
vm.createContext(context);
vm.runInContext(appSource.slice(helpersStart, helpersEnd), context);

assert.throws(() => context.applyImportedConfigData({
  selectedAPIs: '["new-source"]',
  customAPIs: '{"not":"an-array"}'
}));
assert.equal(storage.getItem('selectedAPIs'), '["old-source"]');
assert.equal(storage.getItem('customAPIs'), '[]');

context.applyImportedConfigData({
  selectedAPIs: '["new-source"]',
  customAPIs: JSON.stringify([{
    name: 'Custom source',
    url: 'https://cms.example.test'
  }]),
  doubanEnabled: 'true'
});
assert.equal(storage.getItem('selectedAPIs'), '["new-source"]');
assert.equal(storage.getItem('doubanEnabled'), 'true');

const beforeFailure = {
  selectedAPIs: storage.getItem('selectedAPIs'),
  customAPIs: storage.getItem('customAPIs')
};
storage.failOnceKey = 'customAPIs';
assert.throws(() => context.applyImportedConfigData({
  selectedAPIs: '["partial-write-must-rollback"]',
  customAPIs: '[]'
}), /simulated storage failure/);
assert.equal(storage.getItem('selectedAPIs'), beforeFailure.selectedAPIs);
assert.equal(storage.getItem('customAPIs'), beforeFailure.customAPIs);

console.log(JSON.stringify({
  ok: true,
  malformedConfigRejectedBeforeWrite: true,
  validConfigImported: true,
  partialWriteRolledBack: true
}, null, 2));

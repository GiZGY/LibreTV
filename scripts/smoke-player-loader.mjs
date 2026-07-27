import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let appendCount = 0;
let removeCount = 0;
let currentScript = null;
let toastMessage = '';

function createScript() {
  const listeners = new Map();
  return {
    dataset: {},
    parentNode: null,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    remove() {
      removeCount += 1;
      if (currentScript === this) currentScript = null;
    },
    dispatch(type) {
      listeners.get(type)?.();
    }
  };
}

const context = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    body: { dataset: { playerSwitchSrc: 'compiled/player-switch.min.js?v=test' } },
    head: {
      appendChild(script) {
        appendCount += 1;
        currentScript = script;
        setTimeout(() => {
          if (appendCount === 1) {
            script.dispatch('error');
            return;
          }
          context.OpenStreamResourceSwitch = {
            showSwitchResourceModal: async () => 'modal-opened',
            switchToResource: async (sourceKey) => `switched:${sourceKey}`,
            autoSwitchToBestResource: async () => true
          };
          script.dispatch('load');
        }, 0);
      }
    },
    querySelector() {
      return currentScript;
    },
    createElement() {
      return createScript();
    }
  },
  showToast(message) {
    toastMessage = message;
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/player-resource-loader.js'), 'utf8'),
  context,
  { filename: 'js/player-resource-loader.js' }
);

await assert.rejects(context.loadPlayerResourceSwitch(), /加载失败/);
assert.equal(currentScript, null, 'failed script should be removed before retry');

const [first, second] = await Promise.all([
  context.loadPlayerResourceSwitch(),
  context.loadPlayerResourceSwitch()
]);
assert.equal(first, second, 'concurrent retries should share one module instance');
assert.equal(appendCount, 2, 'retry should append a fresh script after the first failure');
assert.equal(removeCount, 1, 'only the failed script should be removed');
assert.equal(await context.showSwitchResourceModal(), 'modal-opened');
assert.equal(await context.switchToResource('good'), 'switched:good');
assert.equal(await context.autoSwitchToBestResource('failure'), true);
assert.equal(toastMessage, '', 'successful retry should not show an error');

console.log(JSON.stringify({ ok: true, appendCount, removeCount }, null, 2));

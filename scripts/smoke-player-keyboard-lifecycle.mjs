import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const start = source.indexOf('let arrowRightLongPressTimer');
const end = source.indexOf('// 显示快捷键提示', start);
assert.ok(start >= 0 && end > start, 'keyboard lifecycle source is missing');

const timers = new Map();
let nextTimer = 1;
const documentListeners = new Map();
const windowListeners = new Map();
const video = { paused: false, playbackRate: 1 };
const context = {
  art: {
    video,
    currentTime: 10,
    duration: 100,
    volume: 0.5
  },
  currentEpisodeIndex: 0,
  currentEpisodes: [],
  showShortcutHint() {},
  saveCurrentProgress() {},
  playPreviousEpisode() {},
  playNextEpisode() {},
  setTimeout(callback) {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
  document: {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    }
  },
  window: {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const readKeyboardState = (name) => vm.runInContext(name, context);

const keyEvent = {
  altKey: false,
  key: 'ArrowRight',
  target: { tagName: 'BODY' },
  preventDefault() {}
};
context.handleKeyboardShortcuts(keyEvent);
for (const callback of [...timers.values()]) callback();
assert.equal(video.playbackRate, 2);

context.handlePlayerWindowBlur();
assert.equal(video.playbackRate, 1);
assert.equal(readKeyboardState('arrowRightKeyDown'), false);
assert.equal(readKeyboardState('arrowRightLongPressActive'), false);

context.handleKeyboardShortcuts(keyEvent);
assert.ok(timers.size > 0, 'right arrow must work again after blur recovery');
context.document.visibilityState = 'hidden';
context.handlePlayerVisibilityChange();
assert.equal(video.playbackRate, 1);
assert.equal(timers.size, 0);

console.log(JSON.stringify({
  ok: true,
  blurRestoredRate: true,
  visibilityRestoredRate: true,
  keyStateReusable: true
}, null, 2));

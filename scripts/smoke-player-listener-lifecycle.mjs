import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
    this.paused = false;
    this.playbackRate = 1;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  count(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const setupLongPressSpeedControl = extractFunction(playerSource, 'setupLongPressSpeedControl');
const playerElement = new FakeEventTarget();
const destroyedHandlers = [];

const context = {
  console,
  setTimeout,
  clearTimeout,
  navigator: { userAgent: 'iPhone', maxTouchPoints: 1 },
  document: {
    getElementById(id) {
      return id === 'player' ? playerElement : null;
    },
    querySelector() {
      return null;
    }
  },
  formatSpeedHintValue(value) {
    return String(value);
  },
  showShortcutHint() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(`
  var art = null;
  var longPressSpeedCleanup = null;
  ${setupLongPressSpeedControl}
`, context);

function createArt(video) {
  return {
    video,
    on(type, listener) {
      if (type === 'destroy') destroyedHandlers.push(listener);
    }
  };
}

const firstVideo = new FakeEventTarget();
context.art = createArt(firstVideo);
context.setupLongPressSpeedControl();

const secondVideo = new FakeEventTarget();
context.art = createArt(secondVideo);
context.setupLongPressSpeedControl();

for (const type of ['contextmenu', 'touchstart', 'touchend', 'touchcancel', 'touchmove']) {
  assert.equal(playerElement.count(type), 1, `${type} must have exactly one active listener`);
}
assert.equal(firstVideo.count('pause'), 0, 'the old video pause listener must be removed');
assert.equal(secondVideo.count('pause'), 1, 'the current video pause listener must be active');

destroyedHandlers[0]();
assert.equal(playerElement.count('touchstart'), 1, 'destroying the old player must not remove the current listener');

context.longPressSpeedCleanup();
for (const type of ['contextmenu', 'touchstart', 'touchend', 'touchcancel', 'touchmove']) {
  assert.equal(playerElement.count(type), 0, `${type} must be removed during cleanup`);
}
assert.equal(secondVideo.count('pause'), 0, 'the current pause listener must be removed during cleanup');

console.log(JSON.stringify({
  ok: true,
  rebuiltPlayers: 2,
  activeTouchListenersAfterRebuild: 1,
  activeTouchListenersAfterCleanup: 0
}, null, 2));

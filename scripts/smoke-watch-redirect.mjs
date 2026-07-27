import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'js/watch.js'), 'utf8');
const storage = new Map();
let replacedUrl = '';

const context = {
  console,
  URL,
  URLSearchParams,
  localStorage: {
    setItem(key, value) {
      storage.set(key, String(value));
    }
  },
  document: {
    referrer: 'https://tv.cursorflow.top/s=%E5%BA%86%E4%BD%99%E5%B9%B4',
    getElementById() {
      return null;
    }
  },
  window: {
    location: {
      origin: 'https://tv.cursorflow.top',
      search: '?url=https%3A%2F%2Fvideo.example%2Findex.m3u8&title=test',
      replace(value) {
        replacedUrl = value;
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/watch.js' });

assert.ok(replacedUrl, 'watch redirect must happen synchronously');
const redirected = new URL(replacedUrl);
assert.equal(redirected.pathname, '/player.html');
assert.equal(redirected.searchParams.get('url'), 'https://video.example/index.m3u8');
assert.equal(redirected.searchParams.get('title'), 'test');
assert.match(decodeURIComponent(redirected.searchParams.get('returnUrl')), /\/s=/);
assert.equal(storage.get('cameFromSearch'), 'true');

console.log(JSON.stringify({ ok: true, redirectedTo: redirected.pathname }, null, 2));

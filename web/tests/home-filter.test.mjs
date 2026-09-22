import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const handler = source.split("document.addEventListener('click',e=>{const filter=")[1].split('\n')[0];

test('home filtering preserves page nodes and ignores repeat selections', () => {
  let writes = 0;
  const buttons = ['全部', '科幻', '悬疑'].map(value => ({
    dataset: { value }, classList: { toggle() { writes++; } },
    setAttribute() { writes++; }
  }));
  const cards = ['科幻', '悬疑', '科幻'].map(genre => ({ dataset: { homeGenre: genre }, hidden: false }));
  let listener;
  const context = vm.createContext({
    homeGenre: '全部',
    render() { throw new Error('Home filters must not rebuild the page'); },
    document: {
      addEventListener(_, fn) { listener = fn; },
      querySelectorAll(selector) {
        if (selector === '[data-filter="home"]') return buttons;
        if (selector === '#home-recommendations [data-home-genre]') return cards;
        throw new Error(`Unexpected page update: ${selector}`);
      }
    }
  });
  vm.runInContext("document.addEventListener('click',e=>{const filter=" + handler, context);
  const click = value => listener({ target: { closest: () => ({ dataset: { filter: 'home', value } }) } });
  click('科幻');
  assert.deepEqual(cards.map(card => card.hidden), [false, true, false]);
  const before = writes;
  click('科幻');
  assert.equal(writes, before);
  click('悬疑');
  assert.deepEqual(cards.map(card => card.hidden), [true, false, true]);
  click('全部');
  assert.ok(cards.every(card => !card.hidden));
});

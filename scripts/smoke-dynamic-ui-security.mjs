import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const [douban, ui, playerSwitch, player, app, searchUi, indexHtml, indexBundle, playerBundle, switchBundle] = await Promise.all([
  read('js/douban.js'),
  read('js/ui.js'),
  read('js/player-resource-switch.js'),
  read('js/player.js'),
  read('js/app.js'),
  read('js/search-ui.js'),
  read('index.html'),
  read('compiled/index.min.js'),
  read('compiled/player.min.js'),
  read('compiled/player-switch.min.js')
]);

assert.doesNotMatch(douban, /onclick=["'][^"']*fillAndSearchWithDouban/i);
assert.doesNotMatch(douban, /\sonerror\s*=/i);
assert.match(douban, /data-douban-title=/);
assert.match(douban, /getSafeDoubanSourceUrl/);
assert.match(douban, /label\.textContent = tag/);
assert.match(douban, /normalizeStoredTags/);
assert.doesNotMatch(douban, /\$\{currentTags\.length \? currentTags\.map/);
assert.match(douban, /doubanPaginationAbortController/);
assert.match(douban, /buildDoubanFilterKey\(\) !== cacheKey/);

const doubanCardSearch = douban.slice(
  douban.indexOf('async function fillAndSearchWithDouban'),
  douban.indexOf('// 渲染大类切换器')
);
assert.doesNotMatch(doubanCardSearch, /history\.pushState/);

assert.doesNotMatch(ui, /onclick=["'][^"']*playFromHistory/i);
assert.doesNotMatch(ui, /onclick=["'][^"']*deleteHistoryItem/i);
assert.match(ui, /data-history-item/);
assert.match(ui, /escapeUiHtml/);

assert.doesNotMatch(playerSwitch, /onclick=["'][^"']*switchToResource/i);
assert.doesNotMatch(playerSwitch, /\sonerror\s*=/i);
assert.match(playerSwitch, /data-resource-switch/);

assert.doesNotMatch(player, /<span>\$\{resourceName\}<\/span>/);
assert.doesNotMatch(player, /id="switchResourceBtn"\s+onclick=/);
assert.match(player, /resourceCurrentName'\)\.textContent/);
assert.match(player, /longPressSpeedCleanup\?\.\(\)/);
assert.match(player, /playerProgressListenerCleanup\?\.\(\)/);
assert.match(player, /fastForward:\s*false/);
assert.match(player, /clearHlsVideoListeners\(video\)/);
assert.match(player, /removeEventListener\('playing', handleHlsPlaying\)/);
assert.match(player, /orientation\.unlock\(\)/);
for (const eventName of ['touchstart', 'touchend', 'touchcancel', 'touchmove', 'pause']) {
  assert.match(player, new RegExp(`removeEventListener\\('${eventName}'`));
}
assert.match(player, /removeEventListener\('timeupdate', handleProgressTimeUpdate\)/);
assert.match(player, /removeEventListener\('mouseout', handleMouseOut\)/);

assert.match(app, /escapeAppHtml\(api\.name\)/);
assert.match(app, /escapeAppHtml\(api\.url\)/);
assert.match(app, /escapeAppHtml\(api\.detail\)/);
assert.match(app, /allowedKeys\.has\(key\)/);
assert.doesNotMatch(app, /for\s*\(\s*let\s+item\s+in\s+config\.data\s*\)/);
assert.match(app, /activeDetailAbortController\?\.abort\(\)/);
assert.match(app, /requestSeq === activeDetailRequestSeq/);
assert.match(app, /episodesGrid'\)\?\.addEventListener\('click'/);
assert.match(app, /validatePortableConfigValue\(key, value\)/);
assert.match(app, /previousValues = new Map/);
assert.match(searchUi, /signal: options\.signal/);

const [search, sourceHealth] = await Promise.all([
  read('js/search.js'),
  read('js/source-health.js')
]);
assert.match(search, /class SourceSearchError extends Error/);
assert.match(search, /throw new SourceSearchError\('数据源返回格式无效'\)/);
assert.match(sourceHealth, /STATUS_RETRY_DELAY/);
assert.match(sourceHealth, /retryDue/);

for (const [triggerId, panelId] of [
  ['historyToggleButton', 'historyPanel'],
  ['settingsToggleButton', 'settingsPanel']
]) {
  assert.match(
    indexHtml,
    new RegExp(`id="${triggerId}"[^>]*aria-controls="${panelId}"[^>]*aria-expanded="false"`)
  );
}
assert.match(ui, /trigger\?\.setAttribute\('aria-expanded', String\(isOpen\)\)/);
assert.match(ui, /trigger\.focus\(\{ preventScroll: true \}\)/);

for (const bundle of [indexBundle, playerBundle, switchBundle]) {
  assert.doesNotMatch(bundle, /onclick=["'][^"']*(?:fillAndSearchWithDouban|playFromHistory|switchToResource)/i);
}

console.log(JSON.stringify({
  ok: true,
  doubanCards: 'delegated',
  viewingHistory: 'delegated',
  resourceSwitch: 'delegated',
  thirdPartyTextEscaped: true,
  importedSettingsAllowlisted: true,
  staleRequestsCancelled: true,
  playerListenersCleaned: true,
  drawerAccessibilityState: true
}, null, 2));

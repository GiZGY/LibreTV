import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildManifest = JSON.parse(fs.readFileSync(path.join(root, 'compiled/manifest.json'), 'utf8'));
const manifest = buildManifest.bundles;
const staticAssets = buildManifest.staticAssets;
const budgets = JSON.parse(fs.readFileSync(path.join(root, 'performance-budgets.json'), 'utf8'));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function countMatches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}

function compressedBytes(relativePath) {
  const input = fs.readFileSync(path.join(root, relativePath));
  return brotliCompressSync(input, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11
    }
  }).byteLength;
}

function assertAssetReference(html, asset) {
  assert.match(
    html,
    new RegExp(`${asset.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=${asset.hash}`),
    `${asset.file} hash in HTML must match compiled manifest`
  );
}

function checkPage(pageName, htmlFile, bundleName) {
  const html = read(htmlFile);
  const budget = budgets[pageName];
  const stylesheetCount = countMatches(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi);
  const externalScriptCount = countMatches(html, /<script\b[^>]*src=["'][^"']+["'][^>]*>/gi);
  assert.ok(stylesheetCount <= budget.maxStylesheets, `${pageName} stylesheet budget exceeded: ${stylesheetCount}`);
  assert.ok(externalScriptCount <= budget.maxExternalScripts, `${pageName} script budget exceeded: ${externalScriptCount}`);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:js|css)\/(?!watch)/i, `${pageName} still loads unbundled app assets`);

  const bundle = manifest[bundleName];
  const result = { stylesheets: stylesheetCount, scripts: externalScriptCount };
  if (bundle.js) {
    assertAssetReference(html, bundle.js);
    assert.ok(bundle.js.bytes <= budget.maxJsBytes, `${pageName} JS raw budget exceeded: ${bundle.js.bytes}`);
    const brotli = compressedBytes(bundle.js.file);
    if (budget.maxJsBrotliBytes) {
      assert.ok(brotli <= budget.maxJsBrotliBytes, `${pageName} JS Brotli budget exceeded: ${brotli}`);
    }
    result.js = { raw: bundle.js.bytes, brotli };
  }
  if (bundle.css) {
    assertAssetReference(html, bundle.css);
    assert.ok(bundle.css.bytes <= budget.maxCssBytes, `${pageName} CSS raw budget exceeded: ${bundle.css.bytes}`);
    const brotli = compressedBytes(bundle.css.file);
    if (budget.maxCssBrotliBytes) {
      assert.ok(brotli <= budget.maxCssBrotliBytes, `${pageName} CSS Brotli budget exceeded: ${brotli}`);
    }
    result.css = { raw: bundle.css.bytes, brotli };
  }
  return result;
}

const index = checkPage('index', 'index.html', 'index');
const player = checkPage('player', 'player.html', 'player');
const watch = checkPage('watch', 'watch.html', 'watch');
const playerSwitchBudget = budgets.playerSwitch;
const playerSwitch = manifest.playerSwitch.js;
assertAssetReference(read('player.html'), playerSwitch);
assert.ok(playerSwitch.bytes <= playerSwitchBudget.maxJsBytes, `player switch JS raw budget exceeded: ${playerSwitch.bytes}`);
const playerSwitchBrotli = compressedBytes(playerSwitch.file);
assert.ok(
  playerSwitchBrotli <= playerSwitchBudget.maxJsBrotliBytes,
  `player switch JS Brotli budget exceeded: ${playerSwitchBrotli}`
);
const qualityRuntimeBudget = budgets.qualityRuntime;
const qualityRuntime = manifest.qualityRuntime.js;
assertAssetReference(read('index.html'), qualityRuntime);
assert.ok(
  qualityRuntime.bytes <= qualityRuntimeBudget.maxJsBytes,
  `quality runtime JS raw budget exceeded: ${qualityRuntime.bytes}`
);
const qualityRuntimeBrotli = compressedBytes(qualityRuntime.file);
assert.ok(
  qualityRuntimeBrotli <= qualityRuntimeBudget.maxJsBrotliBytes,
  `quality runtime JS Brotli budget exceeded: ${qualityRuntimeBrotli}`
);

const indexHtml = read('index.html');
const playerHtml = read('player.html');
const watchHtml = read('watch.html');
const indexCss = read(manifest.index.css.file);
const playerCss = read(manifest.player.css.file);
const doubanSource = read('js/douban.js');
const passwordSource = read('js/password.js');
const uiSource = read('js/ui.js');
const appSource = read('js/app.js');
assert.doesNotMatch(indexCss, /}\s*;\s*\.douban-/, 'homepage-specific CSS must not follow an invalid bundle separator');
assert.doesNotMatch(playerCss, /}\s*;\s*body,html/, 'player-specific CSS must not follow an invalid bundle separator');
assert.match(indexCss, /\.douban-mode-switches\{/, 'homepage-specific CSS is missing from the compiled bundle');
assert.match(indexCss, /\[data-douban-initial=disabled\] #doubanArea\{display:none\}/, 'Douban preflight visibility rule is missing');
assert.match(indexCss, /\.douban-skeleton-card\{/, 'Douban layout skeleton CSS is missing');
assert.match(playerCss, /body,html\{[^}]*background-color:#050505/, 'player background rule is missing from the compiled bundle');
assert.match(indexHtml, /rel=["']preload["'][^>]+openstream-logo\.svg/i, 'homepage logo should be preloaded');
assert.match(playerHtml, /rel=["']preload["'][^>]+openstream-logo\.svg/i, 'player logo should be preloaded');
assert.match(playerHtml, /data-player-switch-src=["']compiled\/player-switch\.min\.js\?v=[a-f0-9]+["']/i, 'player switch module must be lazy-loadable');
assert.doesNotMatch(playerHtml, /<script\b[^>]*src=["'][^"']*player-switch\.min\.js/i, 'player switch module must not block player startup');
assert.match(indexHtml, /data-quality-runtime-src=["']compiled\/quality-runtime\.min\.js\?v=[a-f0-9]+["']/i, 'quality runtime must be lazy-loadable');
assert.doesNotMatch(indexHtml, /<script\b[^>]*src=["'][^"']*quality-runtime\.min\.js/i, 'quality runtime must not block homepage startup');
assert.doesNotMatch(watchHtml, /http-equiv=["']refresh["']/i, 'watch page must not use delayed meta refresh');
assert.match(watchHtml, /compiled\/watch\.min\.js[^>]+async/i, 'watch redirect script must not wait for CSS');
assert.doesNotMatch(indexHtml, /id=["']doubanArea["'][^>]*\bhidden\b/i, 'Douban layout must be reserved before auth resolves');
assert.equal(
  countMatches(indexHtml, /class=["']douban-skeleton-card["']/g),
  16,
  'homepage should reserve one skeleton for every initial Douban card'
);
assert.match(
  doubanSource,
  /function isDoubanFeatureEnabled\(\)[\s\S]*!localStorage\.getItem\('hasInitializedDefaults'\)/,
  'first visit must treat Douban as enabled before defaults are persisted'
);
assert.match(
  doubanSource,
  /loading="\$\{index === 0 \? 'eager' : 'lazy'\}"/,
  'only the first Douban poster should compete for high-priority LCP bandwidth'
);
assert.doesNotMatch(
  passwordSource,
  /window\.initDouban\?\.\(\)/,
  'auth completion must not trigger a duplicate Douban render'
);
assert.match(indexCss, /#douban-tags-wrap\{min-height:42px\}/, 'Douban tag row must reserve its final height');
assert.match(indexHtml, /window\.__openStreamAuthStatusPromise = authStatusPromise/, 'auth status must start before the deferred bundle');
assert.match(passwordSource, /const preloadedRequest = window\.__openStreamAuthStatusPromise/, 'password flow must reuse the early auth status request');
for (const panelId of ['historyPanel', 'settingsPanel']) {
  assert.match(
    indexHtml,
    new RegExp(`id=["']${panelId}["'][^>]*aria-hidden=["']true["'][^>]*\\binert\\b`),
    `${panelId} must start outside the accessibility tree`
  );
}
assert.match(uiSource, /panel\.inert = !isOpen/, 'drawer visibility and accessibility state must stay synchronized');
assert.doesNotMatch(appSource, /function toggleSettings\(/, 'settings drawer must not have a competing implementation');

for (const file of ['index.html', 'player.html', 'about.html', 'privacy.html', 'watch.html']) {
  const html = read(file);
  assertAssetReference(html, staticAssets.logo);
  const logos = Array.from(html.matchAll(/<img\b[^>]*openstream-logo\.svg[^>]*>/gi));
  logos.forEach(([tag]) => {
    assert.match(tag, /\bwidth=["']\d+["']/i, `${file} logo is missing width`);
    assert.match(tag, /\bheight=["']\d+["']/i, `${file} logo is missing height`);
  });
}
assertAssetReference(read('manifest.json'), staticAssets.logo);
assertAssetReference(read('js/config.js'), staticAssets.logo);
assertAssetReference(read('js/player-resource-switch.js'), staticAssets.nomedia);
assertAssetReference(playerHtml, staticAssets.hls);
assertAssetReference(playerHtml, staticAssets.artplayer);
assert.match(
  playerHtml,
  /<script\b[^>]*src=["']libs\/hls\.min\.js\?v=[a-f0-9]{12}["'][^>]*defer/i,
  'HLS runtime must be deferred and content-versioned'
);
assert.match(
  playerHtml,
  /<script\b[^>]*src=["']libs\/artplayer\.min\.js\?v=[a-f0-9]{12}["'][^>]*defer/i,
  'Artplayer runtime must be deferred and content-versioned'
);

const requiredPublicFiles = [
  'VERSION.txt',
  'about.html',
  'compiled/base.min.css',
  'compiled/index.min.css',
  'compiled/index.min.js',
  'compiled/manifest.json',
  'compiled/player-switch.min.js',
  'compiled/player.min.css',
  'compiled/player.min.js',
  'compiled/quality-runtime.min.js',
  'compiled/watch.min.css',
  'compiled/watch.min.js',
  'image/nomedia.png',
  'image/openstream-logo.svg',
  'index.html',
  'libs/artplayer.min.js',
  'libs/hls.min.js',
  'manifest.json',
  'player.html',
  'privacy.html',
  'robots.txt',
  'watch.html'
];
requiredPublicFiles.forEach((relativePath) => {
  assert.ok(fs.existsSync(path.join(root, 'public', relativePath)), `Vercel output missing ${relativePath}`);
});
function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}
const actualPublicFiles = listFiles(path.join(root, 'public')).sort();
assert.deepEqual(actualPublicFiles, [...requiredPublicFiles].sort(), 'Vercel static allowlist changed unexpectedly');
assert.equal(read('public/index.html'), read('index.html'), 'Vercel homepage output must match built homepage');
for (const forbiddenPath of ['api', 'server', 'js/app.js', '.env', 'package.json']) {
  assert.ok(
    !fs.existsSync(path.join(root, 'public', forbiddenPath)),
    `Vercel static output must not expose ${forbiddenPath}`
  );
}

console.log(JSON.stringify({
  ok: true,
  index,
  player: {
    ...player,
    lazySwitch: { raw: playerSwitch.bytes, brotli: playerSwitchBrotli }
  },
  qualityRuntime: { raw: qualityRuntime.bytes, brotli: qualityRuntimeBrotli },
  watch,
  vercelOutputFiles: actualPublicFiles.length
}, null, 2));

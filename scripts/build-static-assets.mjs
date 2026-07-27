import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'compiled');
const publicDir = path.join(root, 'public');
const publicFiles = [
  'VERSION.txt',
  'about.html',
  'index.html',
  'manifest.json',
  'player.html',
  'privacy.html',
  'robots.txt',
  'watch.html'
];
const publicDirectories = ['compiled', 'image', 'libs'];

const bundles = {
  index: {
    js: [
      'js/config.js',
      'js/proxy-auth.js',
      'js/customer_site.js',
      'js/ui.js',
      'js/api.js',
      'js/douban.js',
      'js/password.js',
      'js/search.js',
      'js/source-health.js',
      'js/source-adapter.js',
      'js/player-episodes.js',
      'js/result-aggregator.js',
      'js/streaming-search.js',
      'js/search-ui.js',
      'js/hash.js',
      'js/app.js',
      'js/version-check.js',
      'js/index-page.js'
    ],
    css: [
      'css/tailwind.generated.css',
      'css/styles.css',
      'css/index.css'
    ]
  },
  qualityRuntime: {
    outputName: 'quality-runtime',
    js: [
      'js/quality-selection.js',
      'js/playback-quality.js'
    ]
  },
  player: {
    js: [
      'js/config.js',
      'js/proxy-auth.js',
      'js/customer_site.js',
      'js/password.js',
      'js/ui.js',
      'js/api.js',
      'js/search.js',
      'js/source-health.js',
      'js/source-adapter.js',
      'js/playback-health.js',
      'js/player-episodes.js',
      'js/player.js',
      'js/player-resource-loader.js',
      'js/version-check.js'
    ],
    css: [
      'css/tailwind.generated.css',
      'css/styles.css',
      'css/player.css'
    ]
  },
  playerSwitch: {
    outputName: 'player-switch',
    js: [
      'js/player-resource-switch.js'
    ]
  },
  base: {
    css: [
      'css/tailwind.generated.css',
      'css/styles.css'
    ]
  },
  watch: {
    js: [
      'js/watch.js'
    ],
    css: [
      'css/watch.css'
    ]
  }
};

async function readCombined(files, preamble = '', separator = '\n;\n') {
  const chunks = await Promise.all(files.map(async (relativePath) => {
    const source = await fs.readFile(path.join(root, relativePath), 'utf8');
    return `\n/* ${relativePath} */\n${source}\n`;
  }));
  return `${preamble}\n${chunks.join(separator)}`;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function buildJavaScript(name, files) {
  const source = await readCombined(files);
  const result = await transform(source, {
    loader: 'js',
    target: 'es2020',
    legalComments: 'none',
    minifyWhitespace: true,
    minifySyntax: true,
    // Inline handlers and legacy modules call top-level functions by name.
    minifyIdentifiers: false
  });
  // Template literals can preserve indentation before newlines even after
  // minification. Normalize it so generated artifacts remain diff-clean.
  const code = result.code.replace(/[\t ]+$/gm, '');
  const fileName = `${name}.min.js`;
  await fs.writeFile(path.join(outputDir, fileName), code);
  return { file: `compiled/${fileName}`, hash: shortHash(code), bytes: Buffer.byteLength(code) };
}

async function buildCss(name, files) {
  // A top-level semicolon between stylesheets can make browsers discard every
  // rule after an @media block. CSS files need plain whitespace separation.
  const source = await readCombined(files, '', '\n');
  const result = await transform(source, {
    loader: 'css',
    target: 'es2020',
    legalComments: 'none',
    minify: true
  });
  const fileName = `${name}.min.css`;
  await fs.writeFile(path.join(outputDir, fileName), result.code);
  return { file: `compiled/${fileName}`, hash: shortHash(result.code), bytes: Buffer.byteLength(result.code) };
}

async function describeStaticAsset(relativePath) {
  const contents = await fs.readFile(path.join(root, relativePath));
  return {
    file: relativePath,
    hash: shortHash(contents),
    bytes: contents.byteLength
  };
}

async function updateAssetVersion(fileName, assetPath, hash) {
  const absolutePath = path.join(root, fileName);
  const current = await fs.readFile(absolutePath, 'utf8');
  const escapedPath = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`${escapedPath}(?:\\?v=[^"'\\s>]+)?`, 'g');
  if (!current.includes(assetPath)) {
    throw new Error(`${fileName} does not reference ${assetPath}`);
  }
  const next = current.replace(matcher, `${assetPath}?v=${hash}`);
  if (next !== current) {
    await fs.writeFile(absolutePath, next);
  }
}

await fs.mkdir(outputDir, { recursive: true });

const staticAssets = {
  logo: await describeStaticAsset('image/openstream-logo.svg'),
  nomedia: await describeStaticAsset('image/nomedia.png'),
  hls: await describeStaticAsset('libs/hls.min.js'),
  artplayer: await describeStaticAsset('libs/artplayer.min.js')
};

// Runtime-created image URLs also need content versions before bundling.
await updateAssetVersion('js/config.js', staticAssets.logo.file, staticAssets.logo.hash);
await updateAssetVersion('js/player-resource-switch.js', staticAssets.nomedia.file, staticAssets.nomedia.hash);

const manifest = {};
for (const [name, config] of Object.entries(bundles)) {
  manifest[name] = {};
  const outputName = config.outputName || name;
  if (config.js) manifest[name].js = await buildJavaScript(outputName, config.js);
  if (config.css) manifest[name].css = await buildCss(outputName, config.css);
}

// Update each HTML file sequentially so two asset replacements cannot overwrite
// one another with stale file contents.
await updateAssetVersion('index.html', manifest.index.js.file, manifest.index.js.hash);
await updateAssetVersion('index.html', manifest.index.css.file, manifest.index.css.hash);
await updateAssetVersion('index.html', manifest.qualityRuntime.js.file, manifest.qualityRuntime.js.hash);
await updateAssetVersion('player.html', manifest.player.js.file, manifest.player.js.hash);
await updateAssetVersion('player.html', manifest.player.css.file, manifest.player.css.hash);
await updateAssetVersion('player.html', manifest.playerSwitch.js.file, manifest.playerSwitch.js.hash);
await updateAssetVersion('about.html', manifest.base.css.file, manifest.base.css.hash);
await updateAssetVersion('privacy.html', manifest.base.css.file, manifest.base.css.hash);
await updateAssetVersion('watch.html', manifest.watch.js.file, manifest.watch.js.hash);
await updateAssetVersion('watch.html', manifest.watch.css.file, manifest.watch.css.hash);
for (const htmlFile of ['index.html', 'player.html', 'about.html', 'privacy.html', 'watch.html']) {
  await updateAssetVersion(htmlFile, staticAssets.logo.file, staticAssets.logo.hash);
}
await updateAssetVersion('manifest.json', staticAssets.logo.file, staticAssets.logo.hash);
await updateAssetVersion('player.html', staticAssets.hls.file, staticAssets.hls.hash);
await updateAssetVersion('player.html', staticAssets.artplayer.file, staticAssets.artplayer.hash);

await fs.writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), bundles: manifest, staticAssets }, null, 2)}\n`
);

// Vercel deploys only this allowlisted static tree. Keeping source JS, server
// modules and local environment files outside it prevents accidental exposure.
await fs.rm(publicDir, { recursive: true, force: true });
await fs.mkdir(publicDir, { recursive: true });
await Promise.all(publicFiles.map((fileName) => (
  fs.copyFile(path.join(root, fileName), path.join(publicDir, fileName))
)));
await Promise.all(publicDirectories.map((directory) => (
  fs.cp(path.join(root, directory), path.join(publicDir, directory), { recursive: true })
)));

console.log(JSON.stringify(manifest, null, 2));

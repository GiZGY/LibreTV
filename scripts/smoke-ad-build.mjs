import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'openstream-ad-build-'));
try {
  // Exercise the real builder without rewriting the dirty checkout or copying secrets.
  const inputs = ['VERSION.txt', 'package.json', 'index.html', 'player.html',
    'about.html', 'privacy.html', 'watch.html', 'manifest.json', 'robots.txt',
    'js', 'css', 'image', 'libs'];
  for (const input of inputs) await fs.cp(path.join(root, input), path.join(temporary, input), { recursive: true });
  await fs.mkdir(path.join(temporary, 'scripts'));
  await fs.copyFile(path.join(root, 'scripts/build-static-assets.mjs'), path.join(temporary, 'scripts/build-static-assets.mjs'));
  await fs.symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
  execFileSync(process.execPath, ['scripts/build-static-assets.mjs'], { cwd: temporary, stdio: 'pipe' });
  const manifest = JSON.parse(await fs.readFile(path.join(temporary, 'compiled/manifest.json'), 'utf8'));
  const asset = manifest.bundles.player.js;
  const bundle = await fs.readFile(path.join(temporary, 'public', asset.file), 'utf8');
  const html = await fs.readFile(path.join(temporary, 'public/player.html'), 'utf8');
  assert.ok(html.includes(`${asset.file}?v=${asset.hash}`), 'HTML must select the current content version');
  const context = { window: {} };
  vm.runInNewContext(await fs.readFile(path.join(root, 'js/ad-rules.js'), 'utf8'), context);
  const skip = context.window.OpenStreamAdRules;
  const overlay = context.window.OpenStreamOverlayRules;
  for (const rule of [...skip, ...overlay]) {
    assert.ok(bundle.includes(rule.id), `missing rule ${rule.id}`);
    for (const segment of rule.segments) assert.ok(bundle.includes(segment.sha256), 'missing fingerprint');
  }
  assert.ok(bundle.includes('inspectionLimitHits'), 'current guard must be bundled');
  assert.ok(bundle.includes('decryptForInspection'), 'AES inspection must be bundled');
  const config = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
  const entryPolicy = config.headers.find(item => item.source === '/');
  assert.ok(entryPolicy.headers.some(header => header.key === 'Cache-Control' && header.value.includes('must-revalidate')));
  for (const forbidden of ['.env.local', 'services', 'scripts', 'node_modules']) {
    await assert.rejects(fs.access(path.join(temporary, 'public', forbidden)));
  }
  console.log(JSON.stringify({ ok: true, skipRules: skip.length, overlayRules: overlay.length,
    playerHash: asset.hash, bytes: asset.bytes, scope: 'existing Vercel build only; sibling new UI migration is not included' }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

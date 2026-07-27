import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitUntilReady(origin, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

const port = await getFreePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    DEBUG: 'false',
    CORS_ORIGIN: '*',
    NODE_ENV: 'test',
    PASSWORD: 'static-smoke-password',
    PORT: String(port)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitUntilReady(origin, child);

  const index = await fetch(`${origin}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('cache-control') || '', /no-store/);

  const corsResponse = await fetch(`${origin}/`, {
    headers: { Origin: 'https://client.example' }
  });
  assert.equal(corsResponse.headers.get('access-control-allow-origin'), '*');
  assert.equal(corsResponse.headers.get('access-control-allow-credentials'), null);

  const compiled = await fetch(`${origin}/compiled/index.min.js`);
  assert.equal(compiled.status, 200);
  assert.match(compiled.headers.get('cache-control') || '', /immutable/);

  const image = await fetch(`${origin}/image/openstream-logo.svg`);
  assert.equal(image.status, 200);

  const version = await fetch(`${origin}/VERSION.txt`);
  assert.equal(version.status, 200);
  assert.match(version.headers.get('cache-control') || '', /no-store/);

  const blockedPaths = [
    '/package.json',
    '/server.mjs',
    '/js/app.js',
    '/api/proxy/%5B...path%5D.mjs',
    '/.env'
  ];
  for (const requestPath of blockedPaths) {
    const response = await fetch(`${origin}${requestPath}`);
    assert.equal(response.status, 404, `${requestPath} must not be publicly served`);
  }

  console.log(JSON.stringify({
    ok: true,
    allowedAssets: 4,
    blockedSourcePaths: blockedPaths.length
  }, null, 2));
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
}

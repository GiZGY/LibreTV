import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sequenceId, sha256 } from './core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_STORAGE = 512 * 1024 * 1024;

async function evidenceSize(directory) {
  let size = 0;
  for (const file of await fs.readdir(directory)) {
    const stat = await fs.lstat(path.join(directory, file));
    if (!stat.isFile()) throw new Error('Unexpected evidence entry');
    size += stat.size;
  }
  return size;
}

export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function readSnapshot(directory) {
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute private data path');
  const root = await fs.realpath(directory);
  if (((await fs.stat(root)).mode & 0o077) !== 0 ||
    await fs.readFile(path.join(root, '.openstream-ad-observer'), 'utf8') !== 'schema=1\n') throw new Error('Invalid store');
  const file = path.join(root, 'state.json');
  if ((await fs.lstat(file)).size > 8 * 1024 * 1024) throw new Error('State exceeds limit');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  if (state.schema !== 1 || !state.candidates || Array.isArray(state.candidates)) throw new Error('Invalid state');
  return state;
}

export async function openStore(directory) {
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute private data path');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await fs.realpath(directory);
  const repository = await fs.realpath(ROOT);
  if (directory === repository || directory.startsWith(repository + path.sep)) throw new Error('Data must be outside repository');
  const stat = await fs.stat(directory);
  if ((stat.mode & 0o077) !== 0) throw new Error('Data directory must have mode 0700');
  const marker = path.join(directory, '.openstream-ad-observer');
  try {
    if (await fs.readFile(marker, 'utf8') !== 'schema=1\n') throw new Error('Unknown data directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if ((await fs.readdir(directory)).length) throw new Error('Use an empty dedicated data directory');
    await fs.writeFile(marker, 'schema=1\n', { flag: 'wx', mode: 0o600 });
  }
  const lockPath = path.join(directory, 'worker.lock');
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Store is locked; stop the active worker or verify a stale lock before recovery');
  }
  try {
    return await initializeStore(directory, handle, lockPath);
  } catch (error) {
    await handle.close(); await fs.unlink(lockPath); throw error;
  }
}

async function initializeStore(directory, handle, lockPath) {
  await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() }));
  const statePath = path.join(directory, 'state.json');
  let state;
  try {
    if ((await fs.lstat(statePath)).size > 8 * 1024 * 1024) throw new Error('State exceeds limit');
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    if (state.schema !== 1 || !state.candidates || Array.isArray(state.candidates) ||
      !Number.isSafeInteger(state.runs) || state.runs < 0 || Object.keys(state.candidates).length > 500) throw new Error('Invalid state');
    for (const [id, entry] of Object.entries(state.candidates)) {
      if (!/^[a-f0-9]{64}$/.test(id) || !Array.isArray(entry.segments) || entry.segments.length < 2 || entry.segments.length > 100 ||
        !entry.segments.every(s => Number.isFinite(s.duration) && s.duration > 0 && /^[a-f0-9]{64}$/.test(s.sha256)) ||
        entry.segments.reduce((sum, s) => sum + s.duration, 0) > 120 ||
        sequenceId(entry.segments) !== id || entry.id !== id ||
        !Number.isFinite(Date.parse(entry.firstSeen)) || !Number.isFinite(Date.parse(entry.lastSeen)) ||
        !Array.isArray(entry.observations) || entry.observations.length > 40) throw new Error('Invalid candidate');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { schema: 1, runs: 0, candidates: {} };
  }
  const evidenceRoot = path.join(directory, 'evidence');
  await fs.mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  let used = 0;
  for (const id of await fs.readdir(evidenceRoot)) {
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    if (!(await fs.lstat(path.join(evidenceRoot, id))).isDirectory()) throw new Error('Unexpected evidence path');
    used += await evidenceSize(path.join(evidenceRoot, id));
  }
  // Serialize writes because two sources can discover the same sequence concurrently.
  let writes = Promise.resolve();
  async function saveEvidence(id, segments, buffers) {
    const operation = writes.then(async () => {
      if (!/^[a-f0-9]{64}$/.test(id) || sequenceId(segments) !== id) throw new Error('Invalid evidence ID');
      const destination = path.join(evidenceRoot, id);
      try { await fs.access(path.join(destination, 'complete.json')); return true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const manifest = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...segments.map(s => s.duration)))}`,
        ...segments.flatMap((s, i) => [`#EXTINF:${s.duration},`, `${i}.bin`]), '#EXT-X-ENDLIST'].join('\n');
      const size = buffers.reduce((sum, b) => sum + b.length, 0) + Buffer.byteLength(manifest) +
        Buffer.byteLength(JSON.stringify({ id, segments }, null, 2) + '\n');
      if (used + size > MAX_STORAGE) return false;
      // Reserve before writing. A failed partial write still consumes capacity until cleanup/restart.
      used += size;
      await fs.mkdir(destination, { recursive: true, mode: 0o700 });
      for (let i = 0; i < buffers.length; i++) await fs.writeFile(path.join(destination, `${i}.bin`), buffers[i], { mode: 0o600 });
      await fs.writeFile(path.join(destination, 'preview.m3u8'), manifest, { mode: 0o600 });
      await atomicJson(path.join(destination, 'complete.json'), { id, segments });
      return true;
    });
    writes = operation.catch(() => {});
    return operation;
  }
  return { directory, state, saveEvidence,
    async verifyEvidence(entry) {
      const dir = path.join(evidenceRoot, entry.id);
      for (const [i, segment] of entry.segments.entries()) {
        if (sha256(await fs.readFile(path.join(dir, `${i}.bin`))) !== segment.sha256) throw new Error('Evidence changed');
      }
      return sequenceId(entry.segments);
    },
    async save() { await writes; await atomicJson(statePath, state); },
    async collectExpiredEvidence() {
      await writes;
      for (const id of await fs.readdir(evidenceRoot)) {
        if (/^[a-f0-9]{64}$/.test(id) && !state.candidates[id]) {
          const dir = path.join(evidenceRoot, id);
          const size = await evidenceSize(dir);
          await fs.rm(dir, { recursive: true });
          used = Math.max(0, used - size);
        }
      }
    },
    async close() { await writes; await handle.close(); await fs.unlink(lockPath); }
  };
}

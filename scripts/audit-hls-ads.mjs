import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function parseMediaPlaylist(text) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Not an HLS playlist');
  if (text.includes('#EXT-X-STREAM-INF:')) throw new Error('Supply a media playlist, not a master playlist');
  let start = 0;
  let duration = null;
  let cc = 0;
  let byteRange = '';
  let encrypted = false;
  let initMap = false;
  let gap = false;
  const fragments = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line === '#EXT-X-DISCONTINUITY') cc += 1;
    else if (line.startsWith('#EXT-X-BYTERANGE:')) byteRange = line.slice(17);
    else if (line.startsWith('#EXT-X-KEY:')) encrypted = !/^#EXT-X-KEY:METHOD=NONE(?:,|$)/.test(line);
    else if (line.startsWith('#EXT-X-MAP:')) initMap = true;
    else if (line === '#EXT-X-GAP') gap = true;
    else if (line && !line.startsWith('#')) {
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Missing or invalid segment duration');
      fragments.push({ sn: fragments.length, url: line, duration, start, cc, byteRange, encrypted, initMap, gap });
      start += duration;
      duration = null;
      byteRange = '';
      gap = false;
    }
  }
  if (duration !== null || !fragments.length) throw new Error('Incomplete media playlist');
  return fragments;
}

export function auditPlaylist(text) {
  const fragments = parseMediaPlaylist(text);
  const blocks = [];
  for (const frag of fragments) {
    if (!blocks.length || blocks.at(-1)[0].cc !== frag.cc) blocks.push([]);
    blocks.at(-1).push(frag);
  }
  const repeated = new Map();
  for (const block of blocks) {
    const signature = createHash('sha256').update(JSON.stringify(block.map(frag => [frag.url, frag.duration, frag.byteRange]))).digest('hex');
    const occurrences = repeated.get(signature) || [];
    occurrences.push({ start: block[0].start, end: block.at(-1).start + block.at(-1).duration, segments: block.length });
    repeated.set(signature, occurrences);
  }
  return {
    playlistSha256: createHash('sha256').update(text).digest('hex'),
    duration: fragments.at(-1).start + fragments.at(-1).duration,
    segments: fragments.length,
    blocks: blocks.length,
    hasEndList: text.includes('#EXT-X-ENDLIST'),
    candidates: [...repeated].filter(([, occurrences]) => occurrences.length > 1).map(([id, occurrences]) => ({
      id, status: 'needs_content_verification', occurrences
    }))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/audit-hls-ads.mjs <media-playlist.m3u8> [...]');
    process.exitCode = 1;
  }
  for (const file of files) {
    try {
      // Reports intentionally omit segment URLs and credentials in URL queries.
      console.log(JSON.stringify(auditPlaylist(await fs.readFile(file, 'utf8')), null, 2));
    } catch (error) {
      console.error(`Playlist audit failed: ${error.code || error.message}`);
      process.exitCode = 1;
    }
  }
}

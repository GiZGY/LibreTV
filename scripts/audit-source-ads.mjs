import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchWithTimeout, readResponseText } from '../bridge/tvbox-bridge/src/http.mjs';
import { auditPlaylist } from './audit-hls-ads.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const QUERIES = [
  { keyword: 'X战警', title: 'X战警：天启' },
  { keyword: '飞驰人生2', title: '飞驰人生2' }
];
const normalize = value => String(value || '').replace(/[\s：:·\-]/g, '').toLowerCase();

export function selectMovie(list, title) {
  return (Array.isArray(list) ? list : []).find(item => normalize(item.vod_name) === normalize(title));
}

export function cmsPlaylists(video) {
  const urls = String(video?.vod_play_url || '').split('$$$').flatMap(line => line.split('#'))
    .map(episode => episode.slice(episode.indexOf('$') + 1).trim())
    .filter(url => /^https?:\/\/[^\s]+\.m3u8(?:[?#].*)?$/i.test(url));
  return [...new Set(urls)].slice(0, 2);
}

export function failureStatus(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  if (error?.status === 401 || error?.status === 403) return 'access_denied';
  if (error?.code?.startsWith('ERR_BLOCKED')) return 'blocked_address';
  if (error?.code === 'RESPONSE_TOO_LARGE') return 'response_too_large';
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'fetch_failed';
}

async function requestText(url, signal) {
  return fetchWithTimeout(fetch, url, { headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0' } }, {
    timeoutMs: 12000, signal,
    consume: async response => {
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error('Upstream request failed');
        error.status = response.status;
        throw error;
      }
      return { text: await readResponseText(response, 4 * 1024 * 1024), url: response.url || url };
    }
  });
}

export async function resolveMedia(url, request = requestText) {
  const visited = new Set();
  for (let depth = 0; depth < 4; depth++) {
    if (visited.has(url)) throw new Error('Playlist cycle');
    visited.add(url);
    const response = await request(url);
    const text = response.text.replace(/^\uFEFF/, '');
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid playlist');
    if (!text.includes('#EXT-X-STREAM-INF:')) return { text, url: response.url };
    // Audit one rendition only; alternate renditions are not implied verified.
    const lines = text.split(/\r?\n/).map(line => line.trim());
    const at = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
    const child = lines.slice(at + 1).find(line => line && !line.startsWith('#'));
    if (!child) throw new Error('Missing variant');
    url = new URL(child, response.url).href;
  }
  throw new Error('Playlist nesting limit');
}

async function loadSites() {
  const context = vm.createContext({ window: {}, console });
  const config = await fs.readFile(path.join(ROOT, 'js/config.js'), 'utf8');
  vm.runInContext(config.slice(config.indexOf('const API_SITES'), config.indexOf('// 添加聚合搜索')), context);
  vm.runInContext(await fs.readFile(path.join(ROOT, 'js/customer_site.js'), 'utf8'), context);
  return Object.entries(context.window.API_SITES).filter(([, site]) => !site.adult);
}

async function searchVideo(key, site, query, signal) {
  if (site.bridge) {
    if (!['tvbox:荐片', 'tvbox:瓜子'].includes(key)) return { status: 'unsupported' };
    const module = key === 'tvbox:荐片'
      ? await import('../bridge/tvbox-bridge/src/adapters/jianpian.mjs')
      : await import('../bridge/tvbox-bridge/src/adapters/guazi.mjs');
    const options = { fetchImpl: fetch, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) };
    const result = await module.search(query.keyword, options);
    if (result.status !== 'ready') return { status: result.status || 'invalid_response' };
    const item = selectMovie(result.list, query.title);
    if (!item) return { status: 'no_matching_title' };
    const detail = await module.detail(item.vod_id, options);
    if (detail.status !== 'ready') return { status: detail.status || 'invalid_response' };
    const play = await module.play(item.vod_id, '', 0, options);
    return { status: play.status, urls: play.url ? [play.url] : [] };
  }
  const url = new URL(site.api);
  url.searchParams.set('ac', 'videolist');
  url.searchParams.set('wd', query.keyword);
  const result = JSON.parse((await requestText(url.href, signal)).text);
  if (!Array.isArray(result.list)) return { status: 'invalid_response' };
  let item = selectMovie(result.list, query.title);
  if (!item) return { status: 'no_matching_title' };
  if (!item.vod_play_url) {
    url.searchParams.delete('wd');
    url.searchParams.set('ids', item.vod_id);
    item = JSON.parse((await requestText(url.href, signal)).text).list?.[0];
  }
  const urls = cmsPlaylists(item);
  return { status: urls.length ? 'ready' : 'unsupported_playback', urls };
}

export async function runAudit({ sources, evidenceDir, onResult = () => {}, onMedia, queries = QUERIES, signal } = {}) {
  if (!Array.isArray(queries) || !queries.length || queries.length > 12 || queries.some(q =>
    !q || typeof q.keyword !== 'string' || typeof q.title !== 'string' || !q.keyword.trim() || !q.title.trim() ||
    q.keyword.length > 80 || q.title.length > 80)) throw new Error('Invalid queries');
  const sites = (await loadSites()).filter(([key]) => !sources || sources.includes(key));
  if (!sites.length || sources?.some(key => !sites.some(([id]) => id === key))) throw new Error('Unknown source');
  if (evidenceDir) {
    evidenceDir = path.resolve(evidenceDir);
    if (evidenceDir === ROOT.slice(0, -1) || evidenceDir.startsWith(ROOT)) throw new Error('Evidence directory must be outside the repository');
    // Raw manifests may contain signed media URLs. Never put them in reports.
    await fs.mkdir(evidenceDir, { recursive: false, mode: 0o700 });
  }
  const rows = [];
  let cursor = 0;
  async function worker() {
    while (cursor < sites.length && !signal?.aborted) {
      const [source, site] = sites[cursor++];
      for (const query of queries) {
        const row = { source, name: site.name, title: query.title, status: 'not_executed', lines: [] };
        try {
          if (signal?.aborted) throw Object.assign(new Error('Audit aborted'), { name: 'AbortError' });
          const result = await searchVideo(source, site, query, signal);
          row.status = result.status;
          for (const [index, url] of (result.urls || []).entries()) {
            const line = { index, status: 'not_executed' };
            try {
              const media = await resolveMedia(url, target => requestText(target, signal));
              Object.assign(line, auditPlaylist(media.text), {
                status: 'manifest_analyzed',
                encrypted: /#EXT-X-KEY:.*METHOD=(?!NONE)/.test(media.text),
                byteRanges: media.text.includes('#EXT-X-BYTERANGE:'),
                contentVerification: 'not_executed'
              });
              if (evidenceDir) {
                const key = createHash('sha256').update(`${source}:${query.title}:${index}`).digest('hex').slice(0, 16);
                line.evidenceId = key;
                await fs.writeFile(path.join(evidenceDir, `${key}.json`), JSON.stringify(media), { flag: 'wx', mode: 0o600 });
              }
              if (onMedia) {
                try { line.observation = await onMedia({ source, title: query.title, index, media }); }
                catch (_) { line.observation = { status: 'observation_failed' }; }
              }
            } catch (error) { line.status = failureStatus(error); }
            row.lines.push(line);
          }
          if (result.status === 'ready') row.status = row.lines.some(line => line.status === 'manifest_analyzed') ? 'manifest_analyzed' : 'media_unavailable';
        } catch (error) { row.status = failureStatus(error); }
        rows.push(row);
        onResult(row);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sites.length) }, worker));
  return { createdAt: new Date().toISOString(), environment: 'local_direct_network',
    scope: { sources: sites.length, titlesPerSource: queries.length, linesPerTitle: 2, renditionsPerLine: 1 },
    limitation: 'Manifest candidates are not confirmed ads. Sample coverage is not full-source coverage.',
    rows: rows.sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title)) };
}

export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--out', '--sources', '--evidence-dir'].includes(flag) || !value || value.startsWith('--') || flag in options) throw new Error('Invalid arguments');
    options[flag] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) {
      console.log('Usage: npm run audit:source-ads -- [--sources source1,source2] [--out new-report.json] [--evidence-dir /tmp/new-private-directory]');
      process.exit(0);
    }
    const options = parseOptions(process.argv.slice(2));
    if (options['--out']) {
      try { await fs.lstat(options['--out']); throw new Error('Output already exists'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const report = await runAudit({ sources: options['--sources']?.split(','), evidenceDir: options['--evidence-dir'],
      onResult: row => console.error(JSON.stringify({ source: row.source, title: row.title, status: row.status, lines: row.lines.map(line => ({ status: line.status, candidates: line.candidates?.length })) })) });
    if (options['--out']) await fs.writeFile(options['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    else console.log(JSON.stringify(report, null, 2));
  } catch (_) {
    console.error('Audit could not finish; check arguments and use new output paths.');
    process.exitCode = 1;
  }
}

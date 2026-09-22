import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout, readResponseText } from '../bridge/tvbox-bridge/src/http.mjs';
import { resolveMedia, cmsPlaylists, failureStatus } from './audit-source-ads.mjs';

export async function loadSites() {
  const context = vm.createContext({ window: {}, console });
  const config = await fs.readFile(new URL('../js/config.js', import.meta.url), 'utf8');
  vm.runInContext(config.slice(config.indexOf('const API_SITES'), config.indexOf('// 添加聚合搜索')), context);
  vm.runInContext(await fs.readFile(new URL('../js/customer_site.js', import.meta.url), 'utf8'), context);
  return Object.entries(context.window.API_SITES).filter(([, site]) => !site.adult);
}

export function selectSample(list, keyword) {
  const items = (Array.isArray(list) ? list : []).filter(v => !/解说|预告/.test(v.vod_name));
  return items.find(v => v.vod_name === keyword) || items.find(v => String(v.vod_name).startsWith(keyword));
}

async function request(url, sample = false) {
  return fetchWithTimeout(fetch, url, { headers: { 'User-Agent': 'Mozilla/5.0', ...(sample ? { Range: 'bytes=0-65535' } : {}) } }, {
    timeoutMs: 10000,
    consume: async response => {
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('HTTP'), { status: response.status }); }
      if (!sample) return { text: await readResponseText(response, 4 * 1024 * 1024), url: response.url || url };
      const reader = response.body.getReader();
      let size = 0, head;
      try {
        while (size < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          head ||= value;
          size += value.length;
        }
      } finally { await reader.cancel(); }
      if (!size || /^\s*<(?:!doctype|html)/i.test(new TextDecoder().decode(head))) throw new Error('Invalid media sample');
      return { bytes: Math.min(size, 65536) };
    }
  });
}

export async function probeSite(key, site, keyword, { requestImpl = request } = {}) {
  const row = { key, name: site.name, keyword, status: 'not_executed' };
  const start = performance.now();
  try {
    let video;
    if (site.bridge) {
      const adapterName = { 'tvbox:荐片': 'jianpian', 'tvbox:瓜子': 'guazi' }[key];
      if (!adapterName) return { ...row, status: 'unsupported' };
      const adapter = await import(`../bridge/tvbox-bridge/src/adapters/${adapterName}.mjs`);
      const options = { fetchImpl: fetch, signal: AbortSignal.timeout(25000) };
      const found = await adapter.search(keyword, options);
      if (found.status !== 'ready') return { ...row, status: found.status };
      const item = selectSample(found.list, keyword);
      if (!item) return { ...row, status: 'no_result' };
      const detail = await adapter.detail(item.vod_id, options);
      if (detail.status !== 'ready') return { ...row, status: detail.status };
      const play = await adapter.play(item.vod_id, '', 0, options);
      if (play.status !== 'ready') return { ...row, status: play.status };
      video = { vod_play_url: `正片$${play.url}` };
    } else {
      const url = new URL(site.api);
      url.searchParams.set('ac', 'videolist');
      url.searchParams.set('wd', keyword);
      const data = JSON.parse((await requestImpl(url)).text);
      if (!Array.isArray(data.list)) return { ...row, status: 'invalid_response' };
      const item = selectSample(data.list, keyword);
      if (!item) return { ...row, status: 'no_result' };
      row.matchedTitle = item.vod_name;
      row.searchMs = Math.round(performance.now() - start);
      url.searchParams.delete('wd');
      url.searchParams.set('ac', 'detail');
      url.searchParams.set('ids', item.vod_id);
      video = JSON.parse((await requestImpl(url)).text).list?.find(v => String(v.vod_id) === String(item.vod_id));
      if (!video) return { ...row, status: 'invalid_detail' };
    }
    row.detail = 'ready';
    const urls = cmsPlaylists(video);
    if (!urls.length) return { ...row, status: 'unsupported_playback' };
    row.lines = [];
    for (const url of urls) {
      try {
        const media = await resolveMedia(url, requestImpl);
        const segments = media.text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
        if (!media.text.includes('#EXTINF:') || !segments.length) throw new Error('Empty playlist');
        const sample = await requestImpl(new URL(segments[Math.floor(segments.length / 2)], media.url), true);
        row.lines.push({ status: 'sample_reachable', segments: segments.length, bytes: sample.bytes });
        break;
      } catch (error) { row.lines.push({ status: failureStatus(error), http: error.status }); }
    }
    row.status = row.lines.some(l => l.status === 'sample_reachable') ? 'sample_reachable' : 'media_unavailable';
  } catch (error) { row.status = failureStatus(error); row.http = error.status; }
  row.elapsedMs = Math.round(performance.now() - start);
  return row;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const extra = process.env.SOURCE_CANDIDATES ? JSON.parse(await fs.readFile(process.env.SOURCE_CANDIDATES, 'utf8')) : {};
  const selected = process.env.SOURCE_KEYS?.split(',');
  const sites = [...await loadSites(), ...Object.entries(extra)].filter(([key]) => !selected || selected.includes(key));
  const rows = [];
  let cursor = 0;
  async function worker() {
    while (cursor < sites.length) {
      const [key, site] = sites[cursor++];
      for (const keyword of ['星际穿越', '庆余年']) {
        const row = await probeSite(key, site, keyword);
        rows.push(row);
        console.error(JSON.stringify(row));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sites.length) }, worker));
  const report = { checkedAt: new Date().toISOString(), environment: 'local direct network', limitation: 'Two titles, one midpoint segment per title. Not a decode, ad-free, full-film or production guarantee.', rows };
  if (process.env.SOURCE_REPORT) await fs.writeFile(process.env.SOURCE_REPORT, JSON.stringify(report, null, 2), { flag: 'wx' });
  else console.log(JSON.stringify(report, null, 2));
}

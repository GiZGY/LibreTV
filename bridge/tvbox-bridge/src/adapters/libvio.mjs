import { STATUS, statusResponse } from '../status.mjs';
import { fetchWithTimeout, readResponseText } from '../http.mjs';

const BASE_URL = 'https://www.libvio.pw';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'Referer': `${BASE_URL}/`
};

const LOGIN_URL_PATTERNS = [
  /drive\.uc\.cn/i,
  /pan\.quark\.cn/i,
  /pan\.baidu\.com/i,
  /pan\.xunlei\.com/i,
  /aliyundrive\.com/i,
  /alipan\.com/i,
  /115\.com/i
];

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

async function fetchText(pathOrUrl, fetchImpl = globalThis.fetch, signal) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  return fetchWithTimeout(fetchImpl, url, {
    headers: REQUEST_HEADERS
  }, {
    signal,
    consume: async (response) => {
      if (!response.ok) {
        const error = new Error(`Libvio HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return readResponseText(response);
    }
  });
}

function parseSearchResults(html) {
  const results = [];
  const seen = new Set();
  const re = /href="(\/detail\/(\d+)\.html)"[^>]*title="([^"]+)"[^>]*(?:data-original="([^"]*)")?/g;
  let match;
  while ((match = re.exec(html)) && results.length < 20) {
    const id = match[2];
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      vod_id: id,
      vod_name: decodeHtml(match[3]),
      vod_pic: decodeHtml(match[4] || ''),
      source_name: '立播',
      source_code: 'tvbox:立播',
      tvbox_source_key: '立播'
    });
  }
  return results;
}

function parseDetail(html, id) {
  const title = decodeHtml(html.match(/<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/)?.[1] || html.match(/<title>([^<]+?)(?:\s+-\s+LIBVIO)?<\/title>/)?.[1] || '');
  const desc = stripTags(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || '');
  const pic = decodeHtml(html.match(/data-original="([^"]+)"/)?.[1] || html.match(/data-pic="([^"]+)"/)?.[1] || '');
  const metaText = stripTags(html.match(/<div\s+class="data"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
  const episodes = [];
  const playRe = new RegExp(`href="(/w/${id}-1-(\\d+)\\.html)"`, 'g');
  let match;
  const seen = new Set();
  while ((match = playRe.exec(html))) {
    const episodeIndex = Number.parseInt(match[2], 10) - 1;
    if (seen.has(episodeIndex)) continue;
    seen.add(episodeIndex);
    episodes.push({
      name: `第 ${episodeIndex + 1} 集`,
      flag: 'libvio',
      episode: episodeIndex,
      url: `tvbox://play?sourceKey=${encodeURIComponent('立播')}&id=${encodeURIComponent(id)}&flag=libvio&episode=${episodeIndex}`
    });
  }
  if (episodes.length === 0) {
    episodes.push({
      name: '播放',
      flag: 'libvio',
      episode: 0,
      url: `tvbox://play?sourceKey=${encodeURIComponent('立播')}&id=${encodeURIComponent(id)}&flag=libvio&episode=0`
    });
  }

  return {
    videoInfo: {
      title,
      desc,
      cover: pic,
      remarks: metaText,
      source_name: '立播',
      source_code: 'tvbox:立播'
    },
    episodes
  };
}

function parsePlayer(html) {
  const raw = html.match(/var\s+player_aaaa\s*=\s*(\{[^<]+\})/)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function isLoginRequiredUrl(url) {
  return LOGIN_URL_PATTERNS.some((pattern) => pattern.test(String(url || '')));
}

function isPlayableUrl(url) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return false;
  return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(value) || /m3u8|mp4|video/i.test(value);
}

export async function search(keyword, { fetchImpl, signal } = {}) {
  const wd = String(keyword || '').trim();
  if (!wd) return statusResponse(STATUS.NO_RESULT, 'Missing keyword', { list: [] });
  const html = await fetchText(`/search/-------------.html?wd=${encodeURIComponent(wd)}`, fetchImpl, signal);
  const list = parseSearchResults(html);
  return {
    status: list.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: '立播',
    list
  };
}

export async function detail(id, { fetchImpl, signal } = {}) {
  const videoId = String(id || '').trim();
  if (!videoId) return statusResponse(STATUS.UNSUPPORTED, 'Missing video id', { episodes: [] });
  const html = await fetchText(`/detail/${encodeURIComponent(videoId)}.html`, fetchImpl, signal);
  const parsed = parseDetail(html, videoId);
  return {
    status: parsed.episodes.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: '立播',
    episodes: parsed.episodes,
    videoInfo: parsed.videoInfo
  };
}

export async function play(id, flag = 'libvio', episode = 0, { fetchImpl, signal } = {}) {
  const videoId = String(id || '').trim();
  const episodeNo = Math.max(1, Number.parseInt(episode, 10) + 1 || 1);
  if (!videoId) return statusResponse(STATUS.UNSUPPORTED, 'Missing video id', { url: '' });
  const html = await fetchText(`/w/${encodeURIComponent(videoId)}-1-${episodeNo}.html`, fetchImpl, signal);
  const player = parsePlayer(html);
  const url = player?.url || '';
  if (!url || url === 'n') return statusResponse(STATUS.NO_RESULT, 'No playable URL returned', { url: '', player });
  if (isLoginRequiredUrl(url)) return statusResponse(STATUS.LOGIN_REQUIRED, 'Libvio returned a net-disk URL that requires login', { url: '', player: { from: player.from } });
  if (!isPlayableUrl(url)) return statusResponse(STATUS.UNSUPPORTED, 'Libvio returned an unsupported playback URL', { url: '', player: { from: player.from } });
  return {
    status: STATUS.READY,
    sourceKey: '立播',
    url,
    flag,
    episode: episodeNo - 1,
    player: { from: player.from }
  };
}

export const libvioAdapter = {
  key: '立播',
  name: '立播',
  status: STATUS.READY,
  search,
  detail,
  play
};

export const internals = {
  parseSearchResults,
  parseDetail,
  parsePlayer,
  isLoginRequiredUrl,
  isPlayableUrl
};

import crypto from 'node:crypto';
import { STATUS, statusResponse } from '../status.mjs';

const SOURCE_KEY = '瓜子';
const SOURCE_CODE = `tvbox:${SOURCE_KEY}`;
const API_BASE_URL = 'https://haiwaiapi.1fc8ab0.com';
const SITE_BASE_URL = 'https://gz360.tv';
const AES_KEY = Buffer.from('181cc88340ae5b2b', 'utf8');
const AES_IV = Buffer.from('4423d1e2773476ce', 'utf8');
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Origin': SITE_BASE_URL,
  'Referer': `${SITE_BASE_URL}/`
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

function encryptPayload(payload) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_IV);
  return Buffer.concat([
    cipher.update(JSON.stringify(payload || {}), 'utf8'),
    cipher.final()
  ]).toString('hex');
}

function decryptPayload(hex) {
  if (typeof hex !== 'string' || !hex) return hex;
  const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
  const text = Buffer.concat([
    decipher.update(Buffer.from(hex, 'hex')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(text);
}

async function withTimeout(fn, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function postEncrypted(path, payload, { fetchImpl = globalThis.fetch } = {}) {
  return withTimeout(async (signal) => {
    const response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ params: encryptPayload(payload) }),
      redirect: 'follow',
      signal
    });

    if (!response.ok) {
      const error = new Error(`Guazi HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const json = await response.json();
    if (typeof json?.data === 'string' && json.data) {
      json.data = decryptPayload(json.data);
    }
    return json;
  });
}

function normalizeImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function normalizeCategoryName(value) {
  const name = String(value || '').trim();
  if (['连续剧', '国产剧', '欧美剧', '日韩剧', '港台剧'].includes(name)) return '电视剧';
  if (['动漫', '动画'].includes(name)) return '动漫';
  if (name.includes('电影')) return '电影';
  if (name.includes('综艺')) return '综艺';
  return name;
}

function normalizeTagList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchCategory(item) {
  const tags = normalizeTagList(item?.tags);
  const firstCategory = normalizeCategoryName(tags[0]);
  const typeName = firstCategory || normalizeCategoryName(item?.type_name);
  const fallbackType = String(item?.t_id || item?.d_type || '').trim();
  const genreTags = tags.slice(firstCategory ? 1 : 0)
    .map(normalizeCategoryName)
    .filter((tag) => tag && tag !== typeName);

  return {
    typeName: typeName || fallbackType,
    vodClass: genreTags.length > 0
      ? Array.from(new Set(genreTags)).join(',')
      : normalizeTagList(item?.videoTag || item?.d_class).join(',')
  };
}

function isLoginRequiredUrl(url) {
  return LOGIN_URL_PATTERNS.some((pattern) => pattern.test(String(url || '')));
}

function isPlayableUrl(url) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value) || isLoginRequiredUrl(value)) return false;
  return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(value) || /m3u8|mp4|video/i.test(value);
}

function normalizeSearchItem(item) {
  const title = String(item?.vod_name || '').trim();
  const year = String(item?.vod_year || '').trim();
  const remarks = String(item?.new_continue || item?.vod_continu || item?.vod_title || '').trim();
  const category = normalizeSearchCategory(item);
  return {
    vod_id: String(item?.vod_id || '').trim(),
    vod_name: title,
    vod_pic: normalizeImageUrl(item?.vod_pic || item?.vod_pic_thumb || item?.pic),
    vod_remarks: remarks || year,
    vod_year: year,
    vod_area: String(item?.vod_area || '').trim(),
    vod_class: category.vodClass,
    type_name: category.typeName,
    source_name: SOURCE_KEY,
    source_code: SOURCE_CODE,
    tvbox_source_key: SOURCE_KEY
  };
}

function normalizeVideoInfo(vodInfo = {}) {
  return {
    title: String(vodInfo?.vod_name || '').trim(),
    desc: String(vodInfo?.vod_use_content || vodInfo?.vod_content || '').trim(),
    cover: normalizeImageUrl(vodInfo?.pic || vodInfo?.vod_pic || vodInfo?.vod_pic_thumb),
    year: String(vodInfo?.vod_year || '').trim(),
    area: String(vodInfo?.vod_area || '').trim(),
    actor: String(vodInfo?.vod_actor || '').trim(),
    director: String(vodInfo?.vod_director || '').trim(),
    remarks: String(vodInfo?.vod_continu || vodInfo?.default_play_name || '').trim(),
    source_name: SOURCE_KEY,
    source_code: SOURCE_CODE
  };
}

function normalizeEpisodeList(vodId, urls = []) {
  return (Array.isArray(urls) ? urls : [])
    .filter((episode) => isPlayableUrl(episode?.url))
    .sort((a, b) => (Number(a?.sort) || 0) - (Number(b?.sort) || 0))
    .map((episode, index) => {
      const episodeIndex = index;
      const name = String(episode?.name || episode?.sort || `第 ${episodeIndex + 1} 集`).trim();
      return {
        name,
        flag: SOURCE_KEY,
        episode: episodeIndex,
        url: `tvbox://play?sourceKey=${encodeURIComponent(SOURCE_KEY)}&id=${encodeURIComponent(String(vodId))}&flag=${encodeURIComponent(SOURCE_KEY)}&episode=${episodeIndex}`,
        rawUrl: episode.url,
        vurlId: episode?.vurl_id || '',
        resolution: episode?.resolution || ''
      };
    });
}

async function fetchDetailData(id, fetchImpl) {
  const videoId = String(id || '').trim();
  if (!videoId) return null;
  const json = await postEncrypted('/Pc/Resource/GetVodInfo', { vod_id: videoId }, { fetchImpl });
  return json?.code === 200 ? (json.data || null) : null;
}

async function fetchEpisodeData(id, fetchImpl) {
  const videoId = String(id || '').trim();
  if (!videoId) return null;
  const numericId = Number(videoId);
  const vodId = Number.isFinite(numericId) && numericId > 0 ? numericId : videoId;
  const json = await postEncrypted('/Pc/Resource/GetOnePlayList', { vod_id: vodId, pageSize: 0, page: 1 }, { fetchImpl });
  return json?.code === 200 ? (json.data || null) : null;
}

export async function search(keyword, { fetchImpl } = {}) {
  const wd = String(keyword || '').trim();
  if (!wd) return statusResponse(STATUS.NO_RESULT, 'Missing keyword', { sourceKey: SOURCE_KEY, list: [] });

  const json = await postEncrypted('/Pc/Search/GetConditionList', {
    tid: 0,
    area: 0,
    year: 0,
    sort: 'd_id',
    keywords: wd,
    page: 1,
    pageSize: 20
  }, { fetchImpl });
  const list = (Array.isArray(json?.data?.list) ? json.data.list : [])
    .map(normalizeSearchItem)
    .filter((item) => item.vod_id && item.vod_name);

  return {
    status: list.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: SOURCE_KEY,
    list
  };
}

export async function detail(id, { fetchImpl } = {}) {
  const [detailData, episodeData] = await Promise.all([
    fetchDetailData(id, fetchImpl),
    fetchEpisodeData(id, fetchImpl)
  ]);
  if (!detailData && !episodeData) {
    return statusResponse(STATUS.NO_RESULT, 'No detail returned', { sourceKey: SOURCE_KEY, episodes: [] });
  }

  const vodInfo = detailData?.vodInfo || {};
  const episodes = normalizeEpisodeList(id, episodeData?.urls).map(({ rawUrl, ...episode }) => episode);
  return {
    status: episodes.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: SOURCE_KEY,
    episodes,
    videoInfo: normalizeVideoInfo(vodInfo)
  };
}

export async function play(id, flag = SOURCE_KEY, episode = 0, { fetchImpl } = {}) {
  const episodeData = await fetchEpisodeData(id, fetchImpl);
  const episodes = normalizeEpisodeList(id, episodeData?.urls);
  const index = Math.max(0, Number.parseInt(episode, 10) || 0);
  const selected = episodes[index] || episodes[0];

  if (!selected?.rawUrl) return statusResponse(STATUS.NO_RESULT, 'No playable URL returned', { sourceKey: SOURCE_KEY, url: '' });
  if (isLoginRequiredUrl(selected.rawUrl)) return statusResponse(STATUS.LOGIN_REQUIRED, 'Guazi returned a net-disk URL that requires login', { sourceKey: SOURCE_KEY, url: '' });
  if (!isPlayableUrl(selected.rawUrl)) return statusResponse(STATUS.UNSUPPORTED, 'Guazi returned an unsupported playback URL', { sourceKey: SOURCE_KEY, url: '' });

  return {
    status: STATUS.READY,
    sourceKey: SOURCE_KEY,
    url: selected.rawUrl,
    flag: flag || selected.flag,
    episode: selected.episode
  };
}

export const guaziAdapter = {
  key: SOURCE_KEY,
  name: SOURCE_KEY,
  status: STATUS.READY,
  search,
  detail,
  play
};

export const internals = {
  encryptPayload,
  decryptPayload,
  normalizeImageUrl,
  normalizeSearchCategory,
  normalizeSearchItem,
  normalizeVideoInfo,
  normalizeEpisodeList,
  isLoginRequiredUrl,
  isPlayableUrl
};

import { STATUS, statusResponse } from '../status.mjs';

const SOURCE_KEY = '荐片';
const SOURCE_CODE = `tvbox:${SOURCE_KEY}`;
const API_BASE_URL = 'https://api.ztcgi.com';
const IMAGE_BASE_URL = 'https://img.jianpian.com';
const UNSTABLE_IMAGE_HOSTS = new Set(['img.jianpian.com', 'img1.jianpian.com', 'img2.jianpian.com', 'img3.jianpian.com']);
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 9; V2196A Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36;webank/h5face;webank/1.0;netType:NETWORK_WIFI;appVersion:416;packageName:com.jp3.xg3',
  'Accept': 'application/json,text/plain,*/*',
  'Referer': API_BASE_URL
};

function normalizeImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';
  const absoluteUrl = /^https?:\/\//i.test(url)
    ? url
    : `${IMAGE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;

  try {
    const parsed = new URL(absoluteUrl);
    if (UNSTABLE_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    return absoluteUrl;
  } catch (_) {
    return '';
  }
}

function normalizePersonName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return String(
      value.name ||
      value.title ||
      value.original_name ||
      value.actor_name ||
      value.director_name ||
      ''
    ).trim();
  }
  return String(value).trim();
}

function normalizePeople(value) {
  if (Array.isArray(value)) {
    return value.map(normalizePersonName).filter(Boolean).join(',');
  }
  return normalizePersonName(value);
}

function normalizeArea(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => (
      typeof entry === 'string' ? entry : entry?.area || entry?.name
    )).filter(Boolean).join(',');
  }
  return String(value || '').trim();
}

function isPlayableUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) && /\.(m3u8|mp4)(?:[?#].*)?$/i.test(value);
}

async function fetchJson(pathOrUrl, fetchImpl = globalThis.fetch) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE_URL}${pathOrUrl}`;
  const response = await fetchImpl(url, { headers: REQUEST_HEADERS, redirect: 'follow' });
  if (!response.ok) {
    const error = new Error(`Jianpian HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalizeSearchItem(item) {
  return {
    vod_id: String(item?.id || ''),
    vod_name: String(item?.title || item?.original_name || '').trim(),
    vod_pic: normalizeImageUrl(item?.thumbnail || item?.path || item?.tvimg),
    vod_remarks: String(item?.mask || '').trim(),
    vod_year: Array.isArray(item?.years) ? item.years.map((entry) => entry?.year).filter(Boolean).join(',') : String(item?.year || ''),
    type_name: item?.top_category?.name || '',
    vod_class: Array.isArray(item?.types) ? item.types.join(',') : '',
    source_name: SOURCE_KEY,
    source_code: SOURCE_CODE,
    tvbox_source_key: SOURCE_KEY
  };
}

function flattenPlayableEpisodes(data) {
  const groups = Array.isArray(data?.source_list_source) ? data.source_list_source : [];
  for (const group of groups) {
    const groupName = String(group?.name || SOURCE_KEY).replace(/常规线路/g, '边下边播');
    const list = Array.isArray(group?.source_list) ? group.source_list : [];
    const episodes = list
      .filter((episode) => isPlayableUrl(episode?.url))
      .map((episode, index) => ({
        name: String(episode?.source_name || episode?.weight || `第 ${index + 1} 集`).trim(),
        flag: groupName,
        episode: index,
        url: `tvbox://play?sourceKey=${encodeURIComponent(SOURCE_KEY)}&id=${encodeURIComponent(String(data.id))}&flag=${encodeURIComponent(groupName)}&episode=${index}`,
        rawUrl: episode.url
      }));

    if (episodes.length > 0) return episodes;
  }

  return [];
}

function normalizeVideoInfo(data) {
  return {
    title: String(data?.title || data?.original_name || '').trim(),
    desc: String(data?.description || '').trim(),
    cover: normalizeImageUrl(data?.thumbnail || data?.tvimg),
    year: String(data?.year || '').trim(),
    area: normalizeArea(data?.area || data?.areas),
    actor: normalizePeople(data?.actors),
    director: normalizePeople(data?.directors),
    type: data?.top_category?.name || data?.category?.name || '',
    remarks: String(data?.mask || '').trim(),
    source_name: SOURCE_KEY,
    source_code: SOURCE_CODE
  };
}

async function fetchDetailData(id, fetchImpl) {
  const videoId = String(id || '').trim();
  if (!videoId) return null;
  const data = await fetchJson(`/api/video/detailv2?id=${encodeURIComponent(videoId)}`, fetchImpl);
  return data?.data || null;
}

export async function search(keyword, { fetchImpl } = {}) {
  const wd = String(keyword || '').trim();
  if (!wd) return statusResponse(STATUS.NO_RESULT, 'Missing keyword', { sourceKey: SOURCE_KEY, list: [] });

  const data = await fetchJson(`/api/v2/search/videoV2?key=${encodeURIComponent(wd)}&category_id=88&page=1&pageSize=20`, fetchImpl);
  const list = (Array.isArray(data?.data) ? data.data : [])
    .map(normalizeSearchItem)
    .filter((item) => item.vod_id && item.vod_name);

  return {
    status: list.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: SOURCE_KEY,
    list
  };
}

export async function detail(id, { fetchImpl } = {}) {
  const data = await fetchDetailData(id, fetchImpl);
  if (!data) return statusResponse(STATUS.NO_RESULT, 'No detail returned', { sourceKey: SOURCE_KEY, episodes: [] });

  const episodes = flattenPlayableEpisodes(data).map(({ rawUrl, ...episode }) => episode);
  return {
    status: episodes.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
    sourceKey: SOURCE_KEY,
    episodes,
    videoInfo: normalizeVideoInfo(data)
  };
}

export async function play(id, flag = '', episode = 0, { fetchImpl } = {}) {
  const data = await fetchDetailData(id, fetchImpl);
  if (!data) return statusResponse(STATUS.NO_RESULT, 'No detail returned', { sourceKey: SOURCE_KEY, url: '' });

  const episodes = flattenPlayableEpisodes(data);
  const index = Math.max(0, Number.parseInt(episode, 10) || 0);
  const selected = episodes[index] || episodes[0];

  if (!selected?.rawUrl) return statusResponse(STATUS.NO_RESULT, 'No playable URL returned', { sourceKey: SOURCE_KEY, url: '' });
  if (!isPlayableUrl(selected.rawUrl)) return statusResponse(STATUS.UNSUPPORTED, 'Jianpian returned an unsupported playback URL', { sourceKey: SOURCE_KEY, url: '' });

  return {
    status: STATUS.READY,
    sourceKey: SOURCE_KEY,
    url: selected.rawUrl,
    flag: flag || selected.flag,
    episode: selected.episode
  };
}

export const jianpianAdapter = {
  key: SOURCE_KEY,
  name: SOURCE_KEY,
  status: STATUS.READY,
  search,
  detail,
  play
};

export const internals = {
  normalizeImageUrl,
  normalizeSearchItem,
  flattenPlayableEpisodes,
  normalizeVideoInfo,
  normalizePeople,
  isPlayableUrl
};

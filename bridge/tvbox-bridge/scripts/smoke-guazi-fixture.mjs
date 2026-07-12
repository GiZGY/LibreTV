import assert from 'assert/strict';
import { detail, internals, play, search } from '../src/adapters/guazi.mjs';

const searchPayload = {
  code: 200,
  data: {
    list: [
      {
        vod_id: 60397,
        vod_name: '庆余年第二季',
        vod_year: '2024',
        new_continue: '全36集',
        vod_area: '中国大陆',
        vod_pic: 'https://img.example/poster.jpg',
        d_class: '剧情,古装'
      }
    ]
  }
};

const detailPayload = {
  code: 200,
  data: {
    vodInfo: {
      vod_id: 60397,
      vod_name: '庆余年第二季',
      vod_use_content: '测试简介',
      pic: 'https://img.example/poster.jpg',
      vod_year: '2024',
      vod_area: '中国大陆',
      vod_actor: '张若昀',
      vod_director: '孙皓',
      vod_continu: '全36集'
    }
  }
};

const episodePayload = {
  code: 200,
  data: {
    total_vod_vurl: '2',
    urls: [
      { name: '02', sort: 2, vurl_id: 1002, resolution: '1080', url: 'https://cdn.example/ep2/index.m3u8' },
      { name: '网盘', sort: 3, vurl_id: 1003, url: 'https://pan.quark.cn/s/abc' },
      { name: '01', sort: 1, vurl_id: 1001, resolution: '1080', url: 'https://cdn.example/ep1/index.m3u8' }
    ]
  }
};

function encryptedJson(payload) {
  return { code: payload.code, data: internals.encryptPayload(payload.data) };
}

const fakeFetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || '{}');
  assert.equal(typeof body.params, 'string');
  const value = String(url);
  if (value.includes('/Pc/Search/GetConditionList')) return { ok: true, json: async () => encryptedJson(searchPayload) };
  if (value.includes('/Pc/Resource/GetVodInfo')) return { ok: true, json: async () => encryptedJson(detailPayload) };
  if (value.includes('/Pc/Resource/GetOnePlayList')) return { ok: true, json: async () => encryptedJson(episodePayload) };
  return { ok: false, status: 404, json: async () => ({}) };
};

assert.equal(internals.isPlayableUrl('https://cdn.example/ep1/index.m3u8'), true);
assert.equal(internals.isPlayableUrl('https://pan.quark.cn/s/abc'), false);
assert.equal(internals.normalizeEpisodeList('60397', episodePayload.data.urls).length, 2);
assert.equal(internals.normalizeEpisodeList('60397', episodePayload.data.urls)[0].name, '01');

const searchResult = await search('庆余年', { fetchImpl: fakeFetch });
assert.equal(searchResult.status, 'ready');
assert.equal(searchResult.list[0].source_code, 'tvbox:瓜子');

const detailResult = await detail('60397', { fetchImpl: fakeFetch });
assert.equal(detailResult.status, 'ready');
assert.equal(detailResult.episodes.length, 2);
assert.equal(detailResult.episodes[0].url.startsWith('tvbox://play?'), true);

const playResult = await play('60397', '', 1, { fetchImpl: fakeFetch });
assert.equal(playResult.status, 'ready');
assert.equal(playResult.url, 'https://cdn.example/ep2/index.m3u8');

console.log(JSON.stringify({ ok: true, source: '瓜子', search: searchResult.list.length, episodes: detailResult.episodes.length, play: playResult.status }, null, 2));

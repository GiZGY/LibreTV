import assert from 'assert/strict';
import { detail, internals, play, search } from '../src/adapters/jianpian.mjs';

const searchJson = {
  code: 200,
  data: [
    {
      id: 54437,
      title: '庆余年',
      thumbnail: '/upload/video/poster.jpg',
      mask: '第01集',
      top_category: { name: '电视剧' },
      types: ['剧情', '古装'],
      years: [{ year: '2019' }]
    }
  ]
};

const detailJson = {
  code: 200,
  data: {
    id: 54437,
    title: '庆余年',
    year: '2019',
    area: '中国大陆',
    description: '测试简介',
    thumbnail: '/upload/video/poster.jpg',
    top_category: { name: '电视剧' },
    actors: ['张若昀'],
    directors: ['孙皓'],
    source_list_source: [
      {
        name: 'VIP线路',
        source_list: [
          { source_name: '第01集', url: 'https://mv.example.com/a/index.m3u8' },
          { source_name: '网盘', url: 'https://pan.quark.cn/s/abc' },
          { source_name: '第02集', url: 'https://mv.example.com/b/index.m3u8' }
        ]
      }
    ]
  }
};

const fakeFetch = async (url) => {
  const value = String(url);
  if (value.includes('/api/v2/search/videoV2')) {
    return { ok: true, json: async () => searchJson };
  }
  if (value.includes('/api/video/detailv2')) {
    return { ok: true, json: async () => detailJson };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

assert.equal(internals.normalizeImageUrl('/a.jpg'), 'https://img.jianpian.com/a.jpg');
assert.equal(internals.isPlayableUrl('https://mv.example.com/a/index.m3u8'), true);
assert.equal(internals.isPlayableUrl('https://pan.quark.cn/s/abc'), false);
assert.equal(internals.flattenPlayableEpisodes(detailJson.data).length, 2);

const searchResult = await search('庆余年', { fetchImpl: fakeFetch });
assert.equal(searchResult.status, 'ready');
assert.equal(searchResult.list[0].source_code, 'tvbox:荐片');

const detailResult = await detail('54437', { fetchImpl: fakeFetch });
assert.equal(detailResult.status, 'ready');
assert.equal(detailResult.episodes.length, 2);
assert.equal(detailResult.episodes[0].url.startsWith('tvbox://play?'), true);

const playResult = await play('54437', '', 1, { fetchImpl: fakeFetch });
assert.equal(playResult.status, 'ready');
assert.equal(playResult.url, 'https://mv.example.com/b/index.m3u8');

console.log(JSON.stringify({ ok: true, source: '荐片', search: searchResult.list.length, episodes: detailResult.episodes.length, play: playResult.status }, null, 2));

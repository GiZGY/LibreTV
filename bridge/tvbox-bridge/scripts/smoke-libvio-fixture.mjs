import assert from 'assert/strict';
import { internals, search, detail, play } from '../src/adapters/libvio.mjs';

const searchHtml = `
<a class="stui-vodlist__thumb lazyload" href="/detail/714891553.html" title="庆余年 第二季" data-original="https://img.example/poster.jpg"></a>
<a class="stui-vodlist__thumb lazyload" href="/detail/714891553.html" title="庆余年 第二季"></a>
`;
const detailHtml = `
<title>庆余年 第二季 - LIBVIO</title>
<meta name="description" content="庆余年 第二季剧情: 测试简介" />
<img data-original="https://img.example/poster.jpg" />
<h1 class="title">庆余年 第二季</h1>
<div class="data">2024 / 中国大陆 / 剧情,古装</div>
<a href="/w/714891553-1-1.html">立即播放</a>
`;
const ucPlayHtml = `<script>var player_aaaa={"flag":"play","encrypt":3,"url":"https:\/\/drive.uc.cn\/s\/abc","from":"uc","id":"714891553","sid":1,"nid":1}</script>`;
const m3u8PlayHtml = `<script>var player_aaaa={"flag":"play","encrypt":3,"url":"https:\/\/cdn.example\/video.m3u8","from":"m3u8","id":"714891553","sid":1,"nid":1}</script>`;

assert.equal(internals.parseSearchResults(searchHtml).length, 1);
assert.equal(internals.parseDetail(detailHtml, '714891553').episodes[0].url.startsWith('tvbox://play?'), true);
assert.equal(internals.parsePlayer(ucPlayHtml).from, 'uc');
assert.equal(internals.isLoginRequiredUrl('https://pan.quark.cn/s/abc'), true);
assert.equal(internals.isPlayableUrl('https://cdn.example/video.m3u8'), true);

const fakeFetch = async (url) => {
  const value = String(url);
  if (value.includes('/search/')) return { ok: true, text: async () => searchHtml };
  if (value.includes('/detail/')) return { ok: true, text: async () => detailHtml };
  if (value.includes('/w/') && value.includes('login')) return { ok: true, text: async () => ucPlayHtml };
  if (value.includes('/w/')) return { ok: true, text: async () => m3u8PlayHtml };
  return { ok: false, status: 404, text: async () => '' };
};

const searchResult = await search('庆余年', { fetchImpl: fakeFetch });
assert.equal(searchResult.status, 'ready');
assert.equal(searchResult.list[0].source_code, 'tvbox:立播');

const detailResult = await detail('714891553', { fetchImpl: fakeFetch });
assert.equal(detailResult.status, 'ready');
assert.equal(detailResult.episodes.length, 1);

const playResult = await play('714891553', 'libvio', 0, { fetchImpl: fakeFetch });
assert.equal(playResult.status, 'ready');
assert.equal(playResult.url, 'https://cdn.example/video.m3u8');

const loginFetch = async (url) => ({ ok: true, text: async () => ucPlayHtml });
const loginResult = await play('login', 'libvio', 0, { fetchImpl: loginFetch });
assert.equal(loginResult.status, 'login_required');
assert.equal(loginResult.url, '');

console.log(JSON.stringify({ ok: true, source: '立播', search: searchResult.list.length, play: playResult.status, login: loginResult.status }, null, 2));

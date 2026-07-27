import assert from 'assert/strict';

const port = Number.parseInt(process.env.PORT || '9979', 10);
const token = process.env.TVBOX_BRIDGE_TOKEN || 'bridge-live-smoke-token';
process.env.TVBOX_BRIDGE_TOKEN = token;
process.env.NODE_ENV = 'production';
const { startBridgeServer } = await import('../src/server.mjs');
const server = startBridgeServer(process.env);
const base = `http://127.0.0.1:${port}`;
await new Promise((resolve) => setTimeout(resolve, 300));
const request = (url) => fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
});

const health = await request(`${base}/api/tvbox/health`).then((res) => res.json());
assert.equal(health.status, 'ready');
assert.equal(health.sourceSummary.total, 48);
assert.equal(health.sourceSummary.byStatus.ready, 3);

const changzhang = await request(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('厂长')}&wd=test`);
const changzhangBody = await changzhang.json();
assert.equal(changzhang.status, 501);
assert.equal(changzhangBody.status, 'unsupported');

const uc = await request(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('UC')}&wd=test`).then((res) => res.json());
assert.equal(uc.status, 'login_required');

const jianpianSearch = await request(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('荐片')}&wd=${encodeURIComponent('庆余年')}`).then((res) => res.json());
assert.equal(jianpianSearch.status, 'ready');
assert.ok(jianpianSearch.list.length > 0);

const jianpianDetail = await request(`${base}/api/tvbox/detail?sourceKey=${encodeURIComponent('荐片')}&id=${encodeURIComponent(jianpianSearch.list[0].vod_id)}`).then((res) => res.json());
assert.equal(jianpianDetail.status, 'ready');
assert.ok(jianpianDetail.episodes.length > 0);

const jianpianPlay = await request(`${base}/api/tvbox/play?sourceKey=${encodeURIComponent('荐片')}&id=${encodeURIComponent(jianpianSearch.list[0].vod_id)}&episode=0`).then((res) => res.json());
assert.equal(jianpianPlay.status, 'ready');
assert.ok(/\.m3u8(?:[?#].*)?$/i.test(jianpianPlay.url));

const guaziSearch = await request(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('瓜子')}&wd=${encodeURIComponent('庆余年')}`).then((res) => res.json());
assert.equal(guaziSearch.status, 'ready');
assert.ok(guaziSearch.list.length > 0);

const guaziDetail = await request(`${base}/api/tvbox/detail?sourceKey=${encodeURIComponent('瓜子')}&id=${encodeURIComponent(guaziSearch.list[0].vod_id)}`).then((res) => res.json());
assert.equal(guaziDetail.status, 'ready');
assert.ok(guaziDetail.episodes.length > 0);

const guaziPlay = await request(`${base}/api/tvbox/play?sourceKey=${encodeURIComponent('瓜子')}&id=${encodeURIComponent(guaziSearch.list[0].vod_id)}&episode=0`).then((res) => res.json());
assert.equal(guaziPlay.status, 'ready');
assert.ok(/\.m3u8(?:[?#].*)?$/i.test(guaziPlay.url));

console.log(JSON.stringify({
  ok: true,
  health: health.sourceSummary,
  uc: uc.status,
  jianpian: { search: jianpianSearch.list.length, episodes: jianpianDetail.episodes.length, play: jianpianPlay.status },
  guazi: { search: guaziSearch.list.length, episodes: guaziDetail.episodes.length, play: guaziPlay.status }
}, null, 2));
server.close();

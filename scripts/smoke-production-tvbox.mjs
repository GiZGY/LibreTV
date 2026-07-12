import assert from 'assert/strict';

const base = String(process.env.OPENSTREAM_BASE_URL || process.argv[2] || 'https://tv.cursorflow.top').replace(/\/$/, '');

async function fetchJson(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = { raw: text.slice(0, 200) };
  }
  return { response, json };
}

const health = await fetchJson('/api/tvbox/health');
assert.equal(health.response.status, 200, `health HTTP ${health.response.status}`);
assert.equal(health.json.status, 'ready', `health status ${health.json.status || health.json.raw || 'unknown'}`);

async function smokeSource(sourceKey, keyword) {
  const search = await fetchJson(`/api/tvbox/search?sourceKey=${encodeURIComponent(sourceKey)}&wd=${encodeURIComponent(keyword)}`);
  assert.equal(search.response.status, 200, `${sourceKey} search HTTP ${search.response.status}`);
  assert.equal(search.json.status, 'ready', `${sourceKey} search status ${search.json.status || search.json.raw || 'unknown'}`);
  assert.ok(Array.isArray(search.json.list) && search.json.list.length > 0, `${sourceKey} search returned no result`);

  const first = search.json.list[0];
  const detail = await fetchJson(`/api/tvbox/detail?sourceKey=${encodeURIComponent(sourceKey)}&id=${encodeURIComponent(first.vod_id)}`);
  assert.equal(detail.response.status, 200, `${sourceKey} detail HTTP ${detail.response.status}`);
  assert.equal(detail.json.status, 'ready', `${sourceKey} detail status ${detail.json.status || detail.json.raw || 'unknown'}`);
  assert.ok(Array.isArray(detail.json.episodes) && detail.json.episodes.length > 0, `${sourceKey} detail returned no episodes`);
  assert.ok(!JSON.stringify(detail.json.videoInfo || {}).includes('[object Object]'), `${sourceKey} detail leaked object string`);

  const play = await fetchJson(`/api/tvbox/play?sourceKey=${encodeURIComponent(sourceKey)}&id=${encodeURIComponent(first.vod_id)}&episode=0`);
  assert.equal(play.response.status, 200, `${sourceKey} play HTTP ${play.response.status}`);
  assert.equal(play.json.status, 'ready', `${sourceKey} play status ${play.json.status || play.json.raw || 'unknown'}`);
  assert.ok(/\.m3u8(?:[?#].*)?$/i.test(play.json.url || ''), `${sourceKey} play did not return m3u8`);

  return {
    count: search.json.list.length,
    first: first.vod_name,
    episodes: detail.json.episodes.length,
    play: play.json.status
  };
}

const jianpian = await smokeSource('荐片', '庆余年');
const guazi = await smokeSource('瓜子', '庆余年');

console.log(JSON.stringify({
  ok: true,
  base,
  health: health.json.sourceSummary,
  sources: { jianpian, guazi }
}, null, 2));

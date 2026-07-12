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

const search = await fetchJson(`/api/tvbox/search?sourceKey=${encodeURIComponent('荐片')}&wd=${encodeURIComponent('庆余年')}`);
assert.equal(search.response.status, 200, `search HTTP ${search.response.status}`);
assert.equal(search.json.status, 'ready', `search status ${search.json.status || search.json.raw || 'unknown'}`);
assert.ok(Array.isArray(search.json.list) && search.json.list.length > 0, 'search returned no result');

const first = search.json.list[0];
const detail = await fetchJson(`/api/tvbox/detail?sourceKey=${encodeURIComponent('荐片')}&id=${encodeURIComponent(first.vod_id)}`);
assert.equal(detail.response.status, 200, `detail HTTP ${detail.response.status}`);
assert.equal(detail.json.status, 'ready', `detail status ${detail.json.status || detail.json.raw || 'unknown'}`);
assert.ok(Array.isArray(detail.json.episodes) && detail.json.episodes.length > 0, 'detail returned no episodes');

const play = await fetchJson(`/api/tvbox/play?sourceKey=${encodeURIComponent('荐片')}&id=${encodeURIComponent(first.vod_id)}&episode=0`);
assert.equal(play.response.status, 200, `play HTTP ${play.response.status}`);
assert.equal(play.json.status, 'ready', `play status ${play.json.status || play.json.raw || 'unknown'}`);
assert.ok(/\.m3u8(?:[?#].*)?$/i.test(play.json.url || ''), 'play did not return m3u8');

console.log(JSON.stringify({
  ok: true,
  base,
  health: health.json.sourceSummary,
  search: {
    count: search.json.list.length,
    first: first.vod_name
  },
  detail: {
    episodes: detail.json.episodes.length
  },
  play: {
    status: play.json.status,
    urlKind: 'm3u8'
  }
}, null, 2));

import assert from 'assert/strict';
import '../src/server.mjs';

const port = Number.parseInt(process.env.PORT || '9979', 10);
const base = `http://127.0.0.1:${port}`;
await new Promise((resolve) => setTimeout(resolve, 300));

const health = await fetch(`${base}/api/tvbox/health`).then((res) => res.json());
assert.equal(health.status, 'ready');
assert.equal(health.sourceSummary.total, 48);

const changzhang = await fetch(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('厂长')}&wd=test`);
const changzhangBody = await changzhang.json();
assert.equal(changzhang.status, 501);
assert.equal(changzhangBody.status, 'unsupported');

const uc = await fetch(`${base}/api/tvbox/search?sourceKey=${encodeURIComponent('UC')}&wd=test`).then((res) => res.json());
assert.equal(uc.status, 'login_required');

console.log(JSON.stringify({ ok: true, health: health.sourceSummary, uc: uc.status }, null, 2));
process.exit(0);

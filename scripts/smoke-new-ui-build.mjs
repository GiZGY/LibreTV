import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const html=await fs.readFile('public/index.html','utf8');
assert.match(html,/live-mode\.js\?v=[a-f0-9]{16}/);
assert.match(html,/live-ui\.js\?v=[a-f0-9]{16}/);
assert.doesNotMatch(html,/compiled\/|js\/password\.js|tailwind/);
for(const m of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^" ]*)?"/g)){
 if(!m[1].includes('://'))await fs.access('public/'+m[1]);
}
const assetRoot=html.match(/src="(static\/[a-f0-9]{16})\/live-mode\.js/)[1];
const player=await fs.readFile(`public/${assetRoot}/player-preview.js`,'utf8');
assert.doesNotMatch(player,/volume:0,muted:true|__qa\/native-status/);
const mainMount=player.indexOf('async function mount(');
assert.ok(mainMount>player.indexOf('function verifyMedia('));
// Only the hidden alternative probe is always muted; the main player keeps the user's sound preference.
assert.match(player.slice(0,mainMount),/video\.dataset\.playbackProbe/);
assert.match(player.slice(0,mainMount),/video\.muted=true;video\.defaultMuted=true;video\.volume=0/);
assert.doesNotMatch(player.slice(mainMount),/video\.defaultMuted=true/);
assert.match(player,/volume:previousSound\?\.volume\?\?load\(["']volume["'],(?:0)?\.8\),muted:previousSound\?\.muted\?\?load\(["']muted["'],false\),setting:true/);
for(const name of ['.env.local','.env.turnstile.local','package.json','server','tests']){
 await assert.rejects(fs.access('public/'+name));
}
assert.ok(html.indexOf('live-mode.js')<html.indexOf('/app.js'));
await fs.access('public/libs/artplayer.min.js');
await fs.access('public/libs/hls.min.js');
let sourceBytes=0,outputBytes=0;
for(const match of html.matchAll(/<script defer src="([^?]+)\?/g)){
 const name=match[1];
 const code=await fs.readFile('public/'+name,'utf8');
 new vm.Script(code,{filename:name});
 const relative=name.slice(assetRoot.length+1);
 const source=relative==='core/content-kind.js'?'js/content-kind.cjs':relative.startsWith('core/')?'js/'+relative.slice(5):'web/'+relative;
 sourceBytes+=(await fs.stat(source)).size;
 outputBytes+=Buffer.byteLength(code);
}
assert.ok(outputBytes<sourceBytes*.9,'Production scripts must save at least 10% without changing globals');
const config=JSON.parse(await fs.readFile('vercel.json','utf8'));
assert.ok(config.headers.some(rule=>rule.source==='/static/(.*)'&&rule.headers.some(header=>header.value==='public, max-age=31536000, immutable')));
await assert.rejects(fs.access('public/app.js'));
console.log('New UI production entry, assets and public-file boundaries passed');

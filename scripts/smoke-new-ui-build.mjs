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
const player=await fs.readFile('public/player-preview.js','utf8');
assert.doesNotMatch(player,/video\.defaultMuted=true|volume:0,muted:true|__qa\/native-status/);
assert.match(player,/volume:(?:0)?\.8,setting:true/);
for(const name of ['.env.local','.env.turnstile.local','package.json','server','tests']){
 await assert.rejects(fs.access('public/'+name));
}
assert.ok(html.indexOf('live-mode.js')<html.indexOf('src="app.js'));
await fs.access('public/libs/artplayer.min.js');
await fs.access('public/libs/hls.min.js');
let sourceBytes=0,outputBytes=0;
for(const match of html.matchAll(/<script defer src="([^?]+)\?/g)){
 const name=match[1];
 const code=await fs.readFile('public/'+name,'utf8');
 new vm.Script(code,{filename:name});
 const source=name.startsWith('core/')?'js/'+name.slice(5):'web/'+name;
 sourceBytes+=(await fs.stat(source)).size;
 outputBytes+=Buffer.byteLength(code);
}
assert.ok(outputBytes<sourceBytes*.9,'Production scripts must save at least 10% without changing globals');
console.log('New UI production entry, assets and public-file boundaries passed');

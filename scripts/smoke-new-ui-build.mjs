import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const html=await fs.readFile('public/index.html','utf8');
assert.match(html,/live-mode\.js\?v=[a-f0-9]{16}/);
assert.match(html,/live-ui\.js\?v=[a-f0-9]{16}/);
assert.doesNotMatch(html,/compiled\/|js\/password\.js|tailwind/);
for(const m of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^" ]*)?"/g)){
 if(!m[1].includes('://'))await fs.access('public/'+m[1]);
}
const player=await fs.readFile('public/player-preview.js','utf8');
assert.doesNotMatch(player,/video\.defaultMuted=true|volume:0,muted:true|__qa\/native-status/);
assert.match(player,/volume:\.8,setting:true/);
for(const name of ['.env.local','.env.turnstile.local','package.json','server','tests']){
 await assert.rejects(fs.access('public/'+name));
}
assert.ok(html.indexOf('live-mode.js')<html.indexOf('src="app.js'));
await fs.access('public/libs/artplayer.min.js');
await fs.access('public/libs/hls.min.js');
console.log('New UI production entry, assets and public-file boundaries passed');

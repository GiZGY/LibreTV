import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'public');
const core=['config.js','proxy-auth.js','source-catalog.js','search.js','source-health.js','source-adapter.js','result-aggregator.js','streaming-search.js','ad-rules.js','ad-guard.js','native-ad-timelines.js','native-ad-evidence.js','native-ad-guard.js','native-ad-verifier.js','native-ad-transport.js','native-ad-session.js'];
const ui=['styles.css','app.js','live-mode.js','human-access.js','film-metadata.js','live-data.js','live-ui.js','player-preview.js'];
await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(path.join(output,'core'),{recursive:true});
let sourceBytes=0,outputBytes=0;
async function emit(source,destination){
 const input=await fs.readFile(path.join(root,source),'utf8');
 // Classic scripts share globals: preserve identifiers and script boundaries.
 const {code}=await transform(input,{loader:source.endsWith('.css')?'css':'js',minifyWhitespace:true,minifySyntax:false,minifyIdentifiers:false,legalComments:'inline',charset:'utf8'});
 sourceBytes+=Buffer.byteLength(input);outputBytes+=Buffer.byteLength(code);
 await fs.writeFile(path.join(output,destination),code);
}
for(const name of ui)await emit('web/'+name,name);
for(const name of core)await emit('js/'+name,'core/'+name);
for(const dir of ['assets','libs'])await fs.cp(path.join(root,'web',dir),path.join(output,dir),{recursive:true});
await fs.copyFile(path.join(root,'libs/hls.min.js'),path.join(output,'libs/hls.min.js'));
const revision=crypto.createHash('sha256');
for(const name of [...ui,...core.map(n=>'core/'+n)])revision.update(await fs.readFile(path.join(output,name)));
const version=revision.digest('hex').slice(0,16);
const scripts=['core/config.js','live-mode.js','human-access.js',...core.slice(1).map(n=>'core/'+n),'app.js','film-metadata.js','live-data.js','live-ui.js','player-preview.js'];
let html=await fs.readFile(path.join(root,'web/index.html'),'utf8');
html=html.replace(/<script defer src="(?:app|player-preview)\.js"><\/script>/g,'').replace(/styles\.css\?[^" ]+/g,'styles.css?v='+version);
html=html.replace('</head>',scripts.map(src=>`<script defer src="${src}?v=${version}"></script>`).join('')+'</head>');
await fs.writeFile(path.join(output,'index.html'),html);
await fs.copyFile(path.join(root,'VERSION.txt'),path.join(output,'VERSION.txt'));
await fs.copyFile(path.join(root,'robots.txt'),path.join(output,'robots.txt'));
console.log('New UI production build:',version);
console.log(`JS/CSS: ${sourceBytes} -> ${outputBytes} bytes (${Math.round((1-outputBytes/sourceBytes)*100)}% smaller)`);

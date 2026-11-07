import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const img='),app.indexOf('function scoreClass'));
const ctx=vm.createContext({window:{},esc:value=>String(value).replaceAll('"','&quot;')});
vm.runInContext(fs.readFileSync(new URL('../../js/result-aggregator.js',import.meta.url),'utf8'),ctx);
vm.runInContext(source,ctx);
const render=(art,sizes)=>ctx.posterAttributes({art},sizes);
test('TMDB posters expose responsive widths with original fallback',()=>{
 const html=render('https://image.tmdb.org/t/p/w500/abc.jpg');
 assert.match(html,/src="https:\/\/image.tmdb.org\/t\/p\/w500\/abc.jpg"/);
 for(const width of [185,342,500,780])assert.ok(html.includes(`/w${width}/abc.jpg ${width}w`));
 assert.match(html,/sizes="\(max-width:700px\) 44vw, 220px"/);
 assert.match(html,/decoding="async"/);
});
test('history and featured posters have distinct display size hints',()=>{
 assert.match(render('https://image.tmdb.org/t/p/w500/a.jpg','80px'),/sizes="80px"/);
 assert.match(app,/posterAttributes\(f,featured\?/);
 assert.match(app,/loading="\$\{featured\?'eager':'lazy'\}"/);
 assert.doesNotMatch(app,/\.map\(card\)/);
});
test('external, local and malformed URLs are never rewritten as TMDB images',()=>{
 for(const url of ['assets/a.jpg','https://other.example/a.jpg','https://image.tmdb.org.evil.test/t/p/w500/a.jpg','https://image.tmdb.org/t/p/w500/a.jpg?x=1'])assert.doesNotMatch(render(url),/srcset=/);
 assert.doesNotMatch(render('x" onerror="bad'),/src="x"/);
});

test('known successful missing-image responses render a neutral poster even in cached cards',()=>{
 const url='https://p.bfvp26.com/upload/vod/20230619-1/9007664f78954ad2b459626a21ded7b2.png';
 assert.match(render(url+'?v=2'),/src="assets\/poster-unavailable.svg"/);
 assert.ok(render(url.replace('d7b2','d7b3')).includes('p.bfvp26.com'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const img='),app.indexOf('function scoreClass'));
const ctx=vm.createContext({esc:value=>String(value).replaceAll('"','&quot;')});
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

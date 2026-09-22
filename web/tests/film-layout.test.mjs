import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('player sidebar uses video row height instead of a fixed synopsis crop',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/\.watch-synopsis\{height:220px/);
 assert.match(css,/\.watch-side-column\{contain:size;align-self:stretch/);
 assert.match(css,/\.watch-aside>\.watch-synopsis\{flex:1 1 auto;min-height:130px/);
 assert.match(css,/@media\(max-width:1000px\)\{\.watch-synopsis\{max-height:45vh/);
});
test('small cards reuse Explore text layout without changing featured cards',()=>{
 const fn=app.slice(app.indexOf('const card='),app.indexOf('const grid='));
 assert.doesNotMatch(fn,/poster-footer/);
 assert.match(fn,/quick-favorite favorite-button/);
 assert.match(fn,/<\/button><\/article>/);
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.poster-grid \.quick-favorite\{bottom:16px;/);
 assert.match(css,/\.poster-grid \.poster-meta\{[^}]*flex-wrap:nowrap/);
 assert.match(css,/\.poster-grid \.poster-card h3\{padding-right:32px\}/);
 assert.doesNotMatch(css,/\.poster-grid \.poster-score\{[^}]*min-height:44px/);
 assert.doesNotMatch(css,/\.poster-grid \.poster-meta\{[^}]*min-height:64px/);
 assert.match(css,/\.poster-ribbon \.poster-card h3\{padding-right:32px\}/);
 assert.doesNotMatch(css,/#discovery-cards \.quick-favorite/);
});
test('movies do not acquire series controls from multiple source versions',()=>{
 const fn=app.match(/function isSeries\(f\)\{[^}]+\}/)[0];
 const context=vm.createContext({});vm.runInContext(fn,context);
 assert.equal(context.isSeries({type:'电影',episodes:3}),false);
 assert.equal(context.isSeries({type:'电视剧',episodes:3}),true);
 assert.equal(context.isSeries({type:'综艺',episodes:12}),true);
});
test('favorite undo is five seconds and long titles expose their full text',()=>{
 assert.match(app,/favoriteUndoId=null;\},5000\)/);
 assert.match(app,/<h3 title="\$\{esc\(f.name\)\}">/);
});
test('watch sidebar reserves reading space and keeps series controls compact',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(app,/watch-aside \$\{serial\?'has-episodes'/);
 assert.match(css,/\.watch-aside\.has-episodes>\.detail-section\{flex:1 1 40%;min-height:130px/);
 assert.match(css,/\.watch-aside \.watch-next\{margin-top:12px;flex-wrap:nowrap;border:0/);
 assert.match(css,/\.watch-aside \.season-tabs:has\(>button:only-child\)\{display:none/);
 const live=fs.readFileSync(new URL('../live-ui.js',import.meta.url),'utf8');
 assert.match(live,/<details class="watch-routes" aria-label="播放线路"><summary/);
 assert.match(live,/<span class="route-switch">切换源<\/span><\/summary>/);
});
test('plot disclosure leaves credits outside the collapsed text',()=>{
 assert.match(app,/<details class="watch-plot"><summary><span class="plot-expand">展开/);
 assert.match(app,/<\/section><dl class="watch-credits"><dt>导演/);
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.watch-plot\[open\]\+\.plot-preview\{display:none/);
 assert.match(css,/\.watch-credits\{[^}]*flex-shrink:0/);
});
test('player episode grid does not inherit detail page top spacing',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.watch-aside \.episodes\{[^}]*margin-top:0;align-content:start/);
 assert.match(css,/\.watch-aside \.section-head\{margin:0 0 10px\}/);
 assert.match(css,/\.watch-aside\.has-episodes\{padding-bottom:14px\}/);
});

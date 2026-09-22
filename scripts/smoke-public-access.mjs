import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isPublicAccess, isRequestAuthenticated } from '../server/auth-session.mjs';
import { isPublicTarget, publicRequestStatus } from '../server/public-access.mjs';
assert.equal(isPublicAccess({}),true);
assert.equal(isRequestAuthenticated({headers:{}},{}),true);
assert.equal(isRequestAuthenticated({headers:{}},{PASSWORD:'legacy'}),false);
const sandbox={window:{}};
vm.runInNewContext(readFileSync(new URL('../js/config.js',import.meta.url),'utf8'),sandbox);
for(const site of Object.values(sandbox.window.API_SITES)){
 if(site.adult||site.bridge)continue;
 assert.ok(isPublicTarget(site.api+'?ac=videolist&wd=test'),site.name+' is in public catalogue');
}
for (const url of [
 'https://www.huyaapi.com/api.php/provide/vod/at/xml?ac=detail',
 'https://www.hongniuzy2.com/api.php/provide/vod/from/other?ac=detail',
 'https://cjhwba.com/api.php/provide/vod?ac=detail',
 'http://192.168.1.1/api.php/provide/vod?ac=detail',
 'http://10.0.0.1/api.php/provide/vod?ac=detail',
 'http://172.16.0.1/api.php/provide/vod?ac=detail'
]) assert.equal(isPublicTarget(url), false, url);
for(const url of ['https://example.com/','http://127.0.0.1/','https://bfzyapi.com/admin','https://bfzyapi.com/api.php/provide/vod?ac=detail&url=http://localhost','https://img1.doubanio.com:8080/view/photo/x','https://movie.douban.com/accounts/login'])assert.equal(isPublicTarget(url),false,url);
assert.equal(publicRequestStatus({headers:{'sec-fetch-site':'cross-site'}},{}),403);
assert.equal(publicRequestStatus({headers:{origin:'https://evil.example',host:'our.example'}},{}),403);
const req={headers:{host:'our.example',origin:'https://our.example'},socket:{remoteAddress:'test-client'}};
for(let i=0;i<240;i++)assert.equal(publicRequestStatus(req,{},1000),200);
assert.equal(publicRequestStatus(req,{},1000),429);
assert.equal(publicRequestStatus(req,{},61000),200);
console.log('PASS: public mode, legacy compatibility, complete catalogue allowlist, URL constraints, cross-site denial, request backpressure');

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createProxyHandler } from '../api/proxy/[...path].mjs';
import { inspectionHash, nativeInspectionResource, MAX_NATIVE_INSPECTION_BYTES } from '../server/native-inspection.mjs';
const now=Date.now(),url='https://1.1.1.1/reviewed.ts',body=Buffer.from('reviewed bytes');
const resource={urlSha256:inspectionHash(url),bodySha256:inspectionHash(body),maxBytes:body.length};
const registry=[{reviewedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),resources:[resource]}];
assert.equal(nativeInspectionResource(url,now,registry),resource);
assert.equal(nativeInspectionResource(url+'?changed',now,registry),null);
assert.equal(nativeInspectionResource(url,now+60000,registry),null);
assert.equal(nativeInspectionResource(url,now,[{...registry[0],resources:[{...resource,maxBytes:MAX_NATIVE_INSPECTION_BYTES+1}]}]),null);
async function run({target=url,query={inspect:'manifest'},headers={},bytes=body,status=200,responseHeaders={},records=registry,env={}}={}){
 let calls=0;
 const req=Object.assign(new EventEmitter(),{method:'GET',headers,query:{'...path':encodeURIComponent(target),...query},socket:{remoteAddress:'fixture'}});
 const res=Object.assign(new EventEmitter(),{headersSent:false,writableEnded:false,headers:{},statusCode:200,
 setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(v){this.statusCode=v;return this;},send(v){this.body=v;this.writableEnded=true;return this;},end(){this.writableEnded=true;},json(v){return this.send(v);}});
 await createProxyHandler({env,now:()=>now,inspectionRegistry:records,fetchImpl:async()=>{calls++;return new Response(bytes,{status,headers:responseHeaders});}})(req,res);
 return {res,calls};
}
let result=await run();assert.equal(result.res.statusCode,200);assert.deepEqual(result.res.body,body);assert.equal(result.res.headers['cache-control'],'private, no-store');
for(const options of [{target:url+'?changed'},{query:{}},{records:[]},{env:{NATIVE_AD_INSPECTION_DISABLED:'1'}},{headers:{'sec-fetch-site':'cross-site'}},{headers:{range:'bytes=0-2'}}]){
 result=await run(options);assert.equal(result.res.statusCode,403);assert.equal(result.calls,0);
}
result=await run({bytes:Buffer.from('changed bytes!')});assert.equal(result.res.statusCode,409);
result=await run({bytes:Buffer.alloc(body.length+1)});assert.equal(result.res.statusCode,413);
result=await run({status:302,responseHeaders:{location:'https://1.0.0.1/other.ts'},bytes:null});assert.equal(result.res.statusCode,403);assert.equal(result.calls,1);
result=await run({target:'http://127.0.0.1/private',records:[{...registry[0],resources:[{...resource,urlSha256:inspectionHash('http://127.0.0.1/private')}]}]});assert.equal(result.res.statusCode,400);assert.equal(result.calls,0);
result=await run({env:{TURNSTILE_ENABLED:'true'}});assert.equal(result.res.statusCode,503);assert.equal(result.calls,0);
result=await run({env:{TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'x'.repeat(32),TURNSTILE_HOSTNAMES:'app.test'}});assert.equal(result.res.statusCode,428);assert.equal(result.calls,0);
console.log('Native inspection: exact URL/body, expiry, byte cap, no redirects/ranges, cross-site rejection and private-address rejection passed');

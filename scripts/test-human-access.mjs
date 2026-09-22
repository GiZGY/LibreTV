import test from 'node:test';
import assert from 'node:assert/strict';
import {humanConfig,humanStatus,humanCookie,verifyHuman,enforceHuman} from '../server/human-access.mjs';
import {createHumanHandler} from '../api/security/human.mjs';
import {createProxyHandler} from '../api/proxy/[...path].mjs';

const env={TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET_KEY:'s'.repeat(32),TURNSTILE_SESSION_SECRET:'k'.repeat(32),TURNSTILE_HOSTNAMES:'tv.cursyn.com'};
const req={headers:{'user-agent':'Test browser',host:'tv.cursyn.com',origin:'https://tv.cursyn.com'},socket:{remoteAddress:'127.0.0.99'}};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
test('explicit configuration fails closed when incomplete',()=>{
 assert.equal(humanStatus(req,{}),200);assert.equal(humanStatus(req,{TURNSTILE_ENABLED:'true'}),503);
 assert.equal(humanStatus(req,env),428);assert.equal(humanConfig(env).ready,true);
});
test('signed human session rejects tampering, expiry and another agent',()=>{
 const now=Date.now(),cookie=humanCookie(req,env,now).split(';')[0];
 const request={...req,headers:{...req.headers,cookie}};
 assert.equal(humanStatus(request,env,now),200);
 assert.equal(humanStatus({...request,headers:{...request.headers,cookie:cookie+'x'}},env,now),428);
 assert.equal(humanStatus(request,env,now+7*3600000),428);
 assert.equal(humanStatus({...request,headers:{...request.headers,'user-agent':'other'}},env,now),428);
 assert.match(humanCookie(req,{...env,VERCEL:'1'}),/HttpOnly; SameSite=Lax;.*Secure/);
});
test('verify requires server success, matching hostname and action',async()=>{
 const options=result=>({env,fetchImpl:async(url,init)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(JSON.parse(init.body).secret,env.TURNSTILE_SECRET_KEY);return{ok:true,json:async()=>result};}});
 assert.equal(await verifyHuman('token',options({success:true,hostname:'tv.cursyn.com',action:'browse'})),true);
 for(const result of [{success:false},{success:true,hostname:'attacker.example',action:'browse'},{success:true,hostname:'tv.cursyn.com',action:'other'}])assert.equal(await verifyHuman('token',options(result)),false);
 assert.equal(await verifyHuman('x'.repeat(2049),options({success:true})),false);
});
test('unverified API requests never reach proxy upstream',async()=>{
 let calls=0;const res=response();
 await createProxyHandler({env,fetchImpl:async()=>{calls++;throw new Error('must not run');}})({...req,method:'GET',params:{encodedUrl:encodeURIComponent('https://movie.douban.com/j/search_subjects')}},res);
 assert.equal(res.code,428);assert.equal(calls,0);assert.equal(res.headers['Cache-Control'],'private, no-store');
 const direct=response();assert.equal(enforceHuman(req,direct,env),false);
});
test('verification endpoint bounds attempts, denies foreign origins and never exposes secret',async()=>{
 let calls=0;
 const handler=createHumanHandler({env,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({success:true,hostname:'tv.cursyn.com',action:'browse'})};}});
 const status=response();await handler({...req,method:'GET'},status);assert.ok(!JSON.stringify(status.body).includes(env.TURNSTILE_SECRET_KEY));
 const foreign=response();await handler({...req,method:'POST',headers:{...req.headers,origin:'https://foreign.example'},body:{token:'x'}},foreign);assert.equal(foreign.code,403);assert.equal(calls,0);
 const valid=response();await handler({...req,method:'POST',body:{token:'x'}},valid);assert.equal(valid.code,200);assert.match(valid.headers['Set-Cookie'],/HttpOnly/);
 let limited;for(let i=0;i<10;i++){limited=response();await handler({...req,method:'POST',body:{token:'x'}},limited);}
 assert.equal(limited.code,429);assert.equal(calls,10);
});
test('Siteverify failures cannot issue a session',async()=>{
 const handler=createHumanHandler({env,fetchImpl:async()=>{throw new Error('network');}});
 const res=response();await handler({...req,socket:{remoteAddress:'127.0.0.98'},method:'POST',body:{token:'x'}},res);
 assert.equal(res.code,503);assert.equal(res.headers['Set-Cookie'],undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {publicLookup} from './local-public-dns.mjs';
const call=(lookup,host,all=false)=>new Promise((ok,fail)=>lookup(host,{all},(err,value)=>err?fail(err):ok(value)));
test('pins public DNS answers and coalesces concurrent source lookups',async()=>{
 let calls=0;const lookup=publicLookup(async()=>{calls++;return [{type:1,data:'8.8.8.8',TTL:60}]});
 assert.deepEqual(await Promise.all([call(lookup,'example.com'),call(lookup,'example.com',true)]),['8.8.8.8',[{address:'8.8.8.8',family:4}]]);assert.equal(calls,1);
});
test('never connects to private, synthetic or mixed answers; rejects local hostnames before lookup',async()=>{
 let calls=0;const lookup=publicLookup(async()=>{calls++;return [{type:1,data:'8.8.8.8',TTL:10},{type:1,data:calls===1?'198.18.0.5':'127.0.0.1',TTL:10}]});
 for(const host of ['localhost','127.0.0.1','a.internal'])await assert.rejects(call(lookup,host),{code:'ERR_BLOCKED_ADDRESS'});assert.equal(calls,0);
 for(let n=0;n<2;n++)await assert.rejects(call(lookup,'example.org'),{code:'ERR_BLOCKED_ADDRESS'});assert.equal(calls,2);
});

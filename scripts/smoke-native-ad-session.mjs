import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const mediaUrl='https://fixture.test/film.m3u8';
const evidence={mediaUrlSha256:createHash('sha256').update(mediaUrl).digest('hex')};
let verifies=0,installs=0,disposals=0,valid=true,delayed;
const context={window:{location:{href:'https://app.test/',origin:'https://app.test'},crypto:webcrypto,
 OpenStreamNativeAdTransport:{read:()=>{throw Error('unused');}},
 OpenStreamNativeAdVerifier:{verify:async input=>{verifies++;if(delayed)await delayed;assert.equal(input.mediaUrl,mediaUrl);return {status:'verified',verification:{}};}},
 OpenStreamNativeAdEvidence:{validate:()=>({supported:valid,reason:'timeline_mismatch'})},
 OpenStreamNativeAdGuard:{attach:()=>{installs++;const fn=()=>disposals++;fn.getStatus=()=>({});return fn;}}},URL,TextEncoder,Uint8Array,AbortController};
vm.runInNewContext(fs.readFileSync(new URL('../js/native-ad-session.js',import.meta.url),'utf8'),context);
const attach=context.window.OpenStreamNativeAdSession.attach;
const video={src:mediaUrl,currentSrc:mediaUrl,duration:120,seekable:{length:1,start:()=>0},handlers:new Map(),addEventListener(name,fn){this.handlers.set(name,fn);},removeEventListener(name){this.handlers.delete(name);}};
let session=attach({video,url:mediaUrl});await session.ready;assert.equal(session.getStatus().status,'no_unique_reviewed_version');assert.equal(verifies,0);session();
session=attach({video,url:mediaUrl,records:[evidence]});await session.ready;assert.equal(session.getStatus().status,'active');assert.equal(installs,1);session();assert.equal(disposals,1);
valid=false;session=attach({video,url:mediaUrl,records:[evidence]});await session.ready;assert.equal(session.getStatus().status,'timeline_mismatch');assert.equal(installs,1);session();assert.equal(video.handlers.size,0);valid=true;
let resolve;delayed=new Promise(done=>resolve=done);session=attach({video,url:mediaUrl,records:[evidence]});session();resolve();await session.ready;assert.equal(installs,1,'disposed verification cannot install a guard');delayed=null;
video.src=video.currentSrc='https://app.test/proxy/'+encodeURIComponent(mediaUrl);session=attach({video,url:video.src,records:[evidence]});await session.ready;assert.equal(session.getStatus().status,'active');session();
console.log('Native session: no unreviewed downloads, exact version, timeline gate, proxy target identity and disposal race passed');

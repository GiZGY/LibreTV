import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptSample, transportStream } from './audit-ad-encryption.mjs';
import { aesInspection } from '../services/ad-observer/aes.mjs';
import { observeMedia, compileRules, createBudget } from '../services/ad-observer/core.mjs';

const raw = new Uint8Array(16).fill(7);
const iv = new Uint8Array(16).fill(3);
const plaintext = new Uint8Array(188 * 5);
for (let i = 0; i < 5; i++) plaintext[i * 188] = 0x47;
const key = await webcrypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['encrypt']);
const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plaintext);
assert.deepEqual(await decryptSample(encrypted, raw, iv), plaintext);
assert.ok(transportStream(plaintext));
assert.equal(transportStream(new Uint8Array(940)), false);
await assert.rejects(decryptSample(encrypted, new Uint8Array(15), iv));
await assert.rejects(decryptSample(encrypted, raw, new Uint8Array(15)));
await assert.rejects(decryptSample(new Uint8Array(17), raw, iv));
await assert.rejects(decryptSample(new Uint8Array(0), raw, iv));
await assert.rejects(decryptSample(new Uint8Array(8 * 1024 * 1024 + 16), raw, iv));
const corrupt = new Uint8Array(encrypted).slice();
corrupt[corrupt.length - 17] ^= 255;
await assert.rejects(decryptSample(corrupt, raw, iv), 'invalid padding must fail closed');
const keyTag = '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x'+Buffer.from(iv).toString('hex');
const manifest = '#EXTM3U\n'+keyTag+'\n'+Array.from({length:80},(_,i)=>'#EXTINF:5,\n'+i+'.ts').join('\n')+'\n#EXT-X-ENDLIST';
const state={candidates:{}};
let keyReads=0, captured=0;
const result=await observeMedia({source:'aes-test',title:'Control',index:0,media:{text:manifest,url:'https://fixture.test/movie.m3u8'}},
  {state,budget:createBudget(),rules:[],decryptAes:true,
    read:async url=>url.endsWith('/key.bin')?(keyReads++,Buffer.from(raw)):Buffer.from(encrypted),
    saveEvidence:async (_id,_segments,buffers)=>{buffers.forEach(bytes=>assert.deepEqual(bytes,Buffer.from(plaintext)));captured++;return true;}});
assert.equal(result.inspection,'aes128_plaintext');
assert.equal(result.sampled,4);
assert.equal(keyReads,1,'reuse one imported key per playlist, never per segment');
assert.ok(captured>0);
assert.deepEqual(compileRules(state,[]),[],'decryption cannot authorize a new ad rule');
assert.doesNotMatch(JSON.stringify(state),/key.bin|fixture.test|AES-128|IV=/);
for(const invalid of [manifest.replace('AES-128','SAMPLE-AES'),manifest.replace(keyTag,keyTag+'\n'+keyTag),
  manifest.replace('METHOD=AES-128','METHOD=AES-128,METHOD=NONE'),manifest.replace(',IV=0x'+Buffer.from(iv).toString('hex'),'')]) {
  assert.equal(aesInspection(invalid,'https://fixture.test/movie.m3u8',()=>{throw new Error('must not fetch');},createBudget()),null);
}
console.log('AES sample round-trip, input bounds, corrupt padding and TS checks passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { publicEvidence } from './verify-native-ad-review.mjs';
import { MAX_NATIVE_INSPECTION_BYTES } from '../server/native-inspection.mjs';

const context={window:{}};
for(const file of ['ad-rules.js','native-ad-timelines.js','native-ad-evidence.js']){
    vm.runInNewContext(fs.readFileSync(new URL('../js/'+file,import.meta.url),'utf8'),context);
}
const {OpenStreamNativeAdTimelines:records,OpenStreamAdRules:rules,OpenStreamNativeAdEvidence:validator}=context.window;
assert.ok(Array.isArray(records));
const versions=new Set();
const inspection=JSON.parse(fs.readFileSync(new URL('../server/native-inspection.json',import.meta.url),'utf8'));
for(const grant of inspection){
    assert.deepEqual(Object.keys(grant).sort(),['expiresAt','resources','reviewedAt']);
    assert.ok(records.some(record=>record.reviewedAt===grant.reviewedAt&&record.expiresAt===grant.expiresAt),'inspection grant must share a reviewed timeline validity');
    assert.ok(grant.resources.length>0&&grant.resources.length<=34);
    const urls=new Set();
    for(const resource of grant.resources){
        assert.deepEqual(Object.keys(resource).sort(),['bodySha256','maxBytes','urlSha256']);
        assert.match(resource.urlSha256,/^[a-f0-9]{64}$/);assert.match(resource.bodySha256,/^[a-f0-9]{64}$/);
        assert.ok(!urls.has(resource.urlSha256));urls.add(resource.urlSha256);
        assert.ok(Number.isInteger(resource.maxBytes)&&resource.maxBytes>0&&resource.maxBytes<=MAX_NATIVE_INSPECTION_BYTES);
    }
}
for(const record of records){
    assert.deepEqual(JSON.parse(JSON.stringify(record)),JSON.parse(JSON.stringify(publicEvidence(record))),'only public schema fields');
    assert.ok(!versions.has(record.mediaUrlSha256),'one record per URL version');versions.add(record.mediaUrlSha256);
    const verifiedSegments=new Map();
    for(const range of record.ranges){
        const rule=rules.find(rule=>rule.id===range.ruleId);assert.ok(rule);
        range.segments.forEach((segment,index)=>{
            assert.ok(Number.isSafeInteger(segment.index)&&segment.index>=0);
            if(index)assert.equal(segment.index,range.segments[index-1].index+1);
            verifiedSegments.set(segment.identity,rule.segments[index].sha256);
        });
    }
    // Structural validation at review time is not an independent byte verification.
    const input={evidence:record,mediaUrlSha256:record.mediaUrlSha256,manifestSha256:record.manifestSha256,
        duration:record.timeline.duration,timelineStart:record.timeline.start,rules,verifiedSegments,
        now:Date.parse(record.reviewedAt)+1};
    assert.equal(validator.validate(input).supported,true);
    assert.equal(validator.validate({...input,now:Date.parse(record.expiresAt)}).supported,false);
    assert.equal(validator.validate({...input,manifestSha256:'0'.repeat(64)}).supported,false);
    assert.equal(validator.validate({...input,verifiedSegments:new Map()}).supported,false);
}
console.log('Native registry structure, unique version, sequence indices, expiry and no-unverified-byte activation passed; not fresh media verification');

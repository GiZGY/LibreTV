import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export async function loadRuleBundle() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await fs.readFile(new URL('../../js/ad-rules.js', import.meta.url), 'utf8'), context);
  return JSON.parse(JSON.stringify({rules:context.window.OpenStreamAdRules,
    overlayRules:context.window.OpenStreamOverlayRules || []}));
}

export async function loadBaseline() { return (await loadRuleBundle()).rules; }

// Use the actual player matcher, not a second implementation of its acceptance rules.
export async function validateRules(rules, now = Date.now()) {
  assert.ok(Array.isArray(rules) && rules.length <= 32);
  const context = vm.createContext({ window: {} });
  vm.runInContext(await fs.readFile(new URL('../../js/ad-guard.js', import.meta.url), 'utf8'), context);
  const guard = context.window.OpenStreamAdGuard;
  const ids = new Set();
  for (const rule of rules) {
    assert.ok(!rule.action || rule.action === 'skip', 'Overlay rules cannot enter the skip collection');
    assert.ok(!ids.has(rule.id)); ids.add(rule.id);
    assert.ok(Date.parse(rule.expiresAt) > now);
    let start = 100;
    const fragments = rule.segments.map((part, i) => {
      const fragment = { sn: i, url: `https://fixture.test/${i}`, duration: part.duration, start };
      start += part.duration;
      return fragment;
    });
    fragments.push({ sn: fragments.length, url: 'https://fixture.test/main', duration: 1800, start });
    const original = JSON.stringify(fragments);
    const candidates = guard.findCandidates(fragments, [rule], now);
    assert.equal(candidates.length, 1, 'Rule must be recognized by the deployed matcher');
    const verified = new Map(candidates[0].parts.map((part, i) => [guard.fragmentKey(part), rule.segments[i].sha256]));
    assert.equal(guard.rangeFor(candidates[0], verified, start + 1800)?.end, start);
    for (const part of candidates[0].parts) {
      const partial = new Map(verified); partial.delete(guard.fragmentKey(part));
      assert.equal(guard.rangeFor(candidates[0], partial, start + 1800), null);
      const changed = new Map(verified); changed.set(guard.fragmentKey(part), 'changed');
      assert.equal(guard.rangeFor(candidates[0], changed, start + 1800), null);
    }
    assert.equal(guard.rangeFor(candidates[0], verified, start - 1), null);
    assert.equal(JSON.stringify(fragments), original);
  }
  return { status: 'passed', rules: rules.length, checks: ['complete_sequence', 'every_missing_part',
    'every_changed_part', 'duration_bounds', 'unchanged_manifest'], browserPlayback: 'not_executed' };
}

export async function validateRuleBundle(rules, overlayRules, now = Date.now()) {
  assert.ok(Array.isArray(overlayRules) && rules.length + overlayRules.length <= 32,
    'Combined rule capacity exceeded; never silently truncate');
  const validation = await validateRules(rules, now);
  const context = vm.createContext({window:{}});
  vm.runInContext(await fs.readFile(new URL('../../js/ad-guard.js',import.meta.url),'utf8'),context);
  const guard=context.window.OpenStreamAdGuard;
  const ids=new Set(rules.map(rule=>rule.id));
  const sequenceKey=rule=>JSON.stringify(rule.segments.map(part=>[part.duration,part.sha256]));
  const sequences=new Set(rules.map(sequenceKey));
  for(const rule of overlayRules){
    assert.equal(rule.action,'report_overlay');
    assert.ok(!ids.has(rule.id));ids.add(rule.id);
    assert.ok(!sequences.has(sequenceKey(rule)),'Conflicting classifications for one sequence');
    assert.ok(Date.parse(rule.expiresAt)>now);
    let start=100;
    const fragments=rule.segments.map((part,sn)=>{const frag={sn,url:'https://fixture.test/'+sn,start,duration:part.duration};start+=part.duration;return frag;});
    const candidates=guard.findCandidates(fragments,[rule],now);
    assert.equal(candidates.length,1,'Overlay fingerprint must be discoverable');
    const verified=new Map(fragments.map((frag,i)=>[guard.fragmentKey(frag),rule.segments[i].sha256]));
    assert.equal(guard.rangeFor(candidates[0],verified,start+60),null,'Programme overlay must never authorize a skip');
  }
  return {...validation,overlayRules:overlayRules.length,overlayChecks:['classification_separation','combined_capacity','non_skipping']};
}

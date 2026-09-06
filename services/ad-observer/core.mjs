import { createHash } from 'node:crypto';
import { parseMediaPlaylist } from '../../scripts/audit-hls-ads.mjs';
import { fetchWithTimeout, readResponseBytes } from '../../bridge/tvbox-bridge/src/http.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const titleId = title => sha256(title.replace(/[\s：:·\-]/g, '').toLowerCase());
export const sequenceId = segments => sha256(JSON.stringify(segments.map(s => [s.duration, s.sha256])));
export const LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024, requests: 192, segmentBytes: 8 * 1024 * 1024,
  blocksPerLine: 4, candidates: 500, observations: 40, retentionDays: 30 });

export function discoverBlocks(text, offset = 0) {
  if (!text.includes('#EXT-X-ENDLIST')) return { status: 'unsupported_live', blocks: [] };
  const fragments = parseMediaPlaylist(text);
  if (fragments.length > 15000) return { status: 'manifest_limit', blocks: [] };
  const blocks = [];
  for (const fragment of fragments) {
    if (!blocks.length || blocks.at(-1)[0].cc !== fragment.cc) blocks.push([]);
    blocks.at(-1).push(fragment);
  }
  const eligible = blocks.filter(block => block.length >= 2 && block.length <= 100 &&
    block.reduce((sum, f) => sum + f.duration, 0) <= 120 &&
    block.every(f => !f.encrypted && !f.byteRange && !f.initMap && !f.gap));
  // Rotate the window across runs instead of repeatedly examining only the opening.
  const unique = [...new Map(eligible.map(block => [sha256(JSON.stringify(block.map(f =>
    [f.url, f.duration]))), block])).values()];
  const start = unique.length ? offset % unique.length : 0;
  return { status: unique.length ? 'candidates_found' : 'no_eligible_blocks',
    eligible: unique.length, blocks: [...unique.slice(start), ...unique.slice(0, start)].slice(0, LIMITS.blocksPerLine) };
}

export function createBudget() { return { bytes: 0, requests: 0, exhausted: false }; }

export async function downloadSegment(url, budget, { fetchImpl = fetch, signal } = {}) {
  // Reserve a full segment before awaiting so concurrent source workers share a hard bound.
  if (budget.requests >= LIMITS.requests || budget.bytes + LIMITS.segmentBytes > LIMITS.bytes) {
    budget.exhausted = true;
    throw Object.assign(new Error('Budget exhausted'), { code: 'BUDGET_EXHAUSTED' });
  }
  budget.requests++;
  budget.bytes += LIMITS.segmentBytes;
  let length = LIMITS.segmentBytes;
  try {
    const bytes = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, {
      signal, timeoutMs: 12000, consume: async response => {
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(new Error('Media unavailable'), { status: response.status });
        }
        return readResponseBytes(response, LIMITS.segmentBytes);
      }
    });
    if (!bytes.length) throw new Error('Empty media');
    length = bytes.length;
    return bytes;
  } finally {
    // Failed requests retain their reservation: retries cannot bypass the traffic limit.
    budget.bytes -= LIMITS.segmentBytes - length;
  }
}

export function recordCandidate(state, segments, occurrence, now = new Date()) {
  const id = sequenceId(segments);
  let entry = state.candidates[id];
  if (!entry && Object.keys(state.candidates).length >= LIMITS.candidates) return null;
  entry ||= state.candidates[id] = { id, segments, firstSeen: now.toISOString(), observations: [] };
  entry.lastSeen = now.toISOString();
  const observation = { source: occurrence.source,
    titleId: titleId(occurrence.title),
    line: occurrence.index, start: occurrence.start, end: occurrence.end };
  const key = JSON.stringify(observation);
  if (!entry.observations.some(item => JSON.stringify(item) === key)) {
    entry.observations.push(observation);
    entry.observations = entry.observations.slice(-LIMITS.observations);
  }
  return entry;
}

export function pruneState(state, now = new Date()) {
  const cutoff = now.getTime() - LIMITS.retentionDays * 86400000;
  for (const [id, entry] of Object.entries(state.candidates)) {
    if (Date.parse(entry.lastSeen) < cutoff) delete state.candidates[id];
  }
}

export function candidateStatus(entry, rules, now = Date.now()) {
  if (entry.review?.verdict === 'content' && Date.parse(entry.review.expiresAt) > now) return 'confirmed_content';
  if (entry.review?.verdict === 'uncertain' && Date.parse(entry.review.expiresAt) > now) return 'needs_review';
  const rule = rules.find(r => sequenceId(r.segments) === entry.id && Date.parse(r.expiresAt) > now);
  if (rule) return 'known_ad';
  const decision = entry.review;
  if (decision && Date.parse(decision.expiresAt) > now) {
    if (decision.verdict === 'content') return 'confirmed_content';
    if (decision.verdict === 'ad') return 'reviewed_ad';
  }
  return new Set(entry.observations.map(o => o.titleId)).size >= 2 ? 'needs_review' : 'single_title_candidate';
}

export async function observeMedia({ source, title, index, media }, { state, budget, rules,
  offset = 0, read = downloadSegment, saveEvidence = async () => false, now = new Date() }) {
  const discovery = discoverBlocks(media.text, offset);
  const results = [];
  for (const block of discovery.blocks) {
    try {
      const segments = [], buffers = [];
      for (const part of block) {
        const bytes = await read(new URL(part.url, media.url).href, budget);
        segments.push({ duration: part.duration, sha256: sha256(bytes) });
        buffers.push(bytes);
      }
      const entry = recordCandidate(state, segments, { source, title, index,
        start: block[0].start, end: block.at(-1).start + block.at(-1).duration }, now);
      if (!entry) { results.push({ status: 'candidate_limit' }); continue; }
      if (!entry.evidenceDigest) {
        const saved = await saveEvidence(entry.id, segments, buffers);
        if (saved) entry.evidenceDigest = sequenceId(segments);
      }
      results.push({ id: entry.id, status: candidateStatus(entry, rules, now.getTime()) });
    } catch (error) {
      results.push({ status: error.code === 'BUDGET_EXHAUSTED' ? 'budget_exhausted' :
        ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'content_fetch_failed' });
      if (budget.exhausted) break;
    }
  }
  return { status: discovery.status, eligible: discovery.eligible || 0, sampled: results.length, results };
}

export function reviewCandidate(entry, { verdict, evidenceDigest, reviewedAt, expiresAt }) {
  const reviewTime = Date.parse(reviewedAt), expiry = Date.parse(expiresAt);
  if (!entry || !['ad', 'content', 'uncertain'].includes(verdict) ||
    evidenceDigest !== entry.id || evidenceDigest !== entry.evidenceDigest ||
    !Number.isFinite(reviewTime) || reviewTime > Date.now() + 60000 ||
    !Number.isFinite(expiry) || expiry <= reviewTime || expiry - reviewTime > 30 * 86400000) {
    throw new Error('Invalid content review');
  }
  entry.review = { verdict, evidenceDigest, reviewedAt, expiresAt };
}

export function compileRules(state, baseline, now = new Date()) {
  const rules = baseline.filter(rule => Date.parse(rule.expiresAt) > now.getTime());
  for (const entry of Object.values(state.candidates)) {
    const review = entry.review;
    if (['content', 'uncertain'].includes(review?.verdict) && Date.parse(review.expiresAt) > now.getTime()) {
      // A false-positive decision also revokes a matching baseline rule.
      for (let i = rules.length - 1; i >= 0; i--) if (sequenceId(rules[i].segments) === entry.id) rules.splice(i, 1);
    }
  }
  const seen = new Set(rules.map(rule => sequenceId(rule.segments)));
  for (const entry of Object.values(state.candidates)) {
    const review = entry.review;
    if (review?.verdict !== 'ad' || Date.parse(review.expiresAt) <= now.getTime() ||
      review.evidenceDigest !== entry.id || entry.evidenceDigest !== entry.id || seen.has(entry.id)) continue;
    rules.push({ id: `reviewed-${entry.id.slice(0, 24)}`, reviewedAt: review.reviewedAt,
      expiresAt: review.expiresAt, segments: entry.segments });
    seen.add(entry.id);
  }
  if (rules.length > 32) throw new Error('Player rule capacity exceeded; do not truncate rules silently');
  return rules;
}

(function () {
    const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const finite = value => typeof value === 'number' && Number.isFinite(value);

    // A reviewed native timeline is not permission to trust a title or total duration.
    // The caller must independently obtain these hashes from this playback request.
    function validate({ evidence, mediaUrlSha256, manifestSha256, duration, timelineStart,
        verifiedSegments, rules = [], now = Date.now() }) {
        const reject = reason => ({ supported: false, reason, ranges: [] });
        if (!evidence || evidence.schema !== 1) return reject('missing_evidence');
        if (!sha256(mediaUrlSha256) || !sha256(manifestSha256) ||
            evidence.mediaUrlSha256 !== mediaUrlSha256 || evidence.manifestSha256 !== manifestSha256) {
            return reject('version_mismatch');
        }
        const reviewedAt = Date.parse(evidence.reviewedAt);
        const expiresAt = Date.parse(evidence.expiresAt);
        if (!finite(now) || !finite(reviewedAt) || !finite(expiresAt) ||
            reviewedAt > now || expiresAt <= now || expiresAt <= reviewedAt ||
            expiresAt - reviewedAt > 30 * 86400000) return reject('invalid_validity');
        if (evidence.timeline?.engine !== 'webkit-native' ||
            !finite(duration) || !finite(timelineStart) ||
            !finite(evidence.timeline.duration) || !finite(evidence.timeline.start) ||
            duration <= 0 || Math.abs(duration - evidence.timeline.duration) > 0.2 ||
            Math.abs(timelineStart - evidence.timeline.start) > 0.05) return reject('timeline_mismatch');
        if (!Array.isArray(evidence.ranges) || !evidence.ranges.length || evidence.ranges.length > 32 ||
            !verifiedSegments || typeof verifiedSegments.get !== 'function') return reject('invalid_evidence');
        const ranges = [];
        let previousEnd = timelineStart;
        for (const range of evidence.ranges) {
            const rule = rules.find(item => item.id === range.ruleId && (!item.action || item.action === 'skip'));
            if (!rule || !finite(Date.parse(rule.expiresAt)) || Date.parse(rule.expiresAt) <= now) return reject('inactive_rule');
            if (!Array.isArray(rule.segments) || !rule.segments.length || rule.segments.length > 100 ||
                !Array.isArray(range.segments) || range.segments.length !== rule.segments.length) return reject('incomplete_sequence');
            let expected = 0;
            const identities = new Set();
            for (let i = 0; i < rule.segments.length; i++) {
                const part = rule.segments[i], segment = range.segments[i];
                if (!finite(part.duration) || part.duration <= 0 || !sha256(part.sha256) ||
                    !sha256(segment?.identity) || identities.has(segment.identity) ||
                    verifiedSegments.get(segment.identity) !== part.sha256) return reject('unverified_segment');
                identities.add(segment.identity);
                expected += part.duration;
            }
            if (!finite(range.start) || !finite(range.end) || range.start < previousEnd ||
                range.end <= range.start || range.end > duration ||
                Math.abs(range.end - range.start - expected) > 0.2) return reject('invalid_range');
            ranges.push({ start: range.start, end: range.end, ruleId: rule.id });
            previousEnd = range.end;
        }
        return { supported: true, reason: 'verified_native_timeline', ranges };
    }

    window.OpenStreamNativeAdEvidence = { validate };
})();

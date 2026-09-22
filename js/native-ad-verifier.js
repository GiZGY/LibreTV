(function () {
    async function digest(bytes) {
        const hash = await window.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    const encode = value => new TextEncoder().encode(value);
    function singleRendition(text, base) {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.shift() !== '#EXTM3U') throw Error('unsupported_master');
        let target = null, pending = false, variants = 0;
        for (const line of lines) {
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                if (pending || ++variants > 1 || /(?:AUDIO|VIDEO|SUBTITLES|CLOSED-CAPTIONS)=/.test(line)) throw Error('unsupported_master');
                pending = true;
            } else if (!line.startsWith('#')) {
                if (!pending || target) throw Error('unsupported_master');
                target = new URL(line, base); pending = false;
            } else if (!/^#EXT-X-VERSION:\d+$/.test(line) && line !== '#EXT-X-INDEPENDENT-SEGMENTS') throw Error('unsupported_master');
        }
        if (pending || variants !== 1 || !target || !['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw Error('unsupported_master');
        return target.href;
    }
    function parse(text, base) {
        if (!text.trimStart().startsWith('#EXTM3U') || !text.includes('#EXT-X-ENDLIST') ||
            /#EXT-X-(?:STREAM-INF|BYTERANGE|MAP|GAP|PART|SKIP)[:\r\n]/.test(text)) throw Error('unsupported_playlist');
        const parts = [];
        let duration = null, start = 0, key = null, sequence = 0;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                sequence = Number(line.slice(22));
                if (parts.length || !Number.isSafeInteger(sequence) || sequence < 0) throw Error('invalid_sequence');
            } else if (line.startsWith('#EXTINF:')) {
                if (duration !== null) throw Error('invalid_duration');
                duration = Number(line.slice(8).split(',')[0]);
            } else if (line.startsWith('#EXT-X-KEY:')) {
                if (line === '#EXT-X-KEY:METHOD=NONE') { key = null; continue; }
                const attributes = line.slice(11).match(/[^=,]+=(?:"[^"]*"|[^,]*)/g) || [];
                if (attributes.join(',') !== line.slice(11)) throw Error('invalid_key');
                const fields = new Map();
                for (const attribute of attributes) {
                    const index = attribute.indexOf('='), name = attribute.slice(0, index);
                    if (fields.has(name)) throw Error('invalid_key');
                    fields.set(name, attribute.slice(index + 1).replace(/^"|"$/g, ''));
                }
                if (fields.get('METHOD') !== 'AES-128' || (fields.get('KEYFORMAT') || 'identity') !== 'identity' || !fields.get('URI')) throw Error('unsupported_encryption');
                const explicit = fields.get('IV');
                if (explicit && !/^0x[a-fA-F0-9]{32}$/.test(explicit)) throw Error('invalid_iv');
                key = { url: new URL(fields.get('URI'), base).href, explicit };
            } else if (line && !line.startsWith('#')) {
                if (!Number.isFinite(duration) || duration <= 0 || parts.length >= 15000) throw Error('invalid_duration');
                const url = new URL(line, base).href;
                if (!/^https?:/.test(url)) throw Error('invalid_url');
                parts.push({ index: parts.length, url, duration, start, key, sequence: sequence++ });
                start += duration; duration = null;
            }
        }
        if (duration !== null || !parts.length) throw Error('incomplete_playlist');
        return parts;
    }
    async function identity(part) {
        return digest(encode(JSON.stringify([part.index, part.url, part.duration])));
    }
    // Transport is explicitly injected: integration must retain proxy SSRF protections
    // and enforce maxBytes while reading, not after buffering an unlimited response.
    async function verify({ mediaUrl, evidence, rules, read, signal }) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        // This runs beside native playback, never on its startup critical path.
        const timer = setTimeout(abort, 30000);
        let requests = 0, bytes = 0, reserved = 0;
        const keys = new Map();
        const fetchBytes = async (url, limit) => {
            if (controller.signal.aborted) throw Error('aborted');
            if (!/^https?:/.test(url)) throw Error('invalid_url');
            if (++requests > 34) throw Error('request_limit');
            const remaining = Math.min(limit, 24 * 1024 * 1024 - bytes - reserved);
            if (remaining <= 0) throw Error('byte_limit');
            reserved += remaining;
            try {
                const value = await read(url, { signal: controller.signal, maxBytes: remaining });
                if (controller.signal.aborted) throw Error('aborted');
                if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > remaining) throw Error('invalid_response');
                bytes += value.byteLength; return value;
            } finally { reserved -= remaining; }
        };
        try {
            let mediaUrlSha256 = await digest(encode(mediaUrl));
            if (evidence?.entry && mediaUrlSha256 === evidence.entry.urlSha256) {
                if (!(Date.parse(evidence.expiresAt) > Date.now()) || !(Date.parse(evidence.reviewedAt) <= Date.now())) throw Error('invalid_validity');
                const master = await fetchBytes(mediaUrl, 1024 * 1024);
                if (await digest(master) !== evidence.entry.manifestSha256) throw Error('entry_mismatch');
                mediaUrl = singleRendition(new TextDecoder('utf-8', { fatal: true }).decode(master), mediaUrl);
                mediaUrlSha256 = await digest(encode(mediaUrl));
            }
            if (!evidence || evidence.mediaUrlSha256 !== mediaUrlSha256) throw Error('version_mismatch');
            if (!(Date.parse(evidence.expiresAt) > Date.now()) ||
                !(Date.parse(evidence.reviewedAt) <= Date.now())) throw Error('invalid_validity');
            const manifest = await fetchBytes(mediaUrl, 1024 * 1024);
            const manifestSha256 = await digest(manifest);
            if (manifestSha256 !== evidence.manifestSha256) throw Error('version_mismatch');
            const parts = parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest), mediaUrl);
            const verifiedSegments = new Map();
            const jobs = new Map();
            if (!Array.isArray(evidence.ranges) || !evidence.ranges.length || evidence.ranges.length > 32) throw Error('invalid_evidence');
            for (const range of evidence.ranges) {
                const rule = rules.find(item => item.id === range.ruleId && (!item.action || item.action === 'skip'));
                if (!rule || !(Date.parse(rule.expiresAt) > Date.now()) || !Array.isArray(range.segments) || range.segments.length !== rule.segments.length) throw Error('inactive_rule');
                for (let i = 0; i < range.segments.length; i++) {
                    const descriptor = range.segments[i], part = parts[descriptor.index];
                    if (!Number.isInteger(descriptor.index) || !part || await identity(part) !== descriptor.identity ||
                        (i && descriptor.index !== range.segments[i - 1].index + 1) ||
                        Math.abs(part.duration - rule.segments[i].duration) > 0.025) throw Error('segment_mismatch');
                    const previous = jobs.get(descriptor.identity);
                    if (previous && previous.expected !== rule.segments[i].sha256) throw Error('conflicting_fingerprint');
                    jobs.set(descriptor.identity, { descriptor, part, expected: rule.segments[i].sha256 });
                }
            }
            // Load each small key once; two media reads then share a reserved byte budget.
            for (const { part } of jobs.values()) {
                if (part.key && !keys.has(part.key.url)) keys.set(part.key.url, await fetchBytes(part.key.url, 16));
            }
            const verifyPart = async ({ descriptor, part, expected }) => {
                    let payload = await fetchBytes(part.url, 8 * 1024 * 1024);
                    if (part.key) {
                        const iv = part.key.explicit ? Uint8Array.from(part.key.explicit.slice(2).match(/../g), hex => parseInt(hex, 16)) : new Uint8Array(16);
                        if (!part.key.explicit) {
                            let value = BigInt(part.sequence);
                            for (let j = 15; j >= 0; j--) { iv[j] = Number(value & 255n); value >>= 8n; }
                        }
                        payload = new Uint8Array(await window.OpenStreamAdGuard.decryptForInspection(payload,
                            { method: 'AES-128', keyFormat: 'identity', key: keys.get(part.key.url), iv }));
                    }
                    const hash = await digest(payload);
                    if (hash !== expected) throw Error('fingerprint_mismatch');
                    verifiedSegments.set(descriptor.identity, hash);
            };
            const queue = [...jobs.values()];
            for (let i = 0; i < queue.length; i += 2) {
                // Settle both reads before key cleanup or returning a failed verification.
                const batch = await Promise.allSettled(queue.slice(i, i + 2).map(verifyPart));
                const failed = batch.find(item => item.status === 'rejected');
                if (failed) throw failed.reason;
            }
            const verification = { evidence, mediaUrlSha256, manifestSha256, verifiedSegments, rules };
            const result = window.OpenStreamNativeAdEvidence.validate({ ...verification,
                duration: evidence.timeline?.duration, timelineStart: evidence.timeline?.start });
            if (!result.supported) throw Error(result.reason);
            return { status: 'verified', verification, requests, bytes };
        } catch (_) {
            return { status: controller.signal.aborted ? 'aborted' : 'unverified', verification: null, requests, bytes };
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
            for (const key of keys.values()) key.fill(0);
        }
    }
    window.OpenStreamNativeAdVerifier = { verify, parse, identity };
})();

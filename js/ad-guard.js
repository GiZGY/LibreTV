(function () {
    function isRemotePlayback(video) {
        return !!video.webkitCurrentPlaybackTargetIsWireless ||
            ['connecting', 'connected'].includes(video.remote?.state);
    }
    function fragmentKey(frag) {
        return JSON.stringify([frag.level ?? 0, frag.sn ?? frag.start, frag.url, frag.byteRangeStartOffset ?? 0, frag.byteRangeEndOffset ?? 0]);
    }
    async function decryptForInspection(payload, data) {
        if (data?.method !== 'AES-128' || data.keyFormat !== 'identity') throw new Error('Unsupported encryption');
        if (!payload?.byteLength || payload.byteLength > 8 * 1024 * 1024 ||
            payload.byteLength % 16 || data.key?.byteLength !== 16 || data.iv?.byteLength !== 16) {
            throw new Error('Invalid encrypted fragment');
        }
        const copy = value => ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
            : new Uint8Array(value).slice();
        // HLS may transfer its original buffer as soon as the loader returns.
        const bytes = copy(payload), key = copy(data.key), iv = copy(data.iv);
        try {
            if (key.length !== 16 || iv.length !== 16 || !bytes.length ||
                bytes.length % 16 || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid encrypted fragment');
            const imported = await window.crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
            return await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, imported, bytes);
        } finally { key.fill(0); iv.fill(0); bytes.fill(0); }
    }
    function createFragmentLoader(BaseLoader, inspect) {
        return class extends BaseLoader {
            load(context, config, callbacks) {
                return super.load(context, config, {
                    ...callbacks,
                    onSuccess: (...args) => {
                        // Observe before the HLS worker transfers/detaches the
                        // buffer. Forward the exact response and all callbacks.
                        try { inspect(args[2], args[0]); } catch (_) {}
                        callbacks.onSuccess(...args);
                    }
                });
            }
        };
    }
    function findCandidates(fragments, rules, now = Date.now(), window = null, manifestDurations = null) {
        if (!Array.isArray(fragments) || fragments.length > 15000) return [];
        const candidates = [];
        candidates.truncated = false;
        for (const rule of (Array.isArray(rules) ? rules.slice(0, 32) : [])) {
            if (!rule || typeof rule.id !== 'string') continue;
            if (rule.action && !['skip', 'report_overlay'].includes(rule.action)) continue;
            if (!Number.isFinite(Date.parse(rule.expiresAt)) || Date.parse(rule.expiresAt) <= now) continue;
            if (!Array.isArray(rule.segments) || rule.segments.length < 2 || rule.segments.length > 100) continue;
            if (!rule.segments.every(part => part && Number.isFinite(part.duration) && part.duration > 0 && /^[a-f0-9]{64}$/.test(part.sha256))) continue;
            if (rule.segments.reduce((sum, part) => sum + part.duration, 0) > 120) continue;
            let matches = 0;
            for (let i = 0; i <= fragments.length - rule.segments.length; i++) {
                if (window && (fragments[i].start < window.start || fragments[i].start > window.end)) continue;
                const parts = fragments.slice(i, i + rule.segments.length);
                if (!parts.every((frag, j) => (
                    typeof frag.url === 'string' &&
                    Number.isFinite(frag.start) &&
                    Number.isFinite(frag.duration) &&
                    Math.abs((manifestDurations?.get(frag) ?? frag.duration) - rule.segments[j].duration) < 0.025
                ))) continue;
                // One ambiguous duration pattern must not disable all other rules.
                if (matches++ >= 256) { candidates.truncated = true; break; }
                candidates.push({ rule, parts, next: fragments[i + parts.length] });
            }
        }
        return candidates;
    }

    function verifiedRange(candidate, verified, duration) {
        const { rule, parts, next } = candidate;
        if (!Number.isFinite(duration) || duration <= 0 || Date.parse(rule.expiresAt) <= Date.now()) return null;
        if (!parts.every((frag, i) => verified.get(fragmentKey(frag)) === rule.segments[i].sha256)) return null;
        if (!parts.every((frag, i) => Number.isFinite(frag.start) && Number.isFinite(frag.duration) && frag.duration > 0 &&
            (i === 0 || Math.abs(parts[i - 1].start + parts[i - 1].duration - frag.start) <= 0.2))) return null;
        const start = parts[0].start;
        const last = parts[parts.length - 1];
        const end = last.start + last.duration;
        const expectedDuration = rule.segments.reduce((sum, part) => sum + part.duration, 0);
        // Use HLS's updated media coordinates, never a manually reconstructed
        // timeline. Ambiguous timestamp corrections must not trigger a seek.
        if (start < 0 || end > duration + 0.1 || Math.abs(end - start - expectedDuration) > 0.2) return null;
        if (next && (!Number.isFinite(next.start) || Math.abs(next.start - end) > 0.2)) return null;
        return { start, end: Math.min(end, duration), id: `${rule.id}:${parts[0].sn ?? start}` };
    }

    function rangeFor(candidate, verified, duration) {
        if (candidate.rule.action === 'report_overlay') return null;
        return verifiedRange(candidate, verified, duration);
    }

    function attach({ hls, video, events, host, rules = window.OpenStreamAdRules || [], enabled = () => true,
        overlayRules = window.OpenStreamOverlayRules || [], onOverlay = () => {} }) {
        if (!window.crypto?.subtle) {
            const dispose = () => {};
            dispose.getStatus = () => ({ supported: false, enabled: enabled(), reason: 'crypto_unavailable' });
            return dispose;
        }
        let candidates = [];
        let fragments = [];
        let manifestDurations = new WeakMap();
        let live = false;
        let windowAt = -Infinity;
        let relevantUrls = new Set();
        const verified = new Map();
        const pending = new Set();
        let pendingBytes = 0;
        let inspectionLimitHits = 0;
        const excluded = new Set();
        const reportedOverlays = new Set();
        const matchingRules = [...rules, ...overlayRules.map(rule => ({...rule, action:'report_overlay'}))];
        let disposed = false;
        let notice = null;
        let noticeTimer = 0;
        let undoTime = null;
        let undoId = null;
        let skips = 0;

        function refreshWindow(force = false) {
            const position = Number(video.currentTime) || 0;
            if (!force && Math.abs(position - windowAt) < 10) return;
            windowAt = position;
            // Reviewed sequences are at most 120 seconds. Include their starts
            // behind a seek target and the normal forward buffering horizon.
            candidates = live ? [] : findCandidates(fragments, matchingRules, Date.now(), {
                start: Math.max(0, position - 120), end: position + 90
            }, manifestDurations);
            relevantUrls = new Set(candidates.flatMap(candidate => candidate.parts.map(frag => frag.url)));
            const relevantKeys = new Set(candidates.flatMap(candidate => candidate.parts.map(fragmentKey)));
            for (const key of verified.keys()) if (!relevantKeys.has(key)) verified.delete(key);
        }

        function clearNotice() {
            clearTimeout(noticeTimer);
            notice?.remove();
            notice = null;
        }

        function undo() {
            if (disposed || isRemotePlayback(video)) { clearNotice(); return; }
            if (undoId !== null) excluded.add(undoId);
            if (undoTime !== null) video.currentTime = undoTime;
            clearNotice();
        }

        function showNotice() {
            clearNotice();
            if (!host) return;
            notice = document.createElement('div');
            notice.className = 'ad-skip-notice';
            notice.setAttribute('role', 'status');
            const label = document.createElement('span');
            label.textContent = '已跳过广告';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = '撤销';
            button.addEventListener('click', undo);
            notice.append(label, button);
            host.appendChild(notice);
            noticeTimer = setTimeout(clearNotice, 8000);
        }

        function tick() {
            if (!disposed) refreshWindow();
            if (disposed || !enabled() || isRemotePlayback(video) || video.paused || video.seeking || video.ended) return;
            for (const candidate of candidates) {
                if (candidate.rule.action === 'report_overlay') {
                    const overlay = verifiedRange(candidate, verified, video.duration);
                    if (overlay && !reportedOverlays.has(candidate.rule.id) &&
                        video.currentTime >= overlay.start && video.currentTime < overlay.end) {
                        reportedOverlays.add(candidate.rule.id);
                        // A content-quality signal never authorizes deleting programme footage.
                        try { onOverlay({ ruleId:candidate.rule.id }); } catch (_) {}
                    }
                    continue;
                }
                const range = rangeFor(candidate, verified, video.duration);
                if (!range || excluded.has(range.id)) continue;
                if (video.currentTime < range.start || video.currentTime >= range.end - 0.05) continue;
                let canSeek = false;
                for (let i = 0; i < video.seekable.length; i++) {
                    if (video.seekable.start(i) <= range.end && video.seekable.end(i) >= range.end - 0.05) canSeek = true;
                }
                if (!canSeek) continue;
                undoTime = video.currentTime;
                undoId = range.id;
                try { video.currentTime = range.end; } catch (_) { return; }
                excluded.add(range.id);
                skips++;
                showNotice();
                break;
            }
        }

        function onLevel(_event, data) {
            if (disposed) return;
            fragments = data.details?.fragments || [];
            // HLS mutates fragment durations after demuxing. Discovery uses
            // EXTINF values; rangeFor still validates corrected media coordinates.
            manifestDurations = new WeakMap(fragments.map(frag => [frag, frag.duration]));
            live = !!data.details?.live;
            refreshWindow(true);
        }

        async function onFragment(_event, data) {
            if (!disposed) refreshWindow();
            const url = data.frag?.url;
            if (disposed || !enabled() || isRemotePlayback(video) || data.frag?.type !== 'main' || !relevantUrls.has(url)) return;
            // The same URL can serve different bytes later. A previous
            // occurrence must not authorize skipping a not-yet-verified one.
            const key = fragmentKey(data.frag);
            if (pending.has(key)) return;
            const payload = data.payload;
            if (!payload || !payload.byteLength || payload.byteLength > 8 * 1024 * 1024) return;
            const bytes = payload.byteLength;
            // Bound inspection work independently of HLS download concurrency.
            // Overflow preserves playback; it never queues or fetches media again.
            if (pending.size >= 4 || pendingBytes + bytes > 16 * 1024 * 1024) {
                inspectionLimitHits++;
                return;
            }
            pending.add(key);
            pendingBytes += bytes;
            try {
                // Hash the bytes already fetched by HLS. No extra segment
                // downloads, decoded frames, or viewing data leave the browser.
                const encryption = data.frag?.decryptdata;
                const plaintext = encryption?.method && encryption.method !== 'NONE'
                    ? await decryptForInspection(payload, encryption) : payload;
                const hash = await window.crypto.subtle.digest('SHA-256', plaintext);
                if (disposed) return;
                verified.set(key, Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
                tick();
            } catch (_) {
                verified.delete(key);
            } finally {
                pending.delete(key);
                pendingBytes -= bytes;
            }
        }

        function onRemoteChange() {
            if (disposed) return;
            // Local verified coordinates cannot authorize seeks on a receiver.
            clearNotice();
            undoTime = null;
            undoId = null;
            refreshWindow(true);
        }

        function dispose() {
            disposed = true;
            hls.off(events.LEVEL_LOADED, onLevel);
            hls.off(events.FRAG_LOADED, onFragment);
            hls.off(events.DESTROYING, dispose);
            video.removeEventListener('timeupdate', tick);
            video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onRemoteChange);
            for (const event of ['connecting', 'connect', 'disconnect']) video.remote?.removeEventListener?.(event, onRemoteChange);
            clearNotice();
            candidates = [];
            fragments = [];
            manifestDurations = new WeakMap();
            verified.clear();
            reportedOverlays.clear();
        }
        hls.on(events.LEVEL_LOADED, onLevel);
        hls.on(events.FRAG_LOADED, onFragment);
        hls.on(events.DESTROYING, dispose);
        video.addEventListener('timeupdate', tick);
        video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onRemoteChange);
        for (const event of ['connecting', 'connect', 'disconnect']) video.remote?.addEventListener?.(event, onRemoteChange);
        dispose.inspect = (context, response) => onFragment(null, {
            frag: context?.frag, payload: response?.data
        });
        // Counts only: diagnostics must not expose media URLs or viewing history.
        // Zero candidates means unknown coverage, not an ad-free video.
        dispose.getStatus = () => ({
            supported: !isRemotePlayback(video),
            enabled: enabled() && !isRemotePlayback(video),
            reason: isRemotePlayback(video) ? 'remote_playback' : 'known_fingerprints_only',
            disposed,
            rules: rules.length,
            candidates: candidates.length,
            candidateLimitReached: !!candidates.truncated,
            pendingInspections: pending.size,
            pendingInspectionBytes: pendingBytes,
            inspectionLimitHits,
            verifiedSegments: verified.size,
            verifiedRanges: candidates.filter(candidate => rangeFor(candidate, verified, video.duration)).length,
            skips,
            overlays: reportedOverlays.size
        });
        return dispose;
    }

    window.OpenStreamAdGuard = { findCandidates, rangeFor, attach, createFragmentLoader, fragmentKey, isRemotePlayback, decryptForInspection };
})();

(function () {
    function fragmentKey(frag) {
        return JSON.stringify([frag.level ?? 0, frag.sn ?? frag.start, frag.url, frag.byteRangeStartOffset ?? 0, frag.byteRangeEndOffset ?? 0]);
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
    function findCandidates(fragments, rules, now = Date.now()) {
        if (!Array.isArray(fragments) || fragments.length > 15000) return [];
        const candidates = [];
        for (const rule of (Array.isArray(rules) ? rules.slice(0, 32) : [])) {
            if (!rule || typeof rule.id !== 'string') continue;
            if (!Number.isFinite(Date.parse(rule.expiresAt)) || Date.parse(rule.expiresAt) <= now) continue;
            if (!Array.isArray(rule.segments) || rule.segments.length < 2 || rule.segments.length > 100) continue;
            if (!rule.segments.every(part => part && Number.isFinite(part.duration) && part.duration > 0 && /^[a-f0-9]{64}$/.test(part.sha256))) continue;
            if (rule.segments.reduce((sum, part) => sum + part.duration, 0) > 120) continue;
            for (let i = 0; i <= fragments.length - rule.segments.length; i++) {
                const parts = fragments.slice(i, i + rule.segments.length);
                if (!parts.every((frag, j) => (
                    typeof frag.url === 'string' &&
                    Number.isFinite(frag.start) &&
                    Number.isFinite(frag.duration) &&
                    Math.abs(frag.duration - rule.segments[j].duration) < 0.025
                ))) continue;
                candidates.push({ rule, parts, next: fragments[i + parts.length] });
                if (candidates.length > 256) return [];
            }
        }
        return candidates;
    }

    function rangeFor(candidate, verified, duration) {
        const { rule, parts, next } = candidate;
        if (!Number.isFinite(duration) || duration <= 0 || Date.parse(rule.expiresAt) <= Date.now()) return null;
        if (!parts.every((frag, i) => verified.get(fragmentKey(frag)) === rule.segments[i].sha256)) return null;
        const start = parts[0].start;
        const last = parts[parts.length - 1];
        const end = last.start + last.duration;
        const expectedDuration = rule.segments.reduce((sum, part) => sum + part.duration, 0);
        // Use HLS's updated media coordinates, never a manually reconstructed
        // timeline. Ambiguous timestamp corrections must not trigger a seek.
        if (start < 0 || end > duration + 0.1 || Math.abs(end - start - expectedDuration) > 0.2) return null;
        if (next && Math.abs(next.start - end) > 0.2) return null;
        return { start, end: Math.min(end, duration), id: `${rule.id}:${parts[0].sn ?? start}` };
    }

    function attach({ hls, video, events, host, rules = window.OpenStreamAdRules || [], enabled = () => true }) {
        if (!window.crypto?.subtle) return () => {};
        let candidates = [];
        let relevantUrls = new Set();
        const verified = new Map();
        const pending = new Set();
        const excluded = new Set();
        let disposed = false;
        let notice = null;
        let noticeTimer = 0;
        let undoTime = null;
        let undoId = null;

        function clearNotice() {
            clearTimeout(noticeTimer);
            notice?.remove();
            notice = null;
        }

        function undo() {
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
            if (disposed || !enabled() || video.paused || video.seeking || video.ended) return;
            for (const candidate of candidates) {
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
                showNotice();
                break;
            }
        }

        function onLevel(_event, data) {
            if (disposed) return;
            candidates = data.details?.live ? [] : findCandidates(data.details?.fragments, rules);
            relevantUrls = new Set(candidates.flatMap(candidate => candidate.parts.map(frag => frag.url)));
        }

        async function onFragment(_event, data) {
            const url = data.frag?.url;
            if (disposed || !enabled() || data.frag?.type !== 'main' || !relevantUrls.has(url)) return;
            // The same URL can serve different bytes later. A previous
            // occurrence must not authorize skipping a not-yet-verified one.
            const key = fragmentKey(data.frag);
            if (pending.has(key)) return;
            const payload = data.payload;
            if (!payload || !payload.byteLength || payload.byteLength > 8 * 1024 * 1024) return;
            pending.add(key);
            try {
                // Hash the bytes already fetched by HLS. No extra segment
                // downloads, decoded frames, or viewing data leave the browser.
                const hash = await window.crypto.subtle.digest('SHA-256', payload);
                if (disposed) return;
                verified.set(key, Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
                tick();
            } catch (_) {
                verified.delete(key);
            } finally {
                pending.delete(key);
            }
        }

        function dispose() {
            disposed = true;
            hls.off(events.LEVEL_LOADED, onLevel);
            hls.off(events.FRAG_LOADED, onFragment);
            hls.off(events.DESTROYING, dispose);
            video.removeEventListener('timeupdate', tick);
            clearNotice();
            candidates = [];
            verified.clear();
        }
        hls.on(events.LEVEL_LOADED, onLevel);
        hls.on(events.FRAG_LOADED, onFragment);
        hls.on(events.DESTROYING, dispose);
        video.addEventListener('timeupdate', tick);
        dispose.inspect = (context, response) => onFragment(null, {
            frag: context?.frag, payload: response?.data
        });
        return dispose;
    }

    window.OpenStreamAdGuard = { findCandidates, rangeFor, attach, createFragmentLoader, fragmentKey };
})();

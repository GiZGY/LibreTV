(function () {
    function attach({ video, host, url, records = window.OpenStreamNativeAdTimelines || [],
        rules = () => window.OpenStreamAdRules || [], read = window.OpenStreamNativeAdTransport.read }) {
        const controller = new AbortController();
        let disposed = false, guard = null, status = 'checking_version';
        const expectedSource = new URL(url, window.location.href).href;
        function sourceUrl() {
            const value = new URL(expectedSource);
            if (value.origin === window.location.origin && value.pathname.startsWith('/proxy/')) {
                return new URL(decodeURIComponent(value.pathname.slice(7))).href;
            }
            return value.href;
        }
        const ready = (async () => {
            try {
                const mediaUrl = sourceUrl();
                const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(mediaUrl));
                const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
                if (disposed) return;
                const matches = Array.isArray(records) ? records.filter(item => item?.mediaUrlSha256 === key || item?.entry?.urlSha256 === key) : [];
                if (matches.length !== 1) { status = 'no_unique_reviewed_version'; return; }
                const evidence = JSON.parse(JSON.stringify(matches[0]));
                const result = await window.OpenStreamNativeAdVerifier.verify({ mediaUrl, evidence,
                    rules: rules(), read, signal: controller.signal });
                if (disposed) return;
                if (result.status !== 'verified') { status = result.status; return; }
                function install() {
                    if (disposed || guard || (video.currentSrc || video.src) !== expectedSource ||
                        !Number.isFinite(video.duration) || !video.seekable.length) return;
                    const getVerification = () => ({ ...result.verification, rules: rules() });
                    const check = window.OpenStreamNativeAdEvidence.validate({ ...getVerification(),
                        duration: video.duration, timelineStart: video.seekable.start(0) });
                    if (!check.supported) { status = check.reason; return; }
                    guard = window.OpenStreamNativeAdGuard.attach({ video, host, getVerification });
                    status = 'active';
                    stopWaiting();
                }
                waiting = install;
                for (const event of waitEvents) video.addEventListener(event, waiting);
                status = 'waiting_native_timeline'; install();
            } catch (_) { if (!disposed) status = 'unverified'; }
        })();
        const waitEvents = ['loadedmetadata', 'durationchange', 'progress', 'canplay'];
        let waiting;
        function stopWaiting() {
            if (waiting) for (const event of waitEvents) video.removeEventListener(event, waiting);
            waiting = null;
        }
        function dispose() {
            disposed = true; status = 'disposed'; controller.abort(); stopWaiting(); guard?.();
        }
        dispose.ready = ready;
        dispose.getStatus = () => ({ status, disposed, ...(guard ? { playback: guard.getStatus() } : {}) });
        return dispose;
    }
    window.OpenStreamNativeAdSession = { attach };
})();

(function () {
    function attach({ video, host, getVerification, enabled = () => true }) {
        const source = video.currentSrc || video.src;
        const excluded = new Set();
        let disposed = false, suspended = false, pending = null, lastUndo = null;
        let recoveryTimer, noticeTimer, notice, skips = 0, recoveries = 0;
        const remote = () => !!video.webkitCurrentPlaybackTargetIsWireless ||
            ['connecting', 'connected'].includes(video.remote?.state);
        const sameSource = () => !!source && (video.currentSrc || video.src) === source;
        const seekable = position => {
            for (let i = 0; i < video.seekable.length; i++) {
                if (position >= video.seekable.start(i) && position <= video.seekable.end(i)) return true;
            }
            return false;
        };
        function clearNotice() {
            clearTimeout(noticeTimer); notice?.remove(); notice = null;
        }
        function clearRecovery() {
            clearTimeout(recoveryTimer); pending = null;
        }
        function undo() {
            if (disposed || remote() || !sameSource() || !lastUndo || !seekable(lastUndo.from)) return;
            clearRecovery();
            try { video.currentTime = lastUndo.from; } catch (_) {}
            lastUndo = null; clearNotice();
        }
        function notify() {
            clearNotice();
            if (!host) return;
            notice = document.createElement('div'); notice.className = 'ad-skip-notice';
            notice.setAttribute('role', 'status');
            const label = document.createElement('span'); label.textContent = '已跳过广告';
            const button = document.createElement('button'); button.type = 'button'; button.textContent = '撤销';
            button.addEventListener('click', undo); notice.append(label, button); host.appendChild(notice);
            noticeTimer = setTimeout(clearNotice, 8000);
        }
        function recover() {
            const attempt = pending; clearRecovery();
            if (!attempt || disposed || remote() || !sameSource()) return;
            suspended = true; clearNotice();
            // Do not pull the viewer back after a manual seek away from this boundary.
            if (Math.abs(video.currentTime - attempt.to) <= 1 && seekable(attempt.from)) {
                try { video.currentTime = attempt.from; recoveries++; } catch (_) {}
            }
        }
        function tick() {
            if (disposed || suspended || !sameSource() || remote() || !enabled()) return;
            if (pending) {
                if (!video.seeking && video.readyState >= 2 &&
                    (video.currentTime > pending.to + 0.15 || (video.ended && pending.to === video.duration))) {
                    clearRecovery();
                }
                return;
            }
            if (video.paused || video.seeking || video.ended) return;
            let result;
            try {
                result = window.OpenStreamNativeAdEvidence.validate({ ...getVerification(),
                    duration: video.duration, timelineStart: video.seekable.length ? video.seekable.start(0) : NaN,
                    now: Date.now() });
            } catch (_) { return; }
            if (!result.supported) return;
            for (const range of result.ranges) {
                const id = `${range.ruleId}:${range.start}`;
                if (excluded.has(id) || video.currentTime < range.start || video.currentTime >= range.end - 0.05 || !seekable(range.end)) continue;
                const attempt = { from: video.currentTime, to: range.end };
                excluded.add(id); pending = attempt; lastUndo = attempt;
                try { video.currentTime = range.end; } catch (_) { clearRecovery(); suspended = true; return; }
                skips++; notify();
                recoveryTimer = setTimeout(recover, 6000);
                break;
            }
        }
        function cancel() { clearRecovery(); clearNotice(); lastUndo = null; }
        function seeking() {
            if (pending && Math.abs(video.currentTime - pending.to) > 1) cancel();
        }
        const handlers = { timeupdate: tick, ended: tick, seeking,
            pause: cancel, error: recover, emptied: cancel,
            webkitcurrentplaybacktargetiswirelesschanged: cancel };
        for (const [event, handler] of Object.entries(handlers)) video.addEventListener(event, handler);
        for (const event of ['connecting', 'connect', 'disconnect']) video.remote?.addEventListener?.(event, cancel);
        function dispose() {
            disposed = true; cancel(); excluded.clear();
            for (const [event, handler] of Object.entries(handlers)) video.removeEventListener(event, handler);
            for (const event of ['connecting', 'connect', 'disconnect']) video.remote?.removeEventListener?.(event, cancel);
        }
        dispose.getStatus = () => ({ disposed, suspended, skips, recoveries, pending: !!pending });
        return dispose;
    }
    window.OpenStreamNativeAdGuard = { attach };
})();

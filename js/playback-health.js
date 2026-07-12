(function () {
    const recordedReadyUrls = new Set();
    const recordedFailureKeys = new Set();

    function getCurrentSourceKey() {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.get('source') ||
                params.get('source_code') ||
                localStorage.getItem('currentSourceCode') ||
                localStorage.getItem('currentPlayingSource') ||
                '';
        } catch (_) {
            return '';
        }
    }

    function getStatus(name) {
        return window.OpenStreamSourceHealth?.SOURCE_STATUS?.[name] || name.toLowerCase();
    }

    function recordPlaybackReady(videoUrl, startedAt) {
        const sourceKey = getCurrentSourceKey();
        if (!sourceKey || !window.OpenStreamSourceHealth?.recordSourceEvent) return;

        const key = `${sourceKey}|${videoUrl || ''}`;
        if (recordedReadyUrls.has(key)) return;
        recordedReadyUrls.add(key);

        const ms = typeof startedAt === 'number'
            ? Math.max(0, Math.round(performance.now() - startedAt))
            : undefined;

        window.OpenStreamSourceHealth.recordSourceEvent(sourceKey, {
            status: getStatus('READY'),
            ms
        });
    }

    function recordPlaybackFailure(reason) {
        const sourceKey = getCurrentSourceKey();
        if (!sourceKey || !window.OpenStreamSourceHealth?.recordSourceEvent) return;

        const key = `${sourceKey}|${reason || 'error'}`;
        if (recordedFailureKeys.has(key)) return;
        recordedFailureKeys.add(key);

        const status = /timeout|超时/i.test(String(reason || ''))
            ? getStatus('TIMEOUT')
            : getStatus('ERROR');

        window.OpenStreamSourceHealth.recordSourceEvent(sourceKey, { status });
    }

    window.OpenStreamPlaybackHealth = {
        recordPlaybackReady,
        recordPlaybackFailure
    };
})();

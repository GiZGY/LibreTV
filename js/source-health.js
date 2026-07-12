// Source health is intentionally local-first: Vercel deployments stay stateless,
// while each browser keeps a useful rolling snapshot for ranking and fallback.
(function () {
    const STORAGE_KEY = 'openstreamSourceHealth';
    const SNAPSHOT_VERSION = 1;
    const MAX_HISTORY_AGE = 14 * 24 * 60 * 60 * 1000;

    const DEFAULT_HEALTH = {
        version: SNAPSHOT_VERSION,
        updatedAt: 0,
        sources: {}
    };

    const SOURCE_STATUS = {
        READY: 'ready',
        SLOW: 'slow',
        UNSTABLE: 'unstable',
        TIMEOUT: 'timeout',
        DEAD: 'dead',
        LOGIN_REQUIRED: 'login_required',
        UNSUPPORTED: 'unsupported',
        NO_RESULT: 'no_result',
        ERROR: 'error'
    };

    const LOGIN_SOURCE_PATTERNS = [
        /quark/i,
        /uc/i,
        /aliyun|ali/i,
        /115/,
        /ypan/i,
        /bpan/i,
        /zpan/i,
        /网盘/
    ];

    let state = loadHealthState();
    let cachedQualityMap = null;
    let cachedLatencyMap = null;
    let cachedCustomApis = null;

    function loadHealthState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_HEALTH, sources: {} };
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== SNAPSHOT_VERSION || !parsed.sources) {
                return { ...DEFAULT_HEALTH, sources: {} };
            }
            pruneOldEntries(parsed);
            return parsed;
        } catch (_) {
            return { ...DEFAULT_HEALTH, sources: {} };
        }
    }

    function saveHealthState() {
        try {
            state.updatedAt = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) {}
    }

    function pruneOldEntries(snapshot) {
        const cutoff = Date.now() - MAX_HISTORY_AGE;
        Object.keys(snapshot.sources || {}).forEach((sourceKey) => {
            const item = snapshot.sources[sourceKey];
            if (!item || (item.updatedAt && item.updatedAt < cutoff)) {
                delete snapshot.sources[sourceKey];
            }
        });
    }

    function getSourceDisplayName(sourceKey) {
        if (sourceKey && sourceKey.startsWith('custom_')) {
            const index = Number(sourceKey.replace('custom_', ''));
            return getCustomApis()[index]?.name || sourceKey;
        }
        return window.API_SITES?.[sourceKey]?.name || sourceKey;
    }

    function readJsonStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function getQualityMap() {
        if (!cachedQualityMap) cachedQualityMap = readJsonStorage('apiQualities', {});
        return cachedQualityMap;
    }

    function getLatencyMap() {
        if (!cachedLatencyMap) cachedLatencyMap = readJsonStorage('apiLatencies', {});
        return cachedLatencyMap;
    }

    function getCustomApis() {
        if (!cachedCustomApis) cachedCustomApis = readJsonStorage('customAPIs', []);
        return cachedCustomApis;
    }

    function looksLikeLoginSource(sourceKey) {
        const name = getSourceDisplayName(sourceKey);
        return LOGIN_SOURCE_PATTERNS.some((pattern) => pattern.test(`${sourceKey} ${name}`));
    }

    function isBridgeSource(sourceKey) {
        return /^(tvbox|bridge):/.test(String(sourceKey || '')) || !!window.API_SITES?.[sourceKey]?.bridge;
    }

    function normalizeStoredStatus(sourceKey, status) {
        if (
            isBridgeSource(sourceKey) &&
            [SOURCE_STATUS.UNSUPPORTED, SOURCE_STATUS.DEAD, SOURCE_STATUS.ERROR].includes(status)
        ) {
            return SOURCE_STATUS.READY;
        }
        return status || SOURCE_STATUS.READY;
    }

    function getInitialMetrics(sourceKey) {
        const quality = getQualityMap()?.[sourceKey];
        const latency = getLatencyMap()?.[sourceKey];
        const base = state.sources[sourceKey] || {};

        return {
            sourceKey,
            status: normalizeStoredStatus(sourceKey, base.status),
            success: Number(base.success || 0),
            failure: Number(base.failure || 0),
            timeout: Number(base.timeout || 0),
            noResult: Number(base.noResult || 0),
            avgMs: typeof base.avgMs === 'number' ? base.avgMs : null,
            lastMs: typeof base.lastMs === 'number' ? base.lastMs : null,
            qualityScore: typeof quality?.score === 'number' ? quality.score : null,
            latency: typeof latency === 'number' ? latency : null,
            updatedAt: base.updatedAt || 0
        };
    }

    function computeScore(metrics) {
        if (looksLikeLoginSource(metrics.sourceKey)) return -1000;
        if ([SOURCE_STATUS.LOGIN_REQUIRED, SOURCE_STATUS.UNSUPPORTED, SOURCE_STATUS.DEAD].includes(metrics.status)) {
            return -500;
        }

        let score = 50;
        if (typeof metrics.qualityScore === 'number') score += metrics.qualityScore * 8;
        if (typeof metrics.latency === 'number') score += Math.max(-30, 30 - metrics.latency / 150);
        if (typeof metrics.avgMs === 'number') score += Math.max(-25, 25 - metrics.avgMs / 180);

        score += metrics.success * 4;
        score -= metrics.failure * 6;
        score -= metrics.timeout * 10;
        score -= Math.min(metrics.noResult, 5) * 2;

        return score;
    }

    function getTier(metrics) {
        const score = computeScore(metrics);
        if (score >= 85) return 'S';
        if (score >= 55) return 'A';
        if (score >= 15) return 'B';
        return 'C';
    }

    function getSearchPlan(sourceKeys) {
        const sources = (Array.isArray(sourceKeys) ? sourceKeys : [])
            .filter(Boolean)
            .filter((sourceKey) => !looksLikeLoginSource(sourceKey))
            .map((sourceKey) => {
                const metrics = getInitialMetrics(sourceKey);
                return {
                    sourceKey,
                    name: getSourceDisplayName(sourceKey),
                    status: metrics.status,
                    score: computeScore(metrics),
                    tier: getTier(metrics),
                    metrics
                };
            })
            .filter((item) => ![SOURCE_STATUS.LOGIN_REQUIRED, SOURCE_STATUS.UNSUPPORTED, SOURCE_STATUS.DEAD].includes(item.status))
            .sort((a, b) => b.score - a.score);

        const tierRank = { S: 0, A: 1, B: 2, C: 3 };
        return sources.sort((a, b) => {
            const tierDelta = tierRank[a.tier] - tierRank[b.tier];
            if (tierDelta !== 0) return tierDelta;
            return b.score - a.score;
        });
    }

    function mergeAverage(previous, next) {
        if (typeof previous !== 'number') return next;
        return Math.round(previous * 0.72 + next * 0.28);
    }

    function recordSourceEvent(sourceKey, event) {
        if (!sourceKey) return;
        const current = getInitialMetrics(sourceKey);
        const next = {
            status: event.status || current.status || SOURCE_STATUS.READY,
            success: current.success,
            failure: current.failure,
            timeout: current.timeout,
            noResult: current.noResult,
            avgMs: current.avgMs,
            lastMs: typeof event.ms === 'number' ? event.ms : current.lastMs,
            updatedAt: Date.now()
        };

        if (typeof event.ms === 'number') {
            next.avgMs = mergeAverage(current.avgMs, event.ms);
        }

        if (event.status === SOURCE_STATUS.READY || event.status === SOURCE_STATUS.SLOW) {
            next.success += 1;
        } else if (event.status === SOURCE_STATUS.TIMEOUT) {
            next.timeout += 1;
            next.failure += 1;
        } else if (event.status === SOURCE_STATUS.NO_RESULT) {
            next.noResult += 1;
        } else if (event.status) {
            next.failure += 1;
        }

        if (next.timeout >= 5 && next.success === 0) next.status = SOURCE_STATUS.DEAD;
        if (next.failure >= 8 && next.success <= 1) next.status = SOURCE_STATUS.UNSTABLE;

        state.sources[sourceKey] = next;
        saveHealthState();
    }

    function getSourceStatus(sourceKey) {
        if (looksLikeLoginSource(sourceKey)) return SOURCE_STATUS.LOGIN_REQUIRED;
        return getInitialMetrics(sourceKey).status || SOURCE_STATUS.READY;
    }

    window.OpenStreamSourceHealth = {
        SOURCE_STATUS,
        getSearchPlan,
        getSourceStatus,
        recordSourceEvent,
        looksLikeLoginSource,
        _computeScore: computeScore,
        _storageKey: STORAGE_KEY
    };
})();

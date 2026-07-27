(function () {
    const STATUS = {
        READY: 'ready',
        TIMEOUT: 'timeout',
        UNSUPPORTED: 'unsupported',
        LOGIN_REQUIRED: 'login_required',
        NO_RESULT: 'no_result',
        ERROR: 'error'
    };

    const LOGIN_URL_PATTERNS = [
        /drive\.uc\.cn/i,
        /pan\.quark\.cn/i,
        /aliyundrive\.com/i,
        /alipan\.com/i,
        /115\.com/i,
        /ypan/i,
        /bpan/i,
        /zpan/i
    ];
    const RESPONSE_CACHE_LIMIT = 120;
    const responseCache = new Map();
    const KNOWN_STATUSES = new Set(Object.values(STATUS));

    function readCachedResponse(key) {
        const cached = responseCache.get(key);
        if (!cached) return null;
        if (cached.expiresAt <= Date.now()) {
            responseCache.delete(key);
            return null;
        }
        // Refresh insertion order for a small LRU cache.
        responseCache.delete(key);
        responseCache.set(key, cached);
        return cached.value;
    }

    function writeCachedResponse(key, value, ttlMs) {
        const status = value?.status;
        if (![STATUS.READY, STATUS.NO_RESULT].includes(status)) return value;
        responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (responseCache.size > RESPONSE_CACHE_LIMIT) {
            responseCache.delete(responseCache.keys().next().value);
        }
        return value;
    }

    function normalizeFilterCacheKey(filters) {
        return JSON.stringify({
            type: filters?.type || 'all',
            year: filters?.year || '',
            genre: filters?.genre || ''
        });
    }

    function getCustomApiInfoByKey(sourceKey) {
        const index = Number(String(sourceKey || '').replace('custom_', ''));
        try {
            const customApis = JSON.parse(localStorage.getItem('customAPIs') || '[]');
            return customApis[index] || null;
        } catch (_) {
            return null;
        }
    }

    function isBridgeSource(sourceKey) {
        return /^(tvbox|bridge):/.test(String(sourceKey || ''));
    }

    function normalizeBridgeSourceKey(sourceKey) {
        return String(sourceKey || '').replace(/^(tvbox|bridge):/, '');
    }

    async function fetchTvboxProxy(action, params, options = {}) {
        const url = new URL(`/api/tvbox/${action}`, window.location.origin);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });

        const response = await fetch(url.toString(), {
            signal: options.signal
        });
        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }
        if (!response.ok) {
            const fallbackStatus = (
                response.status === 408 ||
                response.status === 429 ||
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504
            )
                ? STATUS.TIMEOUT
                : (
                    response.status === 401 ||
                    response.status === 403 ||
                    response.status === 404 ||
                    response.status === 501
                )
                    ? STATUS.UNSUPPORTED
                    : STATUS.ERROR;
            return {
                ...(data && typeof data === 'object' ? data : {}),
                status: KNOWN_STATUSES.has(data?.status) ? data.status : fallbackStatus
            };
        }
        if (!data || typeof data !== 'object') return { status: STATUS.ERROR };
        return data;
    }

    function normalizeBridgeList(data, sourceKey) {
        const list = Array.isArray(data?.list) ? data.list : (Array.isArray(data?.results) ? data.results : []);
        return list.map((item) => ({
            ...item,
            source_code: sourceKey,
            source_name: item.source_name || normalizeBridgeSourceKey(sourceKey)
        }));
    }

    function buildApiParams(sourceKey) {
        if (String(sourceKey || '').startsWith('custom_')) {
            const customApi = getCustomApiInfoByKey(sourceKey);
            if (!customApi) return null;
            const base = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            return customApi.detail
                ? base + '&customDetail=' + encodeURIComponent(customApi.detail)
                : base;
        }
        return '&source=' + encodeURIComponent(sourceKey);
    }

    function isLoginRequiredSource(sourceKey) {
        return !!window.OpenStreamSourceHealth?.looksLikeLoginSource?.(sourceKey);
    }

    function isLoginRequiredUrl(url) {
        return LOGIN_URL_PATTERNS.some((pattern) => pattern.test(String(url || '')));
    }

    function isPlayableUrl(url) {
        const value = String(url || '').trim();
        if (!/^https?:\/\//i.test(value)) return false;
        if (isLoginRequiredUrl(value)) return false;
        return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(value) || /m3u8|mp4|video/i.test(value);
    }

    async function search(sourceKey, keyword, filters, options = {}) {
        if (isLoginRequiredSource(sourceKey)) {
            return { status: STATUS.LOGIN_REQUIRED, list: [] };
        }

        if (isBridgeSource(sourceKey)) {
            const cacheKey = `search|${sourceKey}|${String(keyword || '').trim()}|${normalizeFilterCacheKey(filters)}`;
            const cached = options.bypassCache ? null : readCachedResponse(cacheKey);
            if (cached) return cached;

            const data = await fetchTvboxProxy('search', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                wd: keyword
            }, options);
            const status = data?.status || STATUS.UNSUPPORTED;
            const list = normalizeBridgeList(data, sourceKey);
            return writeCachedResponse(cacheKey, {
                status: list.length > 0 ? STATUS.READY : status,
                list
            }, list.length > 0 ? 120000 : 30000);
        }

        const cacheKey = [
            'search',
            sourceKey,
            String(keyword || '').trim(),
            normalizeFilterCacheKey(filters),
            Number(options.maxPages || 1)
        ].join('|');
        const cached = options.bypassCache ? null : readCachedResponse(cacheKey);
        if (cached) return cached;

        const list = await searchByAPIAndKeyWord(sourceKey, keyword, filters, options);
        return writeCachedResponse(cacheKey, {
            status: Array.isArray(list) && list.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
            list: Array.isArray(list) ? list : []
        }, Array.isArray(list) && list.length > 0 ? 120000 : 30000);
    }

    async function detail(sourceKey, videoId, options = {}) {
        if (isLoginRequiredSource(sourceKey)) {
            return { status: STATUS.LOGIN_REQUIRED, episodes: [] };
        }

        if (isBridgeSource(sourceKey)) {
            const cacheKey = `detail|${sourceKey}|${videoId}`;
            const cached = options.bypassCache ? null : readCachedResponse(cacheKey);
            if (cached) return cached;

            const data = await fetchTvboxProxy('detail', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                id: videoId
            }, options);
            const episodes = Array.isArray(data?.episodes) ? data.episodes.filter(Boolean) : [];
            return writeCachedResponse(cacheKey, {
                status: data?.status || (episodes.length > 0 ? STATUS.READY : STATUS.NO_RESULT),
                episodes,
                data
            }, episodes.length > 0 ? 300000 : 30000);
        }

        const apiParams = buildApiParams(sourceKey);
        if (!apiParams) return { status: STATUS.UNSUPPORTED, episodes: [] };

        const cacheKey = `detail|${sourceKey}|${videoId}`;
        const cached = options.bypassCache ? null : readCachedResponse(cacheKey);
        if (cached) return cached;

        const response = await fetch(`/api/detail?id=${encodeURIComponent(videoId)}${apiParams}`, {
            signal: options.signal
        });
        if (!response.ok) return { status: STATUS.ERROR, episodes: [] };

        const data = await response.json();
        const episodes = Array.isArray(data?.episodes) ? data.episodes.filter(Boolean) : [];
        if (episodes.length === 0) {
            return writeCachedResponse(cacheKey, { status: STATUS.NO_RESULT, episodes: [], data }, 30000);
        }

        return writeCachedResponse(cacheKey, { status: STATUS.READY, episodes, data }, 300000);
    }

    async function episodes(sourceKey, videoId, options = {}) {
        const result = await detail(sourceKey, videoId, options);
        return {
            status: result.status,
            episodes: result.episodes || []
        };
    }

    async function play(sourceKey, videoId, flag, episodeIndex = 0, options = {}) {
        if (isBridgeSource(sourceKey)) {
            const cacheKey = `play|${sourceKey}|${videoId}|${flag || ''}|${episodeIndex}`;
            const cached = options.bypassCache ? null : readCachedResponse(cacheKey);
            if (cached) return cached;

            const data = await fetchTvboxProxy('play', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                id: videoId,
                flag,
                episode: episodeIndex
            }, options);
            const url = data?.url || data?.playUrl || '';
            if (data?.status && data.status !== STATUS.READY) return { status: data.status, url: '' };
            if (isLoginRequiredUrl(url)) return { status: STATUS.LOGIN_REQUIRED, url: '' };
            if (!isPlayableUrl(url)) return { status: STATUS.UNSUPPORTED, url: '' };
            return writeCachedResponse(cacheKey, { status: STATUS.READY, url, episodeIndex, data }, 30000);
        }

        const result = await detail(sourceKey, videoId, options);
        if (result.status !== STATUS.READY) return { status: result.status, url: '' };

        const url = result.episodes[episodeIndex] || result.episodes[0] || '';
        if (!url) return { status: STATUS.NO_RESULT, url: '' };
        if (isLoginRequiredUrl(url)) return { status: STATUS.LOGIN_REQUIRED, url: '' };
        if (!isPlayableUrl(url)) return { status: STATUS.UNSUPPORTED, url: '' };

        return {
            status: STATUS.READY,
            url,
            episodeIndex: result.episodes[episodeIndex] ? episodeIndex : 0,
            data: result.data
        };
    }

    function health(sourceKey) {
        return window.OpenStreamSourceHealth?.getSourceStatus?.(sourceKey) || STATUS.READY;
    }

    window.OpenStreamSourceAdapter = {
        STATUS,
        search,
        detail,
        episodes,
        play,
        health,
        isPlayableUrl,
        isLoginRequiredUrl,
        isLoginRequiredSource,
        isBridgeSource,
        clearCache() {
            responseCache.clear();
        }
    };
})();

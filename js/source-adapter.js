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

    function getCustomApiInfoByKey(sourceKey) {
        const index = Number(String(sourceKey || '').replace('custom_', ''));
        try {
            const customApis = JSON.parse(localStorage.getItem('customAPIs') || '[]');
            return customApis[index] || null;
        } catch (_) {
            return null;
        }
    }

    function getBridgeConfig() {
        const env = window.__ENV__ || {};
        const fromEnv = {
            url: env.TVBOX_BRIDGE_URL || '',
            token: env.TVBOX_BRIDGE_TOKEN || ''
        };
        if (fromEnv.url) return fromEnv;

        try {
            const parsed = JSON.parse(localStorage.getItem('tvboxBridgeConfig') || '{}');
            return {
                url: parsed.url || '',
                token: parsed.token || ''
            };
        } catch (_) {
            return { url: '', token: '' };
        }
    }

    function isBridgeSource(sourceKey) {
        return /^(tvbox|bridge):/.test(String(sourceKey || ''));
    }

    function normalizeBridgeSourceKey(sourceKey) {
        return String(sourceKey || '').replace(/^(tvbox|bridge):/, '');
    }

    function isUnsafeBridgeUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            if (!['https:', 'http:'].includes(url.protocol)) return true;
            const host = url.hostname;
            return host === 'localhost' ||
                host === '127.0.0.1' ||
                host === '0.0.0.0' ||
                host === '::1' ||
                host.startsWith('10.') ||
                host.startsWith('192.168.') ||
                /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
        } catch (_) {
            return true;
        }
    }

    async function fetchBridge(path, params) {
        const config = getBridgeConfig();
        if (!config.url || isUnsafeBridgeUrl(config.url)) {
            return { status: STATUS.UNSUPPORTED };
        }

        const url = new URL(path, config.url.replace(/\/+$/, '') + '/');
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });

        const response = await fetch(url.toString(), {
            headers: config.token ? { Authorization: `Bearer ${config.token}` } : {}
        });
        if (!response.ok) {
            return { status: response.status === 401 || response.status === 403 ? STATUS.UNSUPPORTED : STATUS.ERROR };
        }
        return response.json();
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
            const data = await fetchBridge('api/tvbox/search', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                wd: keyword
            });
            const status = data?.status || STATUS.UNSUPPORTED;
            const list = normalizeBridgeList(data, sourceKey);
            return {
                status: list.length > 0 ? STATUS.READY : status,
                list
            };
        }

        const list = await searchByAPIAndKeyWord(sourceKey, keyword, filters, options);
        return {
            status: Array.isArray(list) && list.length > 0 ? STATUS.READY : STATUS.NO_RESULT,
            list: Array.isArray(list) ? list : []
        };
    }

    async function detail(sourceKey, videoId) {
        if (isLoginRequiredSource(sourceKey)) {
            return { status: STATUS.LOGIN_REQUIRED, episodes: [] };
        }

        if (isBridgeSource(sourceKey)) {
            const data = await fetchBridge('api/tvbox/detail', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                id: videoId
            });
            const episodes = Array.isArray(data?.episodes) ? data.episodes.filter(Boolean) : [];
            return {
                status: data?.status || (episodes.length > 0 ? STATUS.READY : STATUS.NO_RESULT),
                episodes,
                data
            };
        }

        const apiParams = buildApiParams(sourceKey);
        if (!apiParams) return { status: STATUS.UNSUPPORTED, episodes: [] };

        const response = await fetch(`/api/detail?id=${encodeURIComponent(videoId)}${apiParams}`);
        if (!response.ok) return { status: STATUS.ERROR, episodes: [] };

        const data = await response.json();
        const episodes = Array.isArray(data?.episodes) ? data.episodes.filter(Boolean) : [];
        if (episodes.length === 0) return { status: STATUS.NO_RESULT, episodes: [], data };

        return { status: STATUS.READY, episodes, data };
    }

    async function episodes(sourceKey, videoId) {
        const result = await detail(sourceKey, videoId);
        return {
            status: result.status,
            episodes: result.episodes || []
        };
    }

    async function play(sourceKey, videoId, flag, episodeIndex = 0) {
        if (isBridgeSource(sourceKey)) {
            const data = await fetchBridge('api/tvbox/play', {
                sourceKey: normalizeBridgeSourceKey(sourceKey),
                id: videoId,
                flag,
                episode: episodeIndex
            });
            const url = data?.url || data?.playUrl || '';
            if (data?.status && data.status !== STATUS.READY) return { status: data.status, url: '' };
            if (isLoginRequiredUrl(url)) return { status: STATUS.LOGIN_REQUIRED, url: '' };
            if (!isPlayableUrl(url)) return { status: STATUS.UNSUPPORTED, url: '' };
            return { status: STATUS.READY, url, episodeIndex, data };
        }

        const result = await detail(sourceKey, videoId);
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
        isBridgeSource
    };
})();

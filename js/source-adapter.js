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
        isLoginRequiredSource
    };
})();

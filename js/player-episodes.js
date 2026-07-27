// Normalizes CMS string episodes and TVBox episode descriptors for every player path.
(function () {
    const dblclickBoundVideos = new WeakSet();

    function normalizePlaybackUrl(value, sourceKey = '') {
        const rawUrl = String(value || '').trim();
        if (!rawUrl || sourceKey !== 'jisu') return rawUrl;

        try {
            const parsed = new URL(rawUrl);
            if (
                parsed.hostname.endsWith('jisuzyv.com') &&
                /^\/play\/[^/]+\/?$/.test(parsed.pathname)
            ) {
                parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/index.m3u8`;
                return parsed.toString();
            }
        } catch (_) {}
        return rawUrl;
    }

    function parseTvboxUrl(value) {
        if (typeof value !== 'string' || !value.startsWith('tvbox://')) return {};
        try {
            const parsed = new URL(value);
            return {
                sourceKey: parsed.searchParams.get('sourceKey') || parsed.searchParams.get('source') || '',
                videoId: parsed.searchParams.get('id') || '',
                flag: parsed.searchParams.get('flag') || '',
                episode: parsed.searchParams.get('episode')
            };
        } catch (_) {
            return {};
        }
    }

    function normalizeEpisode(entry, index, fallback = {}) {
        const inputUrl = typeof entry === 'string' ? entry : String(entry?.url || '');
        const tvboxParams = parseTvboxUrl(inputUrl);
        const parsedEpisode = Number(tvboxParams.episode);
        const objectEpisode = Number(entry?.episode);
        const sourceKey = String(
            entry?.sourceKey ||
            entry?.source_code ||
            fallback.sourceKey ||
            tvboxParams.sourceKey ||
            ''
        );
        const rawUrl = normalizePlaybackUrl(inputUrl, sourceKey);
        const videoId = String(
            entry?.id ||
            entry?.videoId ||
            fallback.videoId ||
            tvboxParams.videoId ||
            ''
        );
        const episode = Number.isFinite(objectEpisode)
            ? objectEpisode
            : (Number.isFinite(parsedEpisode) ? parsedEpisode : Number(index) || 0);

        return {
            name: String(entry?.name || entry?.title || `第${episode + 1}集`),
            sourceKey,
            videoId,
            flag: String(entry?.flag || tvboxParams.flag || fallback.flag || ''),
            episode,
            url: rawUrl,
            requiresAdapter: rawUrl.startsWith('tvbox://') ||
                !!window.OpenStreamSourceAdapter?.isBridgeSource?.(sourceKey)
        };
    }

    async function resolveEpisode(entry, index, fallback = {}, options = {}) {
        const descriptor = normalizeEpisode(entry, index, fallback);
        if (!descriptor.requiresAdapter) {
            if (!descriptor.url || typeof descriptor.url !== 'string') {
                return { ...descriptor, status: 'no_result', url: '' };
            }
            return { ...descriptor, status: 'ready' };
        }

        const adapter = window.OpenStreamSourceAdapter;
        if (!adapter?.play || !descriptor.sourceKey || !descriptor.videoId) {
            return { ...descriptor, status: 'unsupported', url: '' };
        }

        const playable = await adapter.play(
            descriptor.sourceKey,
            descriptor.videoId,
            descriptor.flag,
            descriptor.episode,
            { signal: options.signal }
        );
        return {
            ...descriptor,
            status: playable?.status || 'unsupported',
            url: typeof playable?.url === 'string' ? playable.url : '',
            playData: playable?.data
        };
    }

    function bindDblclickOnce(video, handler) {
        if (!video || dblclickBoundVideos.has(video)) return false;
        dblclickBoundVideos.add(video);
        video.addEventListener('dblclick', handler);
        return true;
    }

    window.OpenStreamPlayerEpisodes = {
        normalizeEpisode,
        normalizePlaybackUrl,
        resolveEpisode,
        bindDblclickOnce
    };
})();

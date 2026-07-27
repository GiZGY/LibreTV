function normalizeSearchFilters(filters) {
    const defaults = SEARCH_FILTERS_CONFIG?.default || { type: 'all', year: '', genre: '' };
    const input = filters || {};

    const normalizedType = (SEARCH_FILTERS_CONFIG?.types || []).some(item => item.value === input.type)
        ? input.type
        : defaults.type;

    const normalizedYear = /^\d{4}$/.test(String(input.year || '')) ? String(input.year) : '';
    const normalizedGenre = String(input.genre || '').trim();

    return {
        type: normalizedType || 'all',
        year: normalizedYear,
        genre: normalizedGenre
    };
}

function getDefaultSearchFilters() {
    const defaults = SEARCH_FILTERS_CONFIG?.default || { type: 'all', year: '', genre: '' };
    return {
        type: defaults.type || 'all',
        year: defaults.year || '',
        genre: defaults.genre || ''
    };
}

function hasActiveSearchFilters(filters) {
    return !!(filters && (filters.type !== 'all' || filters.year || filters.genre));
}

function containsAnyKeyword(text, keywords) {
    const source = String(text || '').toLowerCase();
    if (!source || !Array.isArray(keywords) || keywords.length === 0) return false;
    return keywords.some(k => source.includes(String(k).toLowerCase()));
}

function matchesTypeFilter(item, type) {
    if (!type || type === 'all') return true;

    const typeText = [item?.type_name, item?.vod_class, item?.vod_type]
        .filter(Boolean)
        .join(' ');
    const remarkText = String(item?.vod_remarks || '');

    const rules = SEARCH_FILTERS_CONFIG?.typeKeywords || {};
    const movieKeywords = Array.isArray(rules.movie) ? rules.movie : [];
    const tvKeywords = Array.isArray(rules.tv) ? rules.tv : [];
    const hasMovieHint = containsAnyKeyword(typeText, movieKeywords);
    const hasTvHint = containsAnyKeyword(typeText, tvKeywords)
        || /(第\\s*\\d+\\s*集|全\\s*\\d+\\s*集|更新至|连载|完结)/.test(remarkText);

    // 电视剧筛选：需要明确的剧集信号，避免把电影混进来。
    if (type === 'tv') {
        return hasTvHint;
    }

    // 电影筛选：只排除“明确电视剧”，其余都放行，避免误杀仅提供题材名的电影源。
    if (type === 'movie') {
        if (hasTvHint && !hasMovieHint) return false;
        return true;
    }

    return true;
}

function matchesYearFilter(item, year) {
    if (!year) return true;
    const target = String(year);
    const directYear = String(item?.vod_year || '').trim();
    if (directYear === target) return true;

    // 兜底：部分源不填 vod_year，但会在备注/标题/简介里带年份
    const fallbackText = [item?.vod_remarks, item?.vod_name, item?.vod_content]
        .filter(Boolean)
        .join(' ');
    return fallbackText.includes(target);
}

function matchesGenreFilter(item, genre) {
    if (!genre) return true;

    const genreText = [item?.type_name, item?.vod_class, item?.vod_remarks, item?.vod_content]
        .filter(Boolean)
        .join(' ');

    return containsAnyKeyword(genreText, [genre]);
}

function applySearchFiltersToResults(items, filters) {
    const list = Array.isArray(items) ? items : [];
    const normalized = normalizeSearchFilters(filters);

    return list.filter(item => (
        matchesTypeFilter(item, normalized.type) &&
        matchesYearFilter(item, normalized.year) &&
        matchesGenreFilter(item, normalized.genre)
    ));
}

function buildSearchApiUrl(apiBaseUrl, query, filters, page) {
    const params = new URLSearchParams();
    params.set('ac', 'videolist');

    const keyword = String(query || '').trim();
    if (keyword) params.set('wd', keyword);

    if (page && page > 1) {
        params.set('pg', String(page));
    }

    if (filters.year) {
        params.set('year', filters.year);
    }

    // 大多数采集站对 class/year 支持比 type id 更稳定；接口不支持时会走本地兜底过滤。
    if (filters.genre) {
        params.set('class', filters.genre);
    } else if (filters.type === 'movie') {
        params.set('class', '电影');
    } else if (filters.type === 'tv') {
        params.set('class', '电视剧');
    }

    return `${apiBaseUrl}?${params.toString()}`;
}

function createLinkedAbortController(externalSignal, timeoutMs = 15000) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        abortFromParent();
    } else {
        externalSignal?.addEventListener('abort', abortFromParent, { once: true });
    }
    const timeoutId = setTimeout(() => {
        const error = new Error(`数据源请求超时 (${timeoutMs}ms)`);
        error.name = 'TimeoutError';
        controller.abort(error);
    }, timeoutMs);

    return {
        signal: controller.signal,
        cleanup() {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener('abort', abortFromParent);
        }
    };
}

function createSearchAbortError(reason) {
    const error = new Error(
        reason instanceof Error ? reason.message : 'Search aborted',
        reason instanceof Error ? { cause: reason } : undefined
    );
    error.name = reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError';
    return error;
}

class SourceSearchError extends Error {
    constructor(message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'SourceSearchError';
        this.status = options.status || 0;
    }
}

const SEARCH_PAGE_CACHE_TTL = 2 * 60 * 1000;
const SEARCH_PAGE_CACHE_LIMIT = 240;
const searchPageCache = new Map();

function readSearchPageCache(url) {
    const cached = searchPageCache.get(url);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        searchPageCache.delete(url);
        return null;
    }
    searchPageCache.delete(url);
    searchPageCache.set(url, cached);
    return cached.data;
}

function writeSearchPageCache(url, data) {
    searchPageCache.set(url, {
        data,
        expiresAt: Date.now() + SEARCH_PAGE_CACHE_TTL
    });
    while (searchPageCache.size > SEARCH_PAGE_CACHE_LIMIT) {
        searchPageCache.delete(searchPageCache.keys().next().value);
    }
    return data;
}

async function fetchApiListByUrl(url, externalSignal) {
    if (externalSignal?.aborted) throw createSearchAbortError(externalSignal.reason);
    const cached = readSearchPageCache(url);
    if (cached) return cached;
    const requestAbort = createLinkedAbortController(externalSignal);

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl
            ? await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url))
            : PROXY_URL + encodeURIComponent(url);

        let response;
        try {
            response = await fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers,
                signal: requestAbort.signal
            });
        } catch (error) {
            if (requestAbort.signal.aborted) {
                throw createSearchAbortError(requestAbort.signal.reason || error);
            }
            throw new SourceSearchError('数据源网络请求失败', { cause: error });
        }

        if (!response.ok) {
            throw new SourceSearchError(`数据源请求失败 (${response.status})`, {
                status: response.status
            });
        }

        let data;
        try {
            data = await response.json();
        } catch (error) {
            throw new SourceSearchError('数据源返回了无效 JSON', { cause: error });
        }
        if (!data || !Array.isArray(data.list)) {
            throw new SourceSearchError('数据源返回格式无效');
        }

        return writeSearchPageCache(url, data);
    } finally {
        requestAbort.cleanup();
    }
}

function mapApiResults(list, apiId, apiName) {
    return (Array.isArray(list) ? list : []).map(item => ({
        ...item,
        source_name: apiName,
        source_code: apiId,
        api_url: apiId.startsWith('custom_') ? getCustomApiInfo(apiId.replace('custom_', ''))?.url : undefined
    }));
}

function dedupeResults(items) {
    const seen = new Set();
    const output = [];
    (Array.isArray(items) ? items : []).forEach(item => {
        const key = `${item?.source_code || ''}::${item?.vod_id || ''}::${item?.vod_name || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push(item);
    });
    return output;
}

async function runSearchQueue(items, concurrency, worker) {
    const input = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(input.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, input.length) }, async () => {
        while (nextIndex < input.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await worker(input[currentIndex], currentIndex);
        }
    });

    await Promise.allSettled(workers);
    return results;
}

async function fetchPagedResults(apiBaseUrl, apiId, apiName, query, filters, startPage, endPage, signal) {
    const pages = [];
    for (let page = startPage; page <= endPage; page++) {
        pages.push(page);
    }

    const pageResults = await runSearchQueue(
        pages,
        API_CONFIG.search.pageConcurrency || 2,
        async (page) => {
            if (signal?.aborted) throw createSearchAbortError(signal.reason);
            try {
                const pageUrl = buildSearchApiUrl(apiBaseUrl, query, filters, page);
                const pageData = await fetchApiListByUrl(pageUrl, signal);
                if (!pageData || !Array.isArray(pageData.list) || pageData.list.length === 0) {
                    return [];
                }
                return mapApiResults(pageData.list, apiId, apiName);
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                return [];
            }
        }
    );

    return pageResults.flat().filter(Boolean);
}

async function searchByAPIAndKeyWord(apiId, query, filters, options = {}) {
    try {
        if (options.signal?.aborted) {
            throw createSearchAbortError(options.signal.reason);
        }
        // 360 资源当前疑似不支持关键词搜索：无论 wd 是什么都会返回同一批“短剧”列表
        // 为避免污染搜索结果，直接忽略它（用户仍可在设置里取消勾选）。
        if (apiId === 'zy360') {
            if (!window.__ZY360_SEARCH_WARNED__) {
                window.__ZY360_SEARCH_WARNED__ = true;
                try {
                    window.showToast && window.showToast('360资源疑似不支持关键词搜索，已自动忽略该源结果（避免短剧刷屏）', 'info');
                } catch (_) {}
            }
            return [];
        }

        let apiName;
        let apiBaseUrl;

        if (apiId.startsWith('custom_')) {
            const customIndex = apiId.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) throw new SourceSearchError('自定义数据源不存在');

            apiName = customApi.name;
            apiBaseUrl = customApi.url;
        } else {
            if (!API_SITES[apiId]) throw new SourceSearchError('数据源不存在');
            apiName = API_SITES[apiId].name;
            apiBaseUrl = API_SITES[apiId].api;
        }

        const normalizedFilters = normalizeSearchFilters(filters);
        const hasKeyword = !!String(query || '').trim();
        const shouldUseFilterSearch = !hasKeyword && hasActiveSearchFilters(normalizedFilters);
        const requestFilters = shouldUseFilterSearch ? normalizedFilters : getDefaultSearchFilters();

        let firstUrl = buildSearchApiUrl(apiBaseUrl, query, requestFilters, 1);
        let firstPageData = null;
        try {
            firstPageData = await fetchApiListByUrl(firstUrl, options.signal);
        } catch (error) {
            // 部分 CMS 会因不支持 class/year 参数直接报错；筛选态可退回基础列表。
            if (!shouldUseFilterSearch || error?.name === 'AbortError') throw error;
        }

        // 兜底：部分采集站对 class/year 参数支持差，筛选请求空结果时回退到基础列表再本地过滤。
        if ((!firstPageData || !Array.isArray(firstPageData.list) || firstPageData.list.length === 0) && shouldUseFilterSearch) {
            firstUrl = buildSearchApiUrl(apiBaseUrl, query, getDefaultSearchFilters(), 1);
            firstPageData = await fetchApiListByUrl(firstUrl, options.signal);
        }

        if (!firstPageData || !Array.isArray(firstPageData.list) || firstPageData.list.length === 0) {
            return [];
        }

        let allResults = mapApiResults(firstPageData.list, apiId, apiName);

        const pageBudget = Math.max(1, Number(options.maxPages || API_CONFIG.search.maxPages || 1));

        // 无关键词筛选时默认每源只抓 1 页，避免请求暴涨；调用方可通过 maxPages 显式放宽。
        if (hasKeyword) {
            const pageCount = Number(firstPageData.pagecount) || 1;
            const pagesToFetch = Math.min(pageCount - 1, pageBudget - 1);

            if (pagesToFetch > 0) {
                const paged = await fetchPagedResults(
                    apiBaseUrl,
                    apiId,
                    apiName,
                    query,
                    requestFilters,
                    2,
                    pagesToFetch + 1,
                    options.signal
                );
                if (paged.length > 0) allResults.push(...paged);
            }
        }

        // 关键词搜索：保持原逻辑，不应用筛选。
        if (hasKeyword) {
            return dedupeResults(allResults);
        }

        // 无关键词筛选：扩大候选集（每源多页）后再本地过滤，减少漏片。
        if (shouldUseFilterSearch) {
            const configuredNoKeywordPages = Math.max(1, Number(SEARCH_FILTERS_CONFIG?.noKeywordPages || 3));
            const noKeywordPages = Math.min(configuredNoKeywordPages, pageBudget);

            // 1) 继续抓筛选请求的后续页（若接口支持可直接提高命中率）
            if (noKeywordPages > 1) {
                const filteredPaged = await fetchPagedResults(
                    apiBaseUrl,
                    apiId,
                    apiName,
                    '',
                    requestFilters,
                    2,
                    noKeywordPages,
                    options.signal
                );
                if (filteredPaged.length > 0) allResults.push(...filteredPaged);
            }

            // 2) 再抓基础列表页（不带筛选参数）作为兜底候选，防止接口不认 class/year
            const basePaged = await fetchPagedResults(
                apiBaseUrl,
                apiId,
                apiName,
                '',
                getDefaultSearchFilters(),
                1,
                noKeywordPages,
                options.signal
            );
            if (basePaged.length > 0) allResults.push(...basePaged);
        }

        allResults = dedupeResults(allResults);
        return applySearchFiltersToResults(allResults, normalizedFilters);
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        console.warn(`API ${apiId} 搜索失败:`, error);
        throw error;
    }
}

window.applySearchFiltersToResults = applySearchFiltersToResults;
window.normalizeSearchFilters = normalizeSearchFilters;
window.hasActiveSearchFilters = hasActiveSearchFilters;

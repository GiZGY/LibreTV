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

async function fetchApiListByUrl(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl
            ? await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url))
            : PROXY_URL + encodeURIComponent(url);

        const response = await fetch(proxiedUrl, {
            headers: API_CONFIG.search.headers,
            signal: controller.signal
        });

        if (!response.ok) return null;

        const data = await response.json();
        if (!data || !Array.isArray(data.list)) return null;

        return data;
    } finally {
        clearTimeout(timeoutId);
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

async function fetchPagedResults(apiBaseUrl, apiId, apiName, query, filters, startPage, endPage) {
    const promises = [];
    for (let page = startPage; page <= endPage; page++) {
        promises.push((async () => {
            try {
                const pageUrl = buildSearchApiUrl(apiBaseUrl, query, filters, page);
                const pageData = await fetchApiListByUrl(pageUrl);
                if (!pageData || !Array.isArray(pageData.list) || pageData.list.length === 0) {
                    return [];
                }
                return mapApiResults(pageData.list, apiId, apiName);
            } catch (error) {
                console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                return [];
            }
        })());
    }
    const pageResults = await Promise.all(promises);
    return pageResults.flat();
}

async function searchByAPIAndKeyWord(apiId, query, filters) {
    try {
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
            if (!customApi) return [];

            apiName = customApi.name;
            apiBaseUrl = customApi.url;
        } else {
            if (!API_SITES[apiId]) return [];
            apiName = API_SITES[apiId].name;
            apiBaseUrl = API_SITES[apiId].api;
        }

        const normalizedFilters = normalizeSearchFilters(filters);
        const hasKeyword = !!String(query || '').trim();
        const shouldUseFilterSearch = !hasKeyword && hasActiveSearchFilters(normalizedFilters);
        const requestFilters = shouldUseFilterSearch ? normalizedFilters : getDefaultSearchFilters();

        let firstUrl = buildSearchApiUrl(apiBaseUrl, query, requestFilters, 1);
        let firstPageData = await fetchApiListByUrl(firstUrl);

        // 兜底：部分采集站对 class/year 参数支持差，筛选请求空结果时回退到基础列表再本地过滤。
        if ((!firstPageData || !Array.isArray(firstPageData.list) || firstPageData.list.length === 0) && shouldUseFilterSearch) {
            firstUrl = buildSearchApiUrl(apiBaseUrl, query, getDefaultSearchFilters(), 1);
            firstPageData = await fetchApiListByUrl(firstUrl);
        }

        if (!firstPageData || !Array.isArray(firstPageData.list) || firstPageData.list.length === 0) {
            return [];
        }

        let allResults = mapApiResults(firstPageData.list, apiId, apiName);

        // 无关键词筛选时每源只抓 1 页，避免请求暴涨。
        if (hasKeyword) {
            const pageCount = Number(firstPageData.pagecount) || 1;
            const pagesToFetch = Math.min(pageCount - 1, API_CONFIG.search.maxPages - 1);

            if (pagesToFetch > 0) {
                const paged = await fetchPagedResults(
                    apiBaseUrl,
                    apiId,
                    apiName,
                    query,
                    requestFilters,
                    2,
                    pagesToFetch + 1
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
            const noKeywordPages = Math.max(1, Number(SEARCH_FILTERS_CONFIG?.noKeywordPages || 3));

            // 1) 继续抓筛选请求的后续页（若接口支持可直接提高命中率）
            if (noKeywordPages > 1) {
                const filteredPaged = await fetchPagedResults(
                    apiBaseUrl,
                    apiId,
                    apiName,
                    '',
                    requestFilters,
                    2,
                    noKeywordPages
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
                noKeywordPages
            );
            if (basePaged.length > 0) allResults.push(...basePaged);
        }

        allResults = dedupeResults(allResults);
        return applySearchFiltersToResults(allResults, normalizedFilters);
    } catch (error) {
        console.warn(`API ${apiId} 搜索失败:`, error);
        return [];
    }
}

window.applySearchFiltersToResults = applySearchFiltersToResults;
window.normalizeSearchFilters = normalizeSearchFilters;
window.hasActiveSearchFilters = hasActiveSearchFilters;

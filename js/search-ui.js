let activeSearchRunId = 0;
const detailResponseCache = new Map();
const DETAIL_CACHE_TTL = 15 * 60 * 1000;

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sortSearchResults(results) {
    return (Array.isArray(results) ? results : []).sort((a, b) => {
        const nameCompare = (a.vod_name || '').localeCompare(b.vod_name || '');
        if (nameCompare !== 0) return nameCompare;
        return (a.source_name || '').localeCompare(b.source_name || '');
    });
}

function applyYellowContentFilter(results) {
    if (localStorage.getItem('yellowFilterEnabled') !== 'true') {
        return Array.isArray(results) ? results : [];
    }
    const banned = ['伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG', '网红主播', '色情片', '同性片', '福利视频', '福利片'];
    return (Array.isArray(results) ? results : []).filter(item => {
        const typeName = item.type_name || '';
        return !banned.some(keyword => typeName.includes(keyword));
    });
}

function buildSearchResultCards(results) {
    return (Array.isArray(results) ? results : []).map(item => {
        const safeId = item.vod_id ? item.vod_id.toString().replace(/[^\w-]/g, '') : '';
        const safeName = escapeHtml(item.vod_name || '');
        const sourceName = escapeHtml(item.source_name || '');
        const sourceCount = Number(item.source_count || 0);
        const sourceLabel = sourceCount > 1 ? `${sourceName} +${sourceCount - 1}` : sourceName;
        const sourceInfo = sourceName ? `<span class="bg-white/12 backdrop-blur-md text-xs px-2 py-0.5 rounded-full">${sourceLabel}</span>` : '';
        const sourceCode = escapeHtml(item.source_code || '');
        const apiUrlAttr = item.api_url ? `data-api-url="${escapeHtml(item.api_url)}"` : '';
        const hasCover = item.vod_pic && item.vod_pic.startsWith('http');
        const safePic = escapeHtml(item.vod_pic || '');
        const safeType = escapeHtml(item.type_name || '');
        const safeYear = escapeHtml(item.vod_year || '');
        const safeRemarks = escapeHtml(item.vod_remarks || '暂无介绍');

        return `
            <div class="card-hover bg-[#111] rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] h-full shadow-sm hover:shadow-md"
                 onclick="showDetails('${safeId}','${safeName}','${sourceCode}')" ${apiUrlAttr}>
                <div class="flex h-full">
                    ${hasCover ? `
                    <div class="relative flex-shrink-0 search-card-img-container">
                        <img src="${safePic}" alt="${safeName}"
                             class="h-full w-full object-cover transition-transform hover:scale-110"
                             onerror="this.onerror=null; this.src='https://via.placeholder.com/300x450?text=无封面'; this.classList.add('object-contain');"
                             loading="lazy">
                        <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                    </div>` : ''}

                    <div class="p-2 flex flex-col flex-grow">
                        <div class="flex-grow">
                            <h3 class="font-semibold mb-2 break-words line-clamp-2 ${hasCover ? '' : 'text-center'}" title="${safeName}">${safeName}</h3>
                            <div class="flex flex-wrap ${hasCover ? '' : 'justify-center'} gap-1 mb-2">
                                ${safeType ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">${safeType}</span>` : ''}
                                ${safeYear ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300">${safeYear}</span>` : ''}
                            </div>
                            <p class="text-gray-400 line-clamp-2 overflow-hidden ${hasCover ? '' : 'text-center'} mb-2">${safeRemarks}</p>
                        </div>

                        <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-800">
                            ${sourceInfo ? `<div>${sourceInfo}</div>` : '<div></div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderNoSearchResults(resultsDiv, completed, total) {
    const progress = total ? `<p class="mt-1 text-xs text-gray-600">已完成 ${completed}/${total} 个数据源</p>` : '';
    resultsDiv.innerHTML = `
        <div class="col-span-full text-center py-16">
            <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="mt-2 text-lg font-medium text-gray-400">正在搜索可用资源...</h3>
            <p class="mt-1 text-sm text-gray-500">快源会优先展示，慢源会在后台继续返回</p>
            ${progress}
        </div>
    `;
}

function renderSearchResults(results, progress = {}) {
    const resultsDiv = document.getElementById('results');
    const searchResultsCount = document.getElementById('searchResultsCount');
    if (!resultsDiv) return;

    const visibleResults = sortSearchResults(applyYellowContentFilter(results));
    if (searchResultsCount) {
        const suffix = progress.total && progress.completed < progress.total ? ` (${progress.completed}/${progress.total}源)` : '';
        searchResultsCount.textContent = `${visibleResults.length}${suffix}`;
    }

    if (visibleResults.length === 0) {
        renderNoSearchResults(resultsDiv, progress.completed || 0, progress.total || 0);
        return;
    }

    resultsDiv.innerHTML = buildSearchResultCards(visibleResults);
}

function prepareSearchResultsArea(query) {
    document.getElementById('searchArea').classList.remove('flex-1');
    document.getElementById('searchArea').classList.add('mb-8');
    document.getElementById('resultsArea').classList.remove('hidden');

    const doubanArea = document.getElementById('doubanArea');
    if (doubanArea) {
        doubanArea.classList.add('hidden');
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        window.history.pushState(
            { search: query },
            `搜索: ${query} - OpenStream`,
            `/s=${encodedQuery}`
        );
        document.title = `搜索: ${query} - OpenStream`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

async function fetchVideoDetailWithCache(id, apiParams) {
    const cacheKey = `${id}|${apiParams}`;
    const cached = detailResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.time < DETAIL_CACHE_TTL) {
        return cached.data;
    }

    const response = await fetch(`/api/detail?id=${encodeURIComponent(id)}${apiParams}`);
    const data = await response.json();
    if (data && data.code !== 400) {
        detailResponseCache.set(cacheKey, { time: Date.now(), data });
    }
    return data;
}

async function search() {
    try {
        if (window.ensurePasswordProtection) {
            window.ensurePasswordProtection();
        } else if (window.isPasswordProtected && window.isPasswordVerified) {
            if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                showPasswordModal && showPasswordModal();
                return;
            }
        }
    } catch (error) {
        console.warn('Password protection check failed:', error.message);
        return;
    }

    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('请输入搜索内容', 'info');
        return;
    }

    if (selectedAPIs.length === 0) {
        showToast('请至少选择一个API源', 'warning');
        return;
    }

    try {
        saveSearchHistory(query);

        const searchRunId = ++activeSearchRunId;
        let allResults = [];
        let completedSources = 0;
        const totalSources = selectedAPIs.length;
        prepareSearchResultsArea(query);
        renderSearchResults(allResults, { completed: completedSources, total: totalSources });

        if (window.OpenStreamStreamingSearch?.runStreamingSearch) {
            const streamResult = await window.OpenStreamStreamingSearch.runStreamingSearch({
                sources: selectedAPIs,
                query,
                filters: getDefaultSearchFilters(),
                isActive: () => searchRunId === activeSearchRunId,
                onUpdate: (payload) => {
                    if (searchRunId !== activeSearchRunId) return;
                    allResults = payload.results || [];
                    completedSources = payload.completed || 0;
                    renderSearchResults(allResults, {
                        completed: completedSources,
                        total: payload.total || totalSources
                    });
                },
                onDone: (payload) => {
                    if (searchRunId !== activeSearchRunId) return;
                    allResults = payload.results || [];
                    completedSources = payload.completed || 0;
                }
            });
            if (searchRunId !== activeSearchRunId) return;
            allResults = streamResult.results || allResults;
        } else {
            const searchWorker = async (apiId) => {
                try {
                    const results = await searchByAPIAndKeyWord(apiId, query, getDefaultSearchFilters());
                    if (Array.isArray(results) && results.length > 0) {
                        allResults = allResults.concat(results);
                    }
                } catch (error) {
                    console.warn(`API ${apiId} 搜索失败:`, error);
                } finally {
                    completedSources += 1;
                    renderSearchResults(allResults, { completed: completedSources, total: totalSources });
                }
            };

            if (typeof runSearchQueue === 'function') {
                await runSearchQueue(selectedAPIs, API_CONFIG.search.sourceConcurrency || 4, searchWorker);
            } else {
                await Promise.allSettled(selectedAPIs.map(searchWorker));
            }
        }

        const finalResults = sortSearchResults(applyYellowContentFilter(allResults));
        if (finalResults.length === 0) {
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = `
                <div class="col-span-full text-center py-16">
                    <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 class="mt-2 text-lg font-medium text-gray-400">没有找到匹配的结果</h3>
                    <p class="mt-1 text-sm text-gray-500">请尝试其他关键词或更换数据源</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('搜索错误:', error);
        if (error.name === 'AbortError') {
            showToast('搜索请求超时，请检查网络连接', 'error');
        } else {
            showToast('搜索请求失败，请稍后重试', 'error');
        }
    } finally {
        hideLoading();
    }
}

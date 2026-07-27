let activeSearchRunId = 0;
let activeSearchAbortController = null;
let pendingSearchRender = null;
let searchRenderHandle = 0;
let lastSearchRenderSignature = '';
const detailResponseCache = new Map();
const detailResponseInflight = new Map();
const DETAIL_CACHE_TTL = 15 * 60 * 1000;
const DETAIL_CACHE_LIMIT = 80;
const boundSearchResultContainers = new WeakSet();
const POSTER_PLACEHOLDER_URL = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#202020"/>
      <stop offset="1" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" rx="24" fill="url(#g)"/>
  <rect x="28" y="34" width="244" height="382" rx="18" fill="none" stroke="#ff7a1a" stroke-opacity=".45" stroke-width="3"/>
  <text x="150" y="214" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="800">OPEN</text>
  <text x="150" y="252" text-anchor="middle" fill="#ff7a1a" font-family="Arial, sans-serif" font-size="30" font-weight="800">STREAM</text>
  <text x="150" y="292" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="18">暂无封面</text>
</svg>`);

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sortSearchResults(results) {
    return (Array.isArray(results) ? results.slice() : []).sort((a, b) => {
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
        const encodedId = escapeHtml(encodeURIComponent(String(item.vod_id || '')));
        const encodedName = escapeHtml(encodeURIComponent(String(item.vod_name || '')));
        const encodedSourceCode = escapeHtml(encodeURIComponent(String(item.source_code || '')));
        const safeName = escapeHtml(item.vod_name || '');
        const rawSourceName = String(item.source_name || '');
        const sourceName = escapeHtml(rawSourceName);
        const sourceCount = Number(item.source_count || 0);
        const rawSourceLabel = sourceCount > 1 ? `${rawSourceName} +${sourceCount - 1}` : rawSourceName;
        const sourceLabel = escapeHtml(rawSourceLabel);
        const apiUrlAttr = item.api_url ? `data-api-url="${escapeHtml(item.api_url)}"` : '';
        const hasCover = item.vod_pic && item.vod_pic.startsWith('http');
        const safePic = escapeHtml(hasCover ? item.vod_pic : POSTER_PLACEHOLDER_URL);
        const safeType = escapeHtml(item.type_name || '');
        const safeYear = escapeHtml(item.vod_year || '');
        const safeRemarks = escapeHtml(item.vod_remarks || '暂无介绍');
        const resultKey = encodeURIComponent(item.aggregate_key || `${item.source_code}|${item.vod_id}`);
        const contentSignature = encodeURIComponent([
            item.source_code,
            item.vod_id,
            item.vod_name,
            item.vod_pic,
            item.type_name,
            item.vod_year,
            item.vod_remarks
        ].join('|'));

        return `
            <div class="card-hover search-result-card bg-[#111] rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] h-full shadow-sm hover:shadow-md"
                 data-result-key="${resultKey}" data-content-signature="${contentSignature}" data-source-label="${sourceLabel}"
                 data-vod-id="${encodedId}" data-vod-name="${encodedName}" data-source-code="${encodedSourceCode}"
                 role="button" tabindex="0" ${apiUrlAttr}>
                <div class="flex h-full">
                    <div class="relative flex-shrink-0 search-card-img-container">
                        <img src="${safePic}" alt="${safeName}"
                             class="h-full w-full object-cover transition-transform hover:scale-110"
                             data-search-poster
                             loading="lazy" decoding="async">
                        <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                    </div>

                    <div class="p-2 flex flex-col flex-grow">
                        <div class="flex-grow">
                            <h3 class="font-semibold mb-2 break-words line-clamp-2" title="${safeName}">${safeName}</h3>
                            <div class="flex flex-wrap gap-1 mb-2">
                                ${safeType ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">${safeType}</span>` : ''}
                                ${safeYear ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300">${safeYear}</span>` : ''}
                            </div>
                            <p class="text-gray-400 line-clamp-2 overflow-hidden mb-2">${safeRemarks}</p>
                        </div>

                        <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-800">
                            ${sourceName ? `<div><span class="search-source-badge bg-white/12 backdrop-blur-md text-xs px-2 py-0.5 rounded-full">${sourceLabel}</span></div>` : '<div></div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function decodeSearchCardValue(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch (_) {
        return '';
    }
}

function ensureSearchResultEvents(resultsDiv) {
    if (boundSearchResultContainers.has(resultsDiv)) return;
    boundSearchResultContainers.add(resultsDiv);

    const openCard = (card) => {
        if (!card) return;
        showDetails(
            decodeSearchCardValue(card.dataset.vodId),
            decodeSearchCardValue(card.dataset.vodName),
            decodeSearchCardValue(card.dataset.sourceCode)
        );
    };

    resultsDiv.addEventListener('click', (event) => {
        openCard(event.target.closest('.search-result-card'));
    });
    resultsDiv.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        const card = event.target.closest('.search-result-card');
        if (!card) return;
        event.preventDefault();
        openCard(card);
    });
    resultsDiv.addEventListener('error', (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.matches('[data-search-poster]')) return;
        if (image.src === POSTER_PLACEHOLDER_URL) return;
        image.src = POSTER_PLACEHOLDER_URL;
        image.classList.add('object-contain');
    }, true);
}

function renderNoSearchResults(resultsDiv, completed, total) {
    const existing = resultsDiv.querySelector('.search-empty-state');
    if (existing) {
        const progress = existing.querySelector('[data-search-progress]');
        if (progress) {
            progress.textContent = total ? `已完成 ${completed}/${total} 个数据源` : '';
        }
        return;
    }
    resultsDiv.innerHTML = `
        <div class="search-empty-state col-span-full text-center py-16">
            <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="mt-2 text-lg font-medium text-gray-400">正在搜索可用资源...</h3>
            <p class="mt-1 text-sm text-gray-500">快源会优先展示，慢源会在后台继续返回</p>
            <p class="mt-1 text-xs text-gray-600" data-search-progress>${total ? `已完成 ${completed}/${total} 个数据源` : ''}</p>
        </div>
    `;
}

function reconcileSearchResultCards(resultsDiv, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const desired = Array.from(template.content.children);
    Array.from(resultsDiv.children)
        .filter((node) => !node.dataset?.resultKey)
        .forEach((node) => node.remove());
    const existing = new Map(
        Array.from(resultsDiv.children)
            .filter((node) => node.dataset?.resultKey)
            .map((node) => [node.dataset.resultKey, node])
    );
    let cursor = resultsDiv.firstElementChild;

    desired.forEach((nextNode) => {
        const key = nextNode.dataset.resultKey;
        const current = existing.get(key);
        let node = nextNode;
        if (current) {
            node = current;
            if (current.dataset.contentSignature === nextNode.dataset.contentSignature) {
                const badge = node.querySelector('.search-source-badge');
                if (badge) badge.textContent = nextNode.dataset.sourceLabel || '';
            } else {
                const currentImage = current.querySelector('img');
                const nextImage = nextNode.querySelector('img');
                if (
                    currentImage &&
                    nextImage &&
                    currentImage.getAttribute('src') === nextImage.getAttribute('src')
                ) {
                    nextImage.replaceWith(currentImage);
                }

                Array.from(current.attributes).forEach(({ name }) => {
                    if (!nextNode.hasAttribute(name)) current.removeAttribute(name);
                });
                Array.from(nextNode.attributes).forEach(({ name, value }) => {
                    current.setAttribute(name, value);
                });
                current.replaceChildren(...Array.from(nextNode.childNodes));
            }
            existing.delete(key);
        }

        if (node !== cursor) {
            resultsDiv.insertBefore(node, cursor);
        }
        cursor = node.nextElementSibling;
    });

    existing.forEach((node) => node.remove());
}

function renderSearchResults(results, progress = {}) {
    const resultsDiv = document.getElementById('results');
    const searchResultsCount = document.getElementById('searchResultsCount');
    if (!resultsDiv) return;
    ensureSearchResultEvents(resultsDiv);

    const visibleResults = sortSearchResults(applyYellowContentFilter(results));
    if (searchResultsCount) {
        const suffix = progress.total && progress.completed < progress.total ? ` (${progress.completed}/${progress.total}源)` : '';
        searchResultsCount.textContent = `${visibleResults.length}${suffix}`;
    }

    if (visibleResults.length === 0) {
        lastSearchRenderSignature = '';
        renderNoSearchResults(resultsDiv, progress.completed || 0, progress.total || 0);
        return;
    }

    const signature = visibleResults.map((item) => (
        `${item.aggregate_key || `${item.source_code}|${item.vod_id}`}|${item.source_count || 1}|${item.vod_pic || ''}`
    )).join('::');
    if (signature === lastSearchRenderSignature) return;
    lastSearchRenderSignature = signature;
    reconcileSearchResultCards(resultsDiv, buildSearchResultCards(visibleResults));
}

function scheduleSearchResultsRender(results, progress = {}) {
    pendingSearchRender = { results, progress };
    if (searchRenderHandle) return;
    const schedule = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    searchRenderHandle = schedule(() => {
        searchRenderHandle = 0;
        const pending = pendingSearchRender;
        pendingSearchRender = null;
        if (pending) renderSearchResults(pending.results, pending.progress);
    });
}

function flushScheduledSearchResults() {
    if (!pendingSearchRender) return;
    const pending = pendingSearchRender;
    pendingSearchRender = null;
    renderSearchResults(pending.results, pending.progress);
}

function cancelActiveSearch() {
    activeSearchRunId += 1;
    activeSearchAbortController?.abort();
    activeSearchAbortController = null;
    pendingSearchRender = null;
}

window.cancelActiveSearch = cancelActiveSearch;
window.isOpenStreamSearchActive = () => Boolean(activeSearchAbortController);

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

async function fetchVideoDetailWithCache(id, apiParams, options = {}) {
    const cacheKey = `${id}|${apiParams}`;
    const cached = detailResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.time < DETAIL_CACHE_TTL) {
        detailResponseCache.delete(cacheKey);
        detailResponseCache.set(cacheKey, cached);
        return cached.data;
    }
    detailResponseCache.delete(cacheKey);
    if (!options.signal && detailResponseInflight.has(cacheKey)) {
        return detailResponseInflight.get(cacheKey);
    }

    const pending = (async () => {
        const response = await fetch(`/api/detail?id=${encodeURIComponent(id)}${apiParams}`, {
            signal: options.signal
        });
        if (!response.ok) throw new Error(`详情请求失败 (${response.status})`);
        const data = await response.json();
        if (data && data.code !== 400) {
            detailResponseCache.set(cacheKey, { time: Date.now(), data });
            while (detailResponseCache.size > DETAIL_CACHE_LIMIT) {
                detailResponseCache.delete(detailResponseCache.keys().next().value);
            }
        }
        return data;
    })();

    if (!options.signal) {
        detailResponseInflight.set(cacheKey, pending);
        void pending.then(
            () => detailResponseInflight.delete(cacheKey),
            () => detailResponseInflight.delete(cacheKey)
        );
    }
    return pending;
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

    let searchController = null;
    try {
        window.cancelPassiveQualitySampling?.({ reschedule: true });
        saveSearchHistory(query);

        activeSearchAbortController?.abort();
        activeSearchAbortController = new AbortController();
        searchController = activeSearchAbortController;
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
                signal: searchController.signal,
                onUpdate: (payload) => {
                    if (searchRunId !== activeSearchRunId) return;
                    allResults = payload.results || [];
                    completedSources = payload.completed || 0;
                    scheduleSearchResultsRender(allResults, {
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
                    const results = await searchByAPIAndKeyWord(
                        apiId,
                        query,
                        getDefaultSearchFilters(),
                        { signal: searchController.signal }
                    );
                    if (Array.isArray(results) && results.length > 0) {
                        allResults = allResults.concat(results);
                    }
                } catch (error) {
                    console.warn(`API ${apiId} 搜索失败:`, error);
                } finally {
                    completedSources += 1;
                    scheduleSearchResultsRender(allResults, { completed: completedSources, total: totalSources });
                }
            };

            if (typeof runSearchQueue === 'function') {
                await runSearchQueue(selectedAPIs, API_CONFIG.search.sourceConcurrency || 4, searchWorker);
            } else {
                await Promise.allSettled(selectedAPIs.map(searchWorker));
            }
        }

        const finalResults = sortSearchResults(applyYellowContentFilter(allResults));
        flushScheduledSearchResults();
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
        if (error?.name === 'AbortError') return;
        console.error('搜索错误:', error);
        showToast('搜索请求失败，请稍后重试', 'error');
    } finally {
        if (activeSearchAbortController === searchController) {
            activeSearchAbortController = null;
        }
        window.schedulePassiveQualitySampling?.(30_000);
        hideLoading();
    }
}

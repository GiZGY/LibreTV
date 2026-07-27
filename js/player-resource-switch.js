// 播放页资源切换：独立于 player.js，避免播放器主文件继续膨胀。
const RESOURCE_SWITCH_CACHE_TTL = 5 * 60 * 1000;
const RESOURCE_SWITCH_CACHE_LIMIT = 80;
const RESOURCE_SWITCH_SEARCH_TIMEOUT = 8_000;
const RESOURCE_SWITCH_SPEED_TIMEOUT = 7_000;
const resourceSwitchSearchCache = new Map();
const resourceSwitchDetailCache = new Map();
const resourceSwitchSpeedCache = new Map();
const resourceSwitchSearchInflight = new Map();
const resourceSwitchDetailInflight = new Map();
const resourceSwitchContainersBound = new WeakSet();
let activeResourceSwitchRun = null;
let resourceSwitchRunId = 0;

function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex, 10);
    if (Number.isNaN(index) || index < 0 || index >= customAPIs.length) return null;
    return customAPIs[index];
}

function getResourceSwitchConfig() {
    return PLAYER_CONFIG.resourceSwitch || {
        searchConcurrency: 3,
        speedConcurrency: 2,
        cacheTtl: RESOURCE_SWITCH_CACHE_TTL
    };
}

function getCachedValue(cache, key) {
    const item = cache.get(key);
    const ttl = getResourceSwitchConfig().cacheTtl || RESOURCE_SWITCH_CACHE_TTL;
    if (!item || Date.now() - item.time > ttl) {
        cache.delete(key);
        return null;
    }
    return item.value;
}

function setCachedValue(cache, key, value) {
    cache.delete(key);
    cache.set(key, { time: Date.now(), value });
    while (cache.size > RESOURCE_SWITCH_CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
    return value;
}

function runCachedResourceRequest(cache, inflight, key, request, options = {}) {
    const cached = getCachedValue(cache, key);
    if (cached) return Promise.resolve(cached);

    // A modal run owns its AbortSignal. Do not share an older cancellable request
    // with a newer run, otherwise cancelling the old modal also cancels the new one.
    if (options.signal) {
        return Promise.resolve().then(request).then((value) => setCachedValue(cache, key, value));
    }
    if (inflight.has(key)) return inflight.get(key);

    const pending = Promise.resolve()
        .then(request)
        .then((value) => setCachedValue(cache, key, value))
        .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
}

function createResourceAbortError(message = '请求已取消') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

async function withResourceTimeout(factory, timeoutMs, parentSignal) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason || createResourceAbortError());
    if (parentSignal?.aborted) throw createResourceAbortError();
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
        return await factory(controller.signal);
    } catch (error) {
        if (parentSignal?.aborted) throw createResourceAbortError();
        if (controller.signal.aborted) {
            const timeoutError = new Error('超时');
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', abortFromParent);
    }
}

async function runResourceQueue(items, concurrency, worker, signal) {
    const input = Array.isArray(items) ? items : [];
    const results = new Array(input.length);
    let nextIndex = 0;
    const limit = Math.max(1, Math.min(Number(concurrency) || 1, input.length || 1));
    const workers = Array.from({ length: Math.min(limit, input.length) }, async () => {
        while (nextIndex < input.length && !signal?.aborted) {
            const currentIndex = nextIndex++;
            try {
                results[currentIndex] = await worker(input[currentIndex], currentIndex);
            } catch (error) {
                if (error?.name !== 'AbortError') throw error;
            }
        }
    });
    await Promise.allSettled(workers);
    return results;
}

function buildResourceApiParams(sourceKey) {
    if (sourceKey.startsWith('custom_')) {
        const customIndex = sourceKey.replace('custom_', '');
        const customApi = getCustomApiInfo(customIndex);
        if (!customApi) return null;
        const base = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
        return customApi.detail
            ? base + '&customDetail=' + encodeURIComponent(customApi.detail)
            : base;
    }
    return '&source=' + encodeURIComponent(sourceKey);
}

async function fetchResourceDetail(sourceKey, vodId, options = {}) {
    const apiParams = buildResourceApiParams(sourceKey);
    if (!apiParams) throw new Error('API配置无效');

    const cacheKey = `${sourceKey}|${vodId}|${apiParams}`;
    return runCachedResourceRequest(resourceSwitchDetailCache, resourceSwitchDetailInflight, cacheKey, async () => {
        const adapterResult = window.OpenStreamSourceAdapter?.detail
            ? await window.OpenStreamSourceAdapter.detail(sourceKey, vodId, { signal: options.signal })
            : null;

        let data;
        let episodes;
        if (adapterResult) {
            if (adapterResult.status !== 'ready') throw new Error(adapterResult.status || '获取失败');
            data = adapterResult.data || {};
            episodes = adapterResult.episodes;
        } else {
            const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}`, {
                signal: options.signal
            });
            if (!response.ok) throw new Error('获取失败');
            data = await response.json();
            episodes = data?.episodes;
        }

        if (!Array.isArray(episodes) || episodes.length === 0) {
            throw new Error('无播放源');
        }
        return { ...data, episodes };
    }, options);
}

async function searchResourceOption(opt, title, options = {}) {
    const cacheKey = `${opt.key}|${title}`;
    return runCachedResourceRequest(resourceSwitchSearchCache, resourceSwitchSearchInflight, cacheKey, async () => {
        const adapterResult = window.OpenStreamSourceAdapter?.search
            ? await window.OpenStreamSourceAdapter.search(
                opt.key,
                title,
                getDefaultSearchFilters(),
                { maxPages: 1, signal: options.signal }
            )
            : { status: 'ready', list: await searchByAPIAndKeyWord(opt.key, title, {}, { maxPages: 1, signal: options.signal }) };
        if (adapterResult.status === 'login_required' || adapterResult.status === 'unsupported') return null;

        const queryResult = adapterResult.list;
        if (!Array.isArray(queryResult) || queryResult.length === 0) return null;
        return queryResult.find((result) => result.vod_name === title) || queryResult[0];
    }, options);
}

async function resolveResourceEpisode(sourceKey, vodId, episodes, index, options = {}) {
    const targetIndex = index >= 0 && index < episodes.length ? index : 0;
    const resolved = await window.OpenStreamPlayerEpisodes.resolveEpisode(
        episodes[targetIndex],
        targetIndex,
        { sourceKey, videoId: vodId },
        { signal: options.signal }
    );
    if (resolved.status !== 'ready' || !resolved.url) {
        throw new Error(resolved.status || '播放地址无效');
    }
    return { targetIndex, targetUrl: resolved.url, descriptor: resolved };
}

// Detail must be resolved first: bridge play responses do not carry episode lists.
async function testVideoSourceSpeed(sourceKey, vodId, options = {}) {
    const cacheKey = `${sourceKey}|${vodId}`;
    const cached = getCachedValue(resourceSwitchSpeedCache, cacheKey);
    if (cached) return cached;

    try {
        const startTime = performance.now();
        const detail = await fetchResourceDetail(sourceKey, vodId, { signal: options.signal });
        const resolved = await resolveResourceEpisode(sourceKey, vodId, detail.episodes, 0, { signal: options.signal });

        try {
            await fetch(resolved.targetUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: options.signal
            });
        } catch (error) {
            if (options.signal?.aborted) throw error;
            // 播放链接 HEAD 经常被跨域或源站限制；详情+播放解析耗时仍可用于排序。
        }

        return setCachedValue(resourceSwitchSpeedCache, cacheKey, {
            speed: Math.round(performance.now() - startTime),
            episodes: detail.episodes.length,
            error: null
        });
    } catch (error) {
        if (options.signal?.aborted || error?.name === 'AbortError') throw createResourceAbortError();
        return setCachedValue(resourceSwitchSpeedCache, cacheKey, {
            speed: -1,
            error: error?.name === 'TimeoutError' ? '超时' : (error.message || '测试失败')
        });
    }
}

function formatSpeedDisplay(speedResult) {
    if (!speedResult || speedResult.pending) {
        return '<span class="speed-indicator">检测中...</span>';
    }
    if (speedResult.speed === -1) {
        return `<span class="speed-indicator error">不可用 · ${escapeResourceHtml(speedResult.error || '检测失败')}</span>`;
    }

    const speed = speedResult.speed;
    let className = 'speed-indicator good';
    if (speed > 2000) className = 'speed-indicator poor';
    else if (speed > 1000) className = 'speed-indicator medium';
    return `<span class="${className}">${speed}ms</span>`;
}

function getResourceOptions() {
    const options = selectedAPIs.map((curr) => {
        if (API_SITES[curr]) return { key: curr, name: API_SITES[curr].name };
        const customIndex = parseInt(curr.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            return { key: curr, name: customAPIs[customIndex].name || '自定义资源' };
        }
        return { key: curr, name: '未知资源' };
    });

    const plan = window.OpenStreamSourceHealth?.getSearchPlan?.(options.map((item) => item.key));
    if (!Array.isArray(plan) || plan.length === 0) return options;

    const rank = new Map(plan.map((item, index) => [item.sourceKey, index]));
    return options
        .filter((item) => rank.has(item.key))
        .sort((a, b) => rank.get(a.key) - rank.get(b.key));
}

function escapeResourceHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function encodeInlineResourceArg(value) {
    return encodeURIComponent(String(value || '')).replace(/'/g, '%27');
}

function renderSwitchResourceCards({ allResults, speedResults, resourceOptions, currentSourceCode, currentVideoId }) {
    const sortedResults = Object.entries(allResults).sort(([keyA, resultA], [keyB, resultB]) => {
        const isCurrentA = String(keyA) === String(currentSourceCode) && String(resultA.vod_id) === String(currentVideoId);
        const isCurrentB = String(keyB) === String(currentSourceCode) && String(resultB.vod_id) === String(currentVideoId);
        if (isCurrentA !== isCurrentB) return isCurrentA ? -1 : 1;

        const speedA = speedResults[keyA];
        const speedB = speedResults[keyB];
        if (!speedA || speedA.pending) return (!speedB || speedB.pending) ? 0 : 1;
        if (!speedB || speedB.pending) return -1;
        if (speedA.speed === -1) return speedB.speed === -1 ? 0 : 1;
        if (speedB.speed === -1) return -1;
        return speedA.speed - speedB.speed;
    });

    if (sortedResults.length === 0) {
        return '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">暂未找到可切换资源</div>';
    }

    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">';
    for (const [sourceKey, result] of sortedResults) {
        if (!result) continue;
        const isCurrentSource = String(sourceKey) === String(currentSourceCode) && String(result.vod_id) === String(currentVideoId);
        const sourceName = resourceOptions.find((option) => option.key === sourceKey)?.name || '未知资源';
        const speedResult = speedResults[sourceKey] || { pending: true };
        const sourceArg = escapeResourceHtml(encodeInlineResourceArg(sourceKey));
        const videoArg = escapeResourceHtml(encodeInlineResourceArg(result.vod_id));

        html += `
            <div class="relative group ${isCurrentSource ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}"
                 ${!isCurrentSource ? `role="button" tabindex="0" data-resource-switch data-resource-source="${sourceArg}" data-resource-video="${videoArg}"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    <img src="${escapeResourceHtml(result.vod_pic)}"
                         alt="${escapeResourceHtml(result.vod_name)}"
                         class="w-full h-full object-cover"
                         loading="lazy"
                         decoding="async"
                         data-resource-poster>
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${formatSpeedDisplay(speedResult)}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${escapeResourceHtml(result.vod_name)}</div>
                    <div class="text-[10px] text-gray-400 truncate">${escapeResourceHtml(sourceName)}</div>
                    <div class="text-[10px] text-gray-500 mt-1">${speedResult.episodes ? `${speedResult.episodes}集` : ''}</div>
                </div>
                ${isCurrentSource ? '<div class="absolute inset-0 flex items-center justify-center"><div class="bg-orange-600 bg-opacity-75 rounded-lg px-2 py-0.5 text-xs text-white font-medium">当前播放</div></div>' : ''}
            </div>
        `;
    }
    html += '</div>';
    return html;
}

function bindResourceSwitchInteractions(container) {
    if (!container || resourceSwitchContainersBound.has(container)) return;
    resourceSwitchContainersBound.add(container);

    const activate = (target) => {
        const card = target.closest?.('[data-resource-switch]');
        if (!card || !container.contains(card)) return;
        try {
            switchToResource(
                decodeURIComponent(card.dataset.resourceSource || ''),
                decodeURIComponent(card.dataset.resourceVideo || '')
            );
        } catch {
            window.showToast?.('线路信息无效，请重新搜索', 'error');
        }
    };

    container.addEventListener('click', (event) => activate(event.target));
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!event.target.closest?.('[data-resource-switch]')) return;
        event.preventDefault();
        activate(event.target);
    });
    container.addEventListener('error', (event) => {
        const image = event.target.closest?.('img[data-resource-poster]');
        if (!image || image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = 'image/nomedia.png?v=551423ac211e';
    }, true);
}

function cancelPlayerResourceSwitch() {
    if (!activeResourceSwitchRun) return;
    activeResourceSwitchRun.controller.abort(createResourceAbortError());
    activeResourceSwitchRun = null;
}

function isResourceSwitchRunActive(run) {
    return !!run && activeResourceSwitchRun?.id === run.id && !run.controller.signal.aborted;
}

function renderResourceSwitchProgress(run, state) {
    if (!isResourceSwitchRunActive(run)) return;
    const status = state.searching
        ? `正在查找可切换资源 ${state.searched}/${state.total}`
        : `正在验证播放线路 ${state.tested}/${state.found}`;
    run.modalContent.innerHTML = `
        <div class="px-4 pt-2 text-sm text-gray-400">${status}</div>
        ${renderSwitchResourceCards(state)}
    `;
    bindResourceSwitchInteractions(run.modalContent);
}

async function showSwitchResourceModal() {
    cancelPlayerResourceSwitch();
    const urlParams = new URLSearchParams(window.location.search);
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const run = {
        id: ++resourceSwitchRunId,
        controller: new AbortController(),
        modalContent
    };
    activeResourceSwitchRun = run;

    modalTitle.textContent = currentVideoTitle;
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;">正在查找可切换资源...</div>';
    modal.classList.remove('hidden');

    const config = getResourceSwitchConfig();
    const resourceOptions = getResourceOptions();
    const state = {
        allResults: {},
        speedResults: {},
        resourceOptions,
        currentSourceCode: urlParams.get('source'),
        currentVideoId: urlParams.get('id'),
        searched: 0,
        tested: 0,
        total: resourceOptions.length,
        found: 0,
        searching: true
    };

    await runResourceQueue(resourceOptions, config.searchConcurrency || 3, async (opt) => {
        try {
            const result = await withResourceTimeout(
                (signal) => searchResourceOption(opt, currentVideoTitle, { signal }),
                config.searchTimeout || RESOURCE_SWITCH_SEARCH_TIMEOUT,
                run.controller.signal
            );
            if (result && isResourceSwitchRunActive(run)) {
                state.allResults[opt.key] = result;
                state.speedResults[opt.key] = { pending: true };
                state.found = Object.keys(state.allResults).length;
            }
        } catch (error) {
            if (error?.name !== 'AbortError') console.warn(`资源 ${opt.key} 搜索失败:`, error.message || error);
        } finally {
            state.searched += 1;
            renderResourceSwitchProgress(run, state);
        }
    }, run.controller.signal);

    if (!isResourceSwitchRunActive(run)) return false;
    state.searching = false;
    const resultEntries = Object.entries(state.allResults);
    renderResourceSwitchProgress(run, state);

    await runResourceQueue(resultEntries, config.speedConcurrency || 2, async ([sourceKey, result]) => {
        try {
            state.speedResults[sourceKey] = await withResourceTimeout(
                (signal) => testVideoSourceSpeed(sourceKey, result.vod_id, { signal }),
                config.speedTimeout || RESOURCE_SWITCH_SPEED_TIMEOUT,
                run.controller.signal
            );
        } catch (error) {
            if (error?.name !== 'AbortError') {
                state.speedResults[sourceKey] = {
                    speed: -1,
                    error: error?.name === 'TimeoutError' ? '超时' : '测试失败'
                };
            }
        } finally {
            state.tested += 1;
            renderResourceSwitchProgress(run, state);
        }
    }, run.controller.signal);

    if (!isResourceSwitchRunActive(run)) return false;
    renderResourceSwitchProgress(run, state);
    return true;
}

async function switchToResource(sourceKey, vodId) {
    cancelPlayerResourceSwitch();
    document.getElementById('modal').classList.add('hidden');
    showLoading();
    try {
        const data = await fetchResourceDetail(sourceKey, vodId);
        const resolved = await resolveResourceEpisode(sourceKey, vodId, data.episodes, currentEpisodeIndex);
        const watchUrl = `player.html?id=${encodeURIComponent(vodId)}&source=${encodeURIComponent(sourceKey)}&url=${encodeURIComponent(resolved.targetUrl)}&index=${resolved.targetIndex}&title=${encodeURIComponent(currentVideoTitle)}`;

        localStorage.setItem('currentVideoTitle', data.vod_name || data.videoInfo?.title || currentVideoTitle || '未知视频');
        localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
        localStorage.setItem('currentEpisodeIndex', resolved.targetIndex);
        localStorage.setItem('currentSourceCode', sourceKey);
        localStorage.setItem('lastPlayTime', Date.now());
        window.location.href = watchUrl;
    } catch (error) {
        console.error('切换资源失败:', error);
        showToast('切换资源失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

function getAutoSwitchGuardKey() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || currentVideoTitle || 'unknown';
    const source = params.get('source') || '';
    return `autoSwitch:${id}:${source}:${currentEpisodeIndex}`;
}

async function findPlayableFallbackResource(reason = '') {
    const params = new URLSearchParams(window.location.search);
    const currentSourceCode = params.get('source') || localStorage.getItem('currentSourceCode') || '';
    const currentVideoId = params.get('id') || '';
    const options = getResourceOptions().filter((item) => item.key !== currentSourceCode);

    for (const opt of options) {
        try {
            const result = await searchResourceOption(opt, currentVideoTitle);
            if (!result?.vod_id) continue;
            const data = await fetchResourceDetail(opt.key, result.vod_id);
            const resolved = await resolveResourceEpisode(opt.key, result.vod_id, data.episodes, currentEpisodeIndex);
            return {
                sourceKey: opt.key,
                vodId: result.vod_id,
                targetIndex: resolved.targetIndex,
                targetUrl: resolved.targetUrl,
                data,
                reason,
                previousSource: currentSourceCode,
                previousVideoId: currentVideoId
            };
        } catch (error) {
            console.warn(`自动换线候选 ${opt.key} 不可用:`, error.message || error);
        }
    }
    return null;
}

async function autoSwitchToBestResource(reason = '') {
    const guardKey = getAutoSwitchGuardKey();
    if (sessionStorage.getItem(guardKey) === '1') return false;
    sessionStorage.setItem(guardKey, '1');

    const fallback = await findPlayableFallbackResource(reason);
    if (!fallback) return false;

    try {
        const currentPosition = typeof art !== 'undefined' && art?.video ? art.video.currentTime || 0 : 0;
        localStorage.setItem('currentVideoTitle', fallback.data?.videoInfo?.title || fallback.data?.vod_name || currentVideoTitle || '未知视频');
        localStorage.setItem('currentEpisodes', JSON.stringify(fallback.data.episodes));
        localStorage.setItem('currentEpisodeIndex', fallback.targetIndex);
        localStorage.setItem('currentSourceCode', fallback.sourceKey);
        localStorage.setItem('lastPlayTime', Date.now());

        const watchUrl = `player.html?id=${encodeURIComponent(fallback.vodId)}&source=${encodeURIComponent(fallback.sourceKey)}&url=${encodeURIComponent(fallback.targetUrl)}&index=${fallback.targetIndex}&position=${Math.floor(currentPosition)}&title=${encodeURIComponent(currentVideoTitle)}`;
        showToast('当前线路异常，已自动切换备用线路', 'info');
        window.location.href = watchUrl;
        return true;
    } catch (error) {
        console.error('自动换线失败:', error);
        return false;
    }
}

const originalCloseResourceModal = window.closeModal;
if (typeof originalCloseResourceModal === 'function' && !window.__openStreamResourceCloseWrapped) {
    window.__openStreamResourceCloseWrapped = true;
    window.closeModal = function (...args) {
        cancelPlayerResourceSwitch();
        return originalCloseResourceModal(...args);
    };
}

window.showSwitchResourceModal = showSwitchResourceModal;
window.switchToResource = switchToResource;
window.autoSwitchToBestResource = autoSwitchToBestResource;
window.cancelPlayerResourceSwitch = cancelPlayerResourceSwitch;
window.OpenStreamResourceSwitch = {
    showSwitchResourceModal,
    switchToResource,
    autoSwitchToBestResource,
    cancel: cancelPlayerResourceSwitch,
    testVideoSourceSpeed
};

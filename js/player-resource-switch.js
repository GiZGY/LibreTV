// 播放页资源切换：独立于 player.js，避免播放器主文件继续膨胀。
const RESOURCE_SWITCH_CACHE_TTL = 5 * 60 * 1000;
const resourceSwitchSearchCache = new Map();
const resourceSwitchDetailCache = new Map();
const resourceSwitchSpeedCache = new Map();

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
    cache.set(key, { time: Date.now(), value });
    return value;
}

async function runResourceQueue(items, concurrency, worker) {
    if (typeof runSearchQueue === 'function') {
        return runSearchQueue(items, concurrency, worker);
    }

    const input = Array.isArray(items) ? items : [];
    const results = new Array(input.length);
    let nextIndex = 0;
    const limit = Math.max(1, Math.min(Number(concurrency) || 1, input.length));
    const workers = Array.from({ length: limit }, async () => {
        while (nextIndex < input.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await worker(input[currentIndex], currentIndex);
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

async function fetchResourceDetail(sourceKey, vodId) {
    const apiParams = buildResourceApiParams(sourceKey);
    if (!apiParams) throw new Error('API配置无效');

    const cacheKey = `${sourceKey}|${vodId}|${apiParams}`;
    const cached = getCachedValue(resourceSwitchDetailCache, cacheKey);
    if (cached) return cached;

    const adapterResult = window.OpenStreamSourceAdapter?.detail
        ? await window.OpenStreamSourceAdapter.detail(sourceKey, vodId)
        : null;

    let data;
    if (adapterResult) {
        if (adapterResult.status !== 'ready') throw new Error(adapterResult.status || '获取失败');
        data = adapterResult.data;
    } else {
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}`);
        if (!response.ok) throw new Error('获取失败');
        data = await response.json();
    }

    if (!data || !Array.isArray(data.episodes) || data.episodes.length === 0) {
        throw new Error('无播放源');
    }
    return setCachedValue(resourceSwitchDetailCache, cacheKey, data);
}

async function searchResourceOption(opt, title) {
    const cacheKey = `${opt.key}|${title}`;
    const cached = getCachedValue(resourceSwitchSearchCache, cacheKey);
    if (cached) return cached;

    const adapterResult = window.OpenStreamSourceAdapter?.search
        ? await window.OpenStreamSourceAdapter.search(opt.key, title, getDefaultSearchFilters(), { maxPages: 1 })
        : { status: 'ready', list: await searchByAPIAndKeyWord(opt.key, title) };
    if (adapterResult.status === 'login_required' || adapterResult.status === 'unsupported') return null;

    const queryResult = adapterResult.list;
    if (!Array.isArray(queryResult) || queryResult.length === 0) return null;

    const exact = queryResult.find(res => res.vod_name === title);
    return setCachedValue(resourceSwitchSearchCache, cacheKey, exact || queryResult[0]);
}

// 测试视频源速率的函数
async function testVideoSourceSpeed(sourceKey, vodId) {
    const cacheKey = `${sourceKey}|${vodId}`;
    const cached = getCachedValue(resourceSwitchSpeedCache, cacheKey);
    if (cached) return cached;

    try {
        const startTime = performance.now();
        const playable = window.OpenStreamSourceAdapter?.play
            ? await window.OpenStreamSourceAdapter.play(sourceKey, vodId, '', 0)
            : null;
        const data = playable?.data || await fetchResourceDetail(sourceKey, vodId);
        const firstEpisodeUrl = playable?.url || data.episodes[0];
        if (!firstEpisodeUrl || (playable && playable.status !== 'ready')) {
            return setCachedValue(resourceSwitchSpeedCache, cacheKey, { speed: -1, error: playable?.status || '链接无效' });
        }

        try {
            await fetch(firstEpisodeUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: AbortSignal.timeout(5000)
            });
        } catch (_) {
            // 播放链接 HEAD 经常被跨域或源站限制；失败时使用详情接口耗时兜底。
        }

        const totalTime = performance.now() - startTime;
        return setCachedValue(resourceSwitchSpeedCache, cacheKey, {
            speed: Math.round(totalTime),
            episodes: data.episodes.length,
            error: null
        });
    } catch (error) {
        return setCachedValue(resourceSwitchSpeedCache, cacheKey, {
            speed: -1,
            error: error.name === 'AbortError' ? '超时' : (error.message || '测试失败')
        });
    }
}

// 格式化速度显示
function formatSpeedDisplay(speedResult) {
    if (speedResult.speed === -1) {
        return `<span class="speed-indicator error">❌ ${speedResult.error}</span>`;
    }

    const speed = speedResult.speed;
    let className = 'speed-indicator good';
    let icon = '🟢';

    if (speed > 2000) {
        className = 'speed-indicator poor';
        icon = '🔴';
    } else if (speed > 1000) {
        className = 'speed-indicator medium';
        icon = '🟡';
    }

    const note = speedResult.note ? ` (${speedResult.note})` : '';
    return `<span class="${className}">${icon} ${speed}ms${note}</span>`;
}

function getResourceOptions() {
    const options = selectedAPIs.map((curr) => {
        if (API_SITES[curr]) {
            return { key: curr, name: API_SITES[curr].name };
        }
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

function renderSwitchResourceCards({ allResults, speedResults, resourceOptions, currentSourceCode, currentVideoId }) {
    const sortedResults = Object.entries(allResults).sort(([keyA, resultA], [keyB, resultB]) => {
        const isCurrentA = String(keyA) === String(currentSourceCode) && String(resultA.vod_id) === String(currentVideoId);
        const isCurrentB = String(keyB) === String(currentSourceCode) && String(resultB.vod_id) === String(currentVideoId);

        if (isCurrentA && !isCurrentB) return -1;
        if (!isCurrentA && isCurrentB) return 1;

        const speedA = speedResults[keyA]?.speed || 99999;
        const speedB = speedResults[keyB]?.speed || 99999;

        if (speedA === -1 && speedB !== -1) return 1;
        if (speedA !== -1 && speedB === -1) return -1;
        if (speedA === -1 && speedB === -1) return 0;

        return speedA - speedB;
    });

    if (sortedResults.length === 0) {
        return '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">没有找到可切换资源</div>';
    }

    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">';
    for (const [sourceKey, result] of sortedResults) {
        if (!result) continue;
        const isCurrentSource = String(sourceKey) === String(currentSourceCode) && String(result.vod_id) === String(currentVideoId);
        const sourceName = resourceOptions.find(opt => opt.key === sourceKey)?.name || '未知资源';
        const speedResult = speedResults[sourceKey] || { speed: -1, error: '未测试' };

        html += `
            <div class="relative group ${isCurrentSource ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}"
                 ${!isCurrentSource ? `onclick="switchToResource('${sourceKey}', '${result.vod_id}')"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    <img src="${result.vod_pic}"
                         alt="${result.vod_name}"
                         class="w-full h-full object-cover"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48cGF0aCBkPSJNMjEgMTV2NGEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMnYtNCI+PC9wYXRoPjxwb2x5bGluZSBwb2ludHM9IjE3IDggMTIgMyA3IDgiPjwvcG9seWxpbmU+PHBhdGggZD0iTTEyIDN2MTIiPjwvcGF0aD48L3N2Zz4='">
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${formatSpeedDisplay(speedResult)}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${result.vod_name}</div>
                    <div class="text-[10px] text-gray-400 truncate">${sourceName}</div>
                    <div class="text-[10px] text-gray-500 mt-1">
                        ${speedResult.episodes ? `${speedResult.episodes}集` : ''}
                    </div>
                </div>
                ${isCurrentSource ? `
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div class="bg-blue-600 bg-opacity-75 rounded-lg px-2 py-0.5 text-xs text-white font-medium">
                            当前播放
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
    html += '</div>';
    return html;
}

async function showSwitchResourceModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.innerHTML = `<span class="break-words">${currentVideoTitle}</span>`;
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在加载资源列表...</div>';
    modal.classList.remove('hidden');

    const config = getResourceSwitchConfig();
    const resourceOptions = getResourceOptions();
    const allResults = {};
    const speedResults = {};
    let searchedCount = 0;

    await runResourceQueue(resourceOptions, config.searchConcurrency || 3, async (opt) => {
        try {
            const result = await searchResourceOption(opt, currentVideoTitle);
            if (result) allResults[opt.key] = result;
        } catch (error) {
            console.warn(`资源 ${opt.key} 搜索失败:`, error);
        } finally {
            searchedCount += 1;
            modalContent.innerHTML = `<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在查找可切换资源... ${searchedCount}/${resourceOptions.length}</div>`;
        }
    });

    const resultEntries = Object.entries(allResults);
    if (resultEntries.length === 0) {
        modalContent.innerHTML = renderSwitchResourceCards({ allResults, speedResults, resourceOptions, currentSourceCode, currentVideoId });
        return;
    }

    let testedCount = 0;
    modalContent.innerHTML = `<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在测试各资源速率... 0/${resultEntries.length}</div>`;

    await runResourceQueue(resultEntries, config.speedConcurrency || 2, async ([sourceKey, result]) => {
        try {
            speedResults[sourceKey] = await testVideoSourceSpeed(sourceKey, result.vod_id);
        } catch (error) {
            console.warn(`资源 ${sourceKey} 测速失败:`, error);
            speedResults[sourceKey] = { speed: -1, error: '测试失败' };
        } finally {
            testedCount += 1;
            modalContent.innerHTML = `<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在测试各资源速率... ${testedCount}/${resultEntries.length}</div>`;
        }
    });

    modalContent.innerHTML = renderSwitchResourceCards({ allResults, speedResults, resourceOptions, currentSourceCode, currentVideoId });
}

// 切换资源的函数
async function switchToResource(sourceKey, vodId) {
    document.getElementById('modal').classList.add('hidden');

    showLoading();
    try {
        const data = await fetchResourceDetail(sourceKey, vodId);
        const currentIndex = currentEpisodeIndex;
        const targetIndex = currentIndex < data.episodes.length ? currentIndex : 0;
        const targetUrl = data.episodes[targetIndex];
        const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}`;

        try {
            localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
            localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
            localStorage.setItem('currentEpisodeIndex', targetIndex);
            localStorage.setItem('currentSourceCode', sourceKey);
            localStorage.setItem('lastPlayTime', Date.now());
        } catch (e) {
            console.error('保存播放状态失败:', e);
        }

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
            if (!result || !result.vod_id) continue;

            const playable = window.OpenStreamSourceAdapter?.play
                ? await window.OpenStreamSourceAdapter.play(opt.key, result.vod_id, '', currentEpisodeIndex)
                : null;
            if (playable && playable.status !== 'ready') continue;

            const data = playable?.data || await fetchResourceDetail(opt.key, result.vod_id);
            const targetIndex = playable?.episodeIndex ?? (currentEpisodeIndex < data.episodes.length ? currentEpisodeIndex : 0);
            const targetUrl = playable?.url || data.episodes[targetIndex];
            if (!targetUrl) continue;

            return {
                sourceKey: opt.key,
                vodId: result.vod_id,
                targetIndex,
                targetUrl,
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

        const watchUrl = `player.html?id=${fallback.vodId}&source=${fallback.sourceKey}&url=${encodeURIComponent(fallback.targetUrl)}&index=${fallback.targetIndex}&position=${Math.floor(currentPosition)}&title=${encodeURIComponent(currentVideoTitle)}`;
        showToast('当前线路异常，已自动切换备用线路', 'info');
        window.location.href = watchUrl;
        return true;
    } catch (error) {
        console.error('自动换线失败:', error);
        return false;
    }
}

window.showSwitchResourceModal = showSwitchResourceModal;
window.switchToResource = switchToResource;
window.autoSwitchToBestResource = autoSwitchToBestResource;

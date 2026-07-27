// 全局变量
function readStoredArray(key, fallback = []) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        return Array.isArray(parsed) ? parsed : [...fallback];
    } catch (_) {
        return [...fallback];
    }
}

let selectedAPIs = readStoredArray(
    'selectedAPIs',
    ['jisu', 'bfzy', 'baidu', 'hwba', 'qiqi', 'mozhua']
).filter(item => typeof item === 'string'); // 默认选中资源
let customAPIs = readStoredArray('customAPIs')
    .filter(item => item && typeof item === 'object' && !Array.isArray(item)); // 存储自定义API列表

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
// 添加当前视频的标题
let currentVideoTitle = '';
let currentDetailSourceCode = '';
let currentDetailVideoId = '';
let activeDetailRequestSeq = 0;
let activeDetailAbortController = null;
// 全局变量用于倒序状态
let episodesReversed = false;
// 存储API延迟数据（从localStorage加载缓存）
let apiLatencies = {};
let latencyTestTime = null; // 测速时间戳
// 存储API质量检测数据（从localStorage加载缓存）
let apiQualities = {};
let qualityTestTime = null; // 质量检测时间戳

function escapeAppHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
let hideZombieApis = localStorage.getItem('hideZombieApis') !== 'false'; // 默认隐藏僵尸源
let searchFilters = loadSearchFilters();

function getDefaultSearchFilters() {
    const defaults = SEARCH_FILTERS_CONFIG?.default || { type: 'all', year: '', genre: '' };
    return {
        type: defaults.type || 'all',
        year: defaults.year || '',
        genre: defaults.genre || ''
    };
}

function loadSearchFilters() {
    const defaults = getDefaultSearchFilters();
    try {
        const raw = localStorage.getItem(SEARCH_FILTERS_CONFIG.storageKey);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        if (window.normalizeSearchFilters) {
            return window.normalizeSearchFilters(parsed);
        }
        return defaults;
    } catch (_) {
        return defaults;
    }
}

function saveSearchFilters() {
    try {
        localStorage.setItem(SEARCH_FILTERS_CONFIG.storageKey, JSON.stringify(searchFilters));
    } catch (e) {
        console.error('保存搜索筛选失败:', e);
    }
}

function setSearchFilters(filters, save = true) {
    if (window.normalizeSearchFilters) {
        searchFilters = window.normalizeSearchFilters(filters);
    } else {
        searchFilters = getDefaultSearchFilters();
    }

    const typeSelect = document.getElementById('typeSelect');
    const yearSelect = document.getElementById('yearSelect');
    const genreSelect = document.getElementById('genreSelect');

    if (typeSelect) typeSelect.value = searchFilters.type;
    if (yearSelect) yearSelect.value = searchFilters.year;
    if (genreSelect) genreSelect.value = searchFilters.genre;

    if (save) {
        saveSearchFilters();
    }

    updateSearchSummaryUI(searchFilters, 0, 0);
}

function getSearchFiltersFromUI() {
    const typeSelect = document.getElementById('typeSelect');
    const yearSelect = document.getElementById('yearSelect');
    const genreSelect = document.getElementById('genreSelect');

    const fromUI = {
        type: typeSelect ? typeSelect.value : searchFilters.type,
        year: yearSelect ? yearSelect.value : searchFilters.year,
        genre: genreSelect ? genreSelect.value : searchFilters.genre
    };

    setSearchFilters(fromUI, true);
    return searchFilters;
}

function initSearchFilterOptions() {
    const typeSelect = document.getElementById('typeSelect');
    const yearSelect = document.getElementById('yearSelect');
    const genreSelect = document.getElementById('genreSelect');

    if (!typeSelect || !yearSelect || !genreSelect || !SEARCH_FILTERS_CONFIG) return;

    // 初始化大类选项（避免未来调整配置后忘记同步）
    if (typeSelect.options.length <= 1) {
        typeSelect.innerHTML = '';
        SEARCH_FILTERS_CONFIG.types.forEach(item => {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            typeSelect.appendChild(option);
        });
    }

    // 初始化年份选项
    yearSelect.innerHTML = '<option value=\"\">不限</option>';
    const start = SEARCH_FILTERS_CONFIG.yearRange.start;
    const total = SEARCH_FILTERS_CONFIG.yearRange.totalYears;
    for (let year = start; year > start - total; year--) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
    }

    // 初始化题材选项
    genreSelect.innerHTML = '<option value=\"\">不限</option>';
    SEARCH_FILTERS_CONFIG.genres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        genreSelect.appendChild(option);
    });

    setSearchFilters(searchFilters, false);
}

function getSearchFilterSummary(filters) {
    const f = filters || getDefaultSearchFilters();
    const labels = [];

    if (f.type && f.type !== 'all') {
        labels.push(`大类: ${f.type === 'movie' ? '电影' : '电视剧'}`);
    }
    if (f.year) {
        labels.push(`年份: ${f.year}`);
    }
    if (f.genre) {
        labels.push(`题材: ${f.genre}`);
    }
    return labels.join(' · ');
}

function updateSearchSummaryUI(filters, rawCount, finalCount) {
    const summaryEl = document.getElementById('searchFilterSummary');
    const rawEl = document.getElementById('searchRawResultsCount');
    const finalEl = document.getElementById('searchResultsCount');

    if (summaryEl) {
        const summary = getSearchFilterSummary(filters);
        summaryEl.textContent = summary ? `当前筛选：${summary}` : '';
    }
    if (rawEl) rawEl.textContent = String(rawCount || 0);
    if (finalEl) finalEl.textContent = String(finalCount || 0);
}

function buildSearchPath(query, filters) {
    if (query) {
        return `/s=${encodeURIComponent(query)}`;
    }
    const params = new URLSearchParams();
    if (filters.type && filters.type !== 'all') params.set('type', filters.type);
    if (filters.year) params.set('year', filters.year);
    if (filters.genre) params.set('genre', filters.genre);

    const queryString = params.toString();
    return `/${queryString ? `?${queryString}` : ''}`;
}

function resetSearchFiltersState(save = true) {
    setSearchFilters(getDefaultSearchFilters(), save);
    updateSearchSummaryUI(searchFilters, 0, 0);
}

window.resetSearchFilters = function () {
    resetSearchFiltersState(true);
    const input = document.getElementById('searchInput');
    const hasQuery = !!(input && input.value.trim());
    // 清空筛选后，如果当前没有关键词，直接回到首页态（显示豆瓣热门）
    if (!hasQuery) {
        resetSearchArea();
    }
};
window.setSearchFilters = setSearchFilters;
window.getSearchFiltersFromUI = getSearchFiltersFromUI;
window.buildSearchPath = buildSearchPath;

function isPasswordReadyForApiCalls() {
    try {
        return window.isAuthSessionReady?.() === true &&
            window.isPasswordVerified?.() === true;
    } catch (_) {
        // 保守：不确定就不要自动跑，避免把所有源打成 0 分
        return false;
    }
}

const PASSIVE_QUALITY_SAMPLE_KEY = 'openstreamPassiveQualitySamples';
const PASSIVE_QUALITY_STALE_MS = 24 * 60 * 60 * 1000;
const PASSIVE_QUALITY_DAILY_LIMIT = 2;
let passiveQualityTimer = 0;
let passiveQualityIdleHandle = 0;
let passiveQualityController = null;
let qualityRuntimePromise = null;

function ensureQualityRuntime() {
    if (window.OpenStreamQualitySelection && window.OpenStreamPlaybackQuality) {
        return Promise.resolve();
    }
    if (qualityRuntimePromise) return qualityRuntimePromise;

    qualityRuntimePromise = new Promise((resolve, reject) => {
        const src = document.body?.dataset?.qualityRuntimeSrc;
        if (!src) {
            reject(new Error('质量检测模块地址缺失'));
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            if (window.OpenStreamQualitySelection && window.OpenStreamPlaybackQuality) {
                resolve();
            } else {
                reject(new Error('质量检测模块初始化失败'));
            }
        };
        script.onerror = () => reject(new Error('质量检测模块加载失败'));
        document.head.appendChild(script);
    }).catch((error) => {
        qualityRuntimePromise = null;
        throw error;
    });
    return qualityRuntimePromise;
}

function readPassiveQualitySamples() {
    const day = new Date().toISOString().slice(0, 10);
    try {
        const value = JSON.parse(localStorage.getItem(PASSIVE_QUALITY_SAMPLE_KEY) || 'null');
        if (value?.day === day && Array.isArray(value.sources)) return value;
    } catch (_) {}
    return { day, sources: [] };
}

function writePassiveQualitySamples(value) {
    try {
        localStorage.setItem(PASSIVE_QUALITY_SAMPLE_KEY, JSON.stringify(value));
    } catch (_) {}
}

function canRunPassiveQualitySample() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (document.hidden || !isPasswordReadyForApiCalls()) return false;
    if (window.isOpenStreamSearchActive?.()) return false;
    if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) return false;
    return true;
}

function getNextPassiveQualitySource(sampleState) {
    const candidates = (Array.isArray(selectedAPIs) ? selectedAPIs : [])
        .filter((apiId) => API_SITES[apiId] && !apiId.startsWith('custom_'))
        .filter((apiId) => !sampleState.sources.includes(apiId))
        .map((apiId) => ({
            apiId,
            testedAt: Number(apiQualities?.[apiId]?.testedAt || 0)
        }))
        .filter((item) => Date.now() - item.testedAt >= PASSIVE_QUALITY_STALE_MS)
        .sort((a, b) => a.testedAt - b.testedAt);
    return candidates[0]?.apiId || '';
}

function getQualityHealthStatus(quality) {
    if (!quality) return null;
    if (quality.playOk && quality.segmentOk) return 'ready';
    const stageStatuses = [
        quality.playStatus,
        quality.detailStatus,
        quality.searchStatus
    ];
    for (const status of ['timeout', 'unsupported', 'login_required']) {
        if (stageStatuses.includes(status)) return status;
    }
    if (quality.playStatus === 'unplayable') return 'unplayable';
    if (quality.playStatus === 'unknown') return null;
    if (stageStatuses.includes('error')) return 'error';
    if (quality.playStatus === 'no_result' || quality.detailStatus === 'no_result') return 'no_result';
    if (quality.searchStatus === 'timeout') return 'timeout';
    if (quality.searchStatus === 'unsupported') return 'unsupported';
    if (quality.searchStatus === 'login_required') return 'login_required';
    if (quality.searchStatus === 'no_result') return 'no_result';
    if (quality.playTested || quality.error) return 'error';
    return null;
}

async function runPassiveQualitySample() {
    passiveQualityTimer = 0;
    passiveQualityIdleHandle = 0;
    if (!canRunPassiveQualitySample()) {
        schedulePassiveQualitySampling(60_000);
        return;
    }

    const sampleState = readPassiveQualitySamples();
    if (sampleState.sources.length >= PASSIVE_QUALITY_DAILY_LIMIT) return;
    const apiId = getNextPassiveQualitySource(sampleState);
    if (!apiId) return;

    passiveQualityController?.abort();
    passiveQualityController = new AbortController();
    try {
        await ensureQualityRuntime();
        const result = await measureApiQuality(apiId, {
            playTest: true,
            signal: passiveQualityController.signal,
            bypassCache: true
        });
        if (passiveQualityController.signal.aborted || !result?.quality) return;

        const quality = { ...result.quality, testedAt: Date.now(), passive: true };
        apiQualities[apiId] = quality;
        if (typeof quality.searchMs === 'number') apiLatencies[apiId] = quality.searchMs;
        qualityTestTime = quality.testedAt;
        latencyTestTime = quality.testedAt;
        saveQualityCache();
        saveLatencyCache();
        window.OpenStreamSourceHealth?.refreshStoredMetrics?.();
        const healthStatus = getQualityHealthStatus(quality);
        if (healthStatus) {
            window.OpenStreamSourceHealth?.recordSourceEvent?.(apiId, {
                status: healthStatus,
                ms: quality.playTtfbMs ?? quality.detailMs ?? quality.searchMs,
                verifiedPlayable: healthStatus === 'ready'
            });
        }

        sampleState.sources.push(apiId);
        writePassiveQualitySamples(sampleState);
        initAPICheckboxes();
        updateLatencyTimeDisplay();
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn(`后台质量抽样失败 (${apiId}):`, error);
        }
    } finally {
        passiveQualityController = null;
        if (readPassiveQualitySamples().sources.length < PASSIVE_QUALITY_DAILY_LIMIT) {
            schedulePassiveQualitySampling(120_000);
        }
    }
}

function cancelPassiveQualitySampling(options = {}) {
    if (passiveQualityTimer) clearTimeout(passiveQualityTimer);
    if (passiveQualityIdleHandle && 'cancelIdleCallback' in window) {
        cancelIdleCallback(passiveQualityIdleHandle);
    }
    passiveQualityTimer = 0;
    passiveQualityIdleHandle = 0;
    passiveQualityController?.abort();
    passiveQualityController = null;
    if (options.reschedule) schedulePassiveQualitySampling(30_000);
}

function schedulePassiveQualitySampling(delayMs = 20_000) {
    if (passiveQualityTimer || passiveQualityIdleHandle || passiveQualityController) return;
    passiveQualityTimer = setTimeout(() => {
        passiveQualityTimer = 0;
        if ('requestIdleCallback' in window) {
            passiveQualityIdleHandle = requestIdleCallback(runPassiveQualitySample, { timeout: 30_000 });
        } else {
            passiveQualityTimer = setTimeout(runPassiveQualitySample, 5_000);
        }
    }, delayMs);
}

window.cancelPassiveQualitySampling = cancelPassiveQualitySampling;
window.schedulePassiveQualitySampling = schedulePassiveQualitySampling;

// 从localStorage加载延迟缓存
function loadLatencyCache() {
    try {
        const cached = localStorage.getItem('apiLatencies');
        const cachedTime = localStorage.getItem('latencyTestTime');
        if (cached && cachedTime) {
            apiLatencies = JSON.parse(cached);
            latencyTestTime = parseInt(cachedTime);
        }
    } catch (e) {
        console.error('加载延迟缓存失败:', e);
    }
}

// 保存延迟缓存
function saveLatencyCache() {
    try {
        localStorage.setItem('apiLatencies', JSON.stringify(apiLatencies));
        localStorage.setItem('latencyTestTime', latencyTestTime.toString());
    } catch (e) {
        console.error('保存延迟缓存失败:', e);
    }
}

// 从localStorage加载质量缓存
function loadQualityCache() {
    try {
        const cached = localStorage.getItem('apiQualities');
        const cachedTime = localStorage.getItem('qualityTestTime');
        if (cached && cachedTime) {
            apiQualities = JSON.parse(cached);
            qualityTestTime = parseInt(cachedTime);
        }
    } catch (e) {
        console.error('加载质量缓存失败:', e);
    }
}

// 保存质量缓存
function saveQualityCache() {
    try {
        localStorage.setItem('apiQualities', JSON.stringify(apiQualities));
        localStorage.setItem('qualityTestTime', qualityTestTime.toString());
    } catch (e) {
        console.error('保存质量缓存失败:', e);
    }
}

// 初始化时加载缓存
loadLatencyCache();
loadQualityCache();

// 页面初始化
document.addEventListener('DOMContentLoaded', function () {
    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置默认API选择（如果是第一次加载）
    if (!localStorage.getItem('hasInitializedDefaults')) {
        // 默认选中资源
        selectedAPIs = ["jisu", "bfzy", "baidu", "hwba", "qiqi", "mozhua"];
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        // 默认选中过滤开关
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');

        // 默认启用豆瓣功能
        localStorage.setItem('doubanEnabled', 'true');

        // 标记已初始化默认值
        localStorage.setItem('hasInitializedDefaults', 'true');

    }

    // 质量状态在日常搜索/播放中持续学习；这里只在空闲期低频抽样，
    // 避免首次访问对所有源发起全量检测。
    schedulePassiveQualitySampling();

    // 更新检测时间显示
    updateLatencyTimeDisplay();

    // 设置隐藏僵尸源开关初始状态
    const hideZombieToggle = document.getElementById('hideZombieToggle');
    if (hideZombieToggle) {
        hideZombieToggle.checked = hideZombieApis;
        hideZombieToggle.addEventListener('change', (e) => {
            hideZombieApis = !!e.target.checked;
            localStorage.setItem('hideZombieApis', hideZombieApis ? 'true' : 'false');
            initAPICheckboxes();
        });
    }

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);
});

// 初始化API复选框
function initAPICheckboxes() {
    const container = document.getElementById('apiCheckboxes');
    container.innerHTML = '';

    // 添加普通API组标题
    const normaldiv = document.createElement('div');
    normaldiv.id = 'normaldiv';
    normaldiv.className = 'grid grid-cols-2 gap-2';
    const normalTitle = document.createElement('div');
    normalTitle.className = 'api-group-title';
    normalTitle.textContent = '普通资源';
    normaldiv.appendChild(normalTitle);

    // 创建普通API源的复选框
    const sortedApiKeys = Object.keys(API_SITES).sort((a, b) => {
        // 优先按质量分排序（高分在前），没有质量分时按延迟排序（低延迟在前）
        const qa = apiQualities[a]?.score;
        const qb = apiQualities[b]?.score;
        if (typeof qa === 'number' || typeof qb === 'number') {
            if (typeof qa !== 'number') return 1;
            if (typeof qb !== 'number') return -1;
            if (qb !== qa) return qb - qa;
        }
        const latencyA = apiLatencies[a] || 999999;
        const latencyB = apiLatencies[b] || 999999;
        return latencyA - latencyB;
    });

    sortedApiKeys.forEach(apiKey => {
        const api = API_SITES[apiKey];
        if (api.adult) return; // 跳过成人内容API，稍后添加
        if (hideZombieApis && !selectedAPIs.includes(apiKey) && apiQualities[apiKey]?.score === 0) return;

        const checked = selectedAPIs.includes(apiKey);
        const latency = apiLatencies[apiKey];
        const q = apiQualities[apiKey];
        let latencyHtml = '';
        if (q && typeof q.score === 'number') {
            const score = Math.round(q.score);
            let colorClass = 'latency-poor';
            if (score >= 80) colorClass = 'latency-excellent';
            else if (score >= 60) colorClass = 'latency-good';
            else if (score < 30) colorClass = 'latency-timeout';
            latencyHtml = `<span class="latency-badge ${colorClass}" title="质量分: ${score}">${score}</span>`;
        } else if (latency !== undefined && latency < 9999) {
            let displayLatency, colorClass;
            if (latency >= 1000) {
                displayLatency = '1000+';
                colorClass = 'latency-timeout';
            } else if (latency < 500) {
                displayLatency = latency + 'ms';
                colorClass = 'latency-excellent';
            } else if (latency < 700) {
                displayLatency = latency + 'ms';
                colorClass = 'latency-good';
            } else {
                displayLatency = latency + 'ms';
                colorClass = 'latency-poor';
            }
            latencyHtml = `<span class="latency-badge ${colorClass}">${displayLatency}</span>`;
        }

        const checkbox = document.createElement('div');
        checkbox.className = 'flex items-center justify-between pr-1';
        checkbox.innerHTML = `
            <div class="flex items-center min-w-0 flex-1">
                <input type="checkbox" id="api_${apiKey}" 
                       class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333]" 
                       ${checked ? 'checked' : ''} 
                       data-api="${apiKey}">
                <label for="api_${apiKey}" class="ml-1 text-xs text-gray-400 truncate" title="${api.name}">${api.name}</label>
            </div>
            ${latencyHtml}
        `;
        normaldiv.appendChild(checkbox);

        // 添加事件监听器
        checkbox.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
    container.appendChild(normaldiv);

    // 添加成人API列表
    addAdultAPI();

    // 初始检查成人内容状态
    checkAdultAPIsSelected();
}

// 添加成人API列表
function addAdultAPI() {
    // 仅在隐藏设置为false时添加成人API组
    if (!HIDE_BUILTIN_ADULT_APIS && (localStorage.getItem('yellowFilterEnabled') === 'false')) {
        const container = document.getElementById('apiCheckboxes');

        // 添加成人API组标题
        const adultdiv = document.createElement('div');
        adultdiv.id = 'adultdiv';
        adultdiv.className = 'grid grid-cols-2 gap-2';
        const adultTitle = document.createElement('div');
        adultTitle.className = 'api-group-title adult';
        adultTitle.innerHTML = `黄色资源采集站 <span class="adult-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </span>`;
        adultdiv.appendChild(adultTitle);

        // 创建成人API源的复选框
        const sortedAdultKeys = Object.keys(API_SITES).filter(k => API_SITES[k].adult).sort((a, b) => {
            const qa = apiQualities[a]?.score;
            const qb = apiQualities[b]?.score;
            if (typeof qa === 'number' || typeof qb === 'number') {
                if (typeof qa !== 'number') return 1;
                if (typeof qb !== 'number') return -1;
                if (qb !== qa) return qb - qa;
            }
            const latencyA = apiLatencies[a] || 999999;
            const latencyB = apiLatencies[b] || 999999;
            return latencyA - latencyB;
        });

        sortedAdultKeys.forEach(apiKey => {
            const api = API_SITES[apiKey];
            if (hideZombieApis && !selectedAPIs.includes(apiKey) && apiQualities[apiKey]?.score === 0) return;
            const checked = selectedAPIs.includes(apiKey);
            const latency = apiLatencies[apiKey];
            const q = apiQualities[apiKey];
            let latencyHtml = '';
            if (q && typeof q.score === 'number') {
                const score = Math.round(q.score);
                let colorClass = 'latency-poor';
                if (score >= 80) colorClass = 'latency-excellent';
                else if (score >= 60) colorClass = 'latency-good';
                else if (score < 30) colorClass = 'latency-timeout';
                latencyHtml = `<span class="latency-badge ${colorClass}" title="质量分: ${score}">${score}</span>`;
            } else if (latency !== undefined && latency < 9999) {
                let displayLatency, colorClass;
                if (latency >= 1000) {
                    displayLatency = '1000+';
                    colorClass = 'latency-timeout';
                } else if (latency < 500) {
                    displayLatency = latency + 'ms';
                    colorClass = 'latency-excellent';
                } else if (latency < 700) {
                    displayLatency = latency + 'ms';
                    colorClass = 'latency-good';
                } else {
                    displayLatency = latency + 'ms';
                    colorClass = 'latency-poor';
                }
                latencyHtml = `<span class="latency-badge ${colorClass}">${displayLatency}</span>`;
            }

            const checkbox = document.createElement('div');
            checkbox.className = 'flex items-center justify-between pr-1';
            checkbox.innerHTML = `
                <div class="flex items-center min-w-0 flex-1">
                    <input type="checkbox" id="api_${apiKey}" 
                           class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] api-adult" 
                           ${checked ? 'checked' : ''} 
                           data-api="${apiKey}">
                    <label for="api_${apiKey}" class="ml-1 text-xs text-pink-400 truncate" title="${api.name}">${api.name}</label>
                </div>
                ${latencyHtml}
            `;
            adultdiv.appendChild(checkbox);

            // 添加事件监听器
            checkbox.querySelector('input').addEventListener('change', function () {
                updateSelectedAPIs();
                checkAdultAPIsSelected();
            });
        });
        container.appendChild(adultdiv);
    }
}

// 检查是否有成人API被选中
function checkAdultAPIsSelected() {
    // 查找所有内置成人API复选框
    const adultBuiltinCheckboxes = document.querySelectorAll('#apiCheckboxes .api-adult:checked');

    // 查找所有自定义成人API复选框
    const customApiCheckboxes = document.querySelectorAll('#customApisList .api-adult:checked');

    const hasAdultSelected = adultBuiltinCheckboxes.length > 0 || customApiCheckboxes.length > 0;

    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    const yellowFilterContainer = yellowFilterToggle.closest('div').parentNode;
    const filterDescription = yellowFilterContainer.querySelector('p.filter-description');

    // 如果选择了成人API，禁用黄色内容过滤器
    if (hasAdultSelected) {
        yellowFilterToggle.checked = false;
        yellowFilterToggle.disabled = true;
        localStorage.setItem('yellowFilterEnabled', 'false');

        // 添加禁用样式
        yellowFilterContainer.classList.add('filter-disabled');

        // 修改描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="text-pink-300">选中黄色资源站时无法启用此过滤</strong>';
        }

        // 移除提示信息（如果存在）
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    } else {
        // 启用黄色内容过滤器
        yellowFilterToggle.disabled = false;
        yellowFilterContainer.classList.remove('filter-disabled');

        // 恢复原来的描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '过滤"伦理片"等黄色内容';
        }

        // 移除提示信息
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }
}

// 渲染自定义API列表
function renderCustomAPIsList() {
    const container = document.getElementById('customApisList');
    if (!container) return;

    if (customAPIs.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center my-2">未添加自定义API</p>';
        return;
    }

    container.innerHTML = '';

    // 对自定义API进行排序
    const sortedCustomApis = customAPIs.map((api, index) => ({ ...api, originalIndex: index }))
        .sort((a, b) => {
            const latencyA = apiLatencies['custom_' + a.originalIndex] || 999999;
            const latencyB = apiLatencies['custom_' + b.originalIndex] || 999999;
            return latencyA - latencyB;
        });

    sortedCustomApis.forEach((api) => {
        const index = api.originalIndex;
        const apiItem = document.createElement('div');
        apiItem.className = 'flex items-center justify-between p-1 mb-1 bg-[#222] rounded';
        const textColorClass = api.isAdult ? 'text-pink-400' : 'text-white';
        const adultTag = api.isAdult ? '<span class="text-xs text-pink-400 mr-1">(18+)</span>' : '';
        // 新增 detail 地址显示
        const detailLine = api.detail
            ? `<div class="text-xs text-gray-400 truncate">detail: ${escapeAppHtml(api.detail)}</div>`
            : '';

        const latency = apiLatencies['custom_' + index];
        let latencyHtml = '';
        if (latency !== undefined && latency < 9999) {
            let displayLatency, colorClass;
            if (latency >= 1000) {
                displayLatency = '1000+';
                colorClass = 'latency-timeout';
            } else if (latency < 500) {
                displayLatency = latency + 'ms';
                colorClass = 'latency-excellent';
            } else if (latency < 700) {
                displayLatency = latency + 'ms';
                colorClass = 'latency-good';
            } else {
                displayLatency = latency + 'ms';
                colorClass = 'latency-poor';
            }
            latencyHtml = `<span class="latency-badge ${colorClass} flex-shrink-0">${displayLatency}</span>`;
        }

        apiItem.innerHTML = `
            <div class="flex items-center flex-1 min-w-0">
                <input type="checkbox" id="custom_api_${index}" 
                       class="form-checkbox h-3 w-3 text-blue-600 mr-1 ${api.isAdult ? 'api-adult' : ''}" 
                       ${selectedAPIs.includes('custom_' + index) ? 'checked' : ''} 
                       data-custom-index="${index}">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <div class="text-xs font-medium ${textColorClass} truncate">
                            ${adultTag}${escapeAppHtml(api.name)}
                        </div>
                        ${latencyHtml}
                    </div>
                    <div class="text-xs text-gray-500 truncate">${escapeAppHtml(api.url)}</div>
                    ${detailLine}
                </div>
            </div>
            <div class="flex items-center ml-1">
                <button class="text-blue-500 hover:text-blue-700 text-xs px-1" onclick="editCustomApi(${index})">✎</button>
                <button class="text-red-500 hover:text-red-700 text-xs px-1" onclick="removeCustomApi(${index})">✕</button>
            </div>
        `;
        container.appendChild(apiItem);
        apiItem.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
}

// 编辑自定义API
function editCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const api = customAPIs[index];
    document.getElementById('customApiName').value = api.name;
    document.getElementById('customApiUrl').value = api.url;
    document.getElementById('customApiDetail').value = api.detail || '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = api.isAdult || false;
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
        const buttonContainer = form.querySelector('div:last-child');
        buttonContainer.innerHTML = `
            <button onclick="updateCustomApi(${index})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">更新</button>
            <button onclick="cancelEditCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
        `;
    }
}

// 更新自定义API
function updateCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);
    // 保存 detail 字段
    customAPIs[index] = { name, url, detail, isAdult };
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    renderCustomAPIsList();
    checkAdultAPIsSelected();
    restoreAddCustomApiButtons();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已更新自定义API: ' + name, 'success');
}

// 取消编辑自定义API
function cancelEditCustomApi() {
    // 清空表单
    document.getElementById('customApiName').value = '';
    document.getElementById('customApiUrl').value = '';
    document.getElementById('customApiDetail').value = '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = false;

    // 隐藏表单
    document.getElementById('addCustomApiForm').classList.add('hidden');

    // 恢复添加按钮
    restoreAddCustomApiButtons();
}

// 恢复自定义API添加按钮
function restoreAddCustomApiButtons() {
    const form = document.getElementById('addCustomApiForm');
    const buttonContainer = form.querySelector('div:last-child');
    buttonContainer.innerHTML = `
        <button onclick="addCustomApi()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">添加</button>
        <button onclick="cancelAddCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
    `;
}

// 更新选中的API列表
function updateSelectedAPIs() {
    // 获取所有内置API复选框
    const builtInApiCheckboxes = document.querySelectorAll('#apiCheckboxes input:checked');

    // 获取选中的内置API
    const builtInApis = Array.from(builtInApiCheckboxes).map(input => input.dataset.api);

    // 获取选中的自定义API
    const customApiCheckboxes = document.querySelectorAll('#customApisList input:checked');
    const customApiIndices = Array.from(customApiCheckboxes).map(input => 'custom_' + input.dataset.customIndex);

    // 合并内置和自定义API
    selectedAPIs = [...builtInApis, ...customApiIndices];

    // 保存到localStorage
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 更新显示选中的API数量
    updateSelectedApiCount();
}

// 更新选中的API数量显示
function updateSelectedApiCount() {
    const countEl = document.getElementById('selectedApiCount');
    if (countEl) {
        countEl.textContent = selectedAPIs.length;
    }
}

// 全选或取消全选API
function selectAllAPIs(selectAll = true, excludeAdult = false) {
    const checkboxes = document.querySelectorAll('#apiCheckboxes input[type="checkbox"]');

    checkboxes.forEach(checkbox => {
        if (excludeAdult && checkbox.classList.contains('api-adult')) {
            checkbox.checked = false;
        } else {
            checkbox.checked = selectAll;
        }
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();
}

// 全选优质资源（质量检测绿色：score >= 80），并自动排除成人源
function selectHighQualityAPIs(minScore = 80) {
    const checkboxes = document.querySelectorAll('#apiCheckboxes input[type="checkbox"]');
    let selectedCount = 0;

    checkboxes.forEach(checkbox => {
        const apiId = checkbox.dataset.api;
        if (!apiId) return;

        // 排除成人源
        if (checkbox.classList.contains('api-adult')) {
            checkbox.checked = false;
            return;
        }

        const score = apiQualities?.[apiId]?.score;
        const isHighQuality = typeof score === 'number' && score >= minScore;
        checkbox.checked = isHighQuality;
        if (isHighQuality) selectedCount += 1;
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();

    try {
        showToast && showToast(`已选择优质资源：${selectedCount} 个`, 'success');
    } catch (_) {}
}

// 显示添加自定义API表单
function showAddCustomApiForm() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
    }
}

// 取消添加自定义API - 修改函数来重用恢复按钮逻辑
function cancelAddCustomApi() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('customApiName').value = '';
        document.getElementById('customApiUrl').value = '';
        document.getElementById('customApiDetail').value = '';
        const isAdultInput = document.getElementById('customApiIsAdult');
        if (isAdultInput) isAdultInput.checked = false;

        // 确保按钮是添加按钮
        restoreAddCustomApiButtons();
    }
}

// 添加自定义API
function addCustomApi() {
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // 保存 detail 字段
    customAPIs.push({ name, url, detail, isAdult });
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    const newApiIndex = customAPIs.length - 1;
    selectedAPIs.push('custom_' + newApiIndex);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已添加自定义API: ' + name, 'success');
}

// 移除自定义API
function removeCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;

    const apiName = customAPIs[index].name;

    // 从列表中移除API
    customAPIs.splice(index, 1);
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 从选中列表中移除此API
    const customApiId = 'custom_' + index;
    selectedAPIs = selectedAPIs.filter(id => id !== customApiId);

    // 更新大于此索引的自定义API索引
    selectedAPIs = selectedAPIs.map(id => {
        if (id.startsWith('custom_')) {
            const currentIndex = parseInt(id.replace('custom_', ''));
            if (currentIndex > index) {
                return 'custom_' + (currentIndex - 1);
            }
        }
        return id;
    });

    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();

    // 更新选中的API数量
    updateSelectedApiCount();

    // 重新检查成人API选中状态
    checkAdultAPIsSelected();

    showToast('已移除自定义API: ' + apiName, 'info');
}

// 设置事件监听器
function setupEventListeners() {
    // 回车搜索
    document.getElementById('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            search();
        }
    });

    // 点击外部关闭设置面板和历史记录面板
    document.addEventListener('click', function (e) {
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.getElementById('settingsToggleButton');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            window.setDrawerOpenState?.('settingsPanel', 'settingsToggleButton', false);
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.getElementById('historyToggleButton');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            window.setDrawerOpenState?.('historyPanel', 'historyToggleButton', false);
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea() {
    window.cancelActiveSearch?.();
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';
    toggleClearButton();

    // 恢复搜索区域的样式
    document.getElementById('searchArea').classList.add('flex-1');
    document.getElementById('searchArea').classList.remove('mb-8');
    document.getElementById('resultsArea').classList.add('hidden');

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    try {
        window.history.pushState(
            {},
            `OpenStream - 免费在线视频搜索与观看平台`,
            `/`
        );
        // 更新页面标题
        document.title = `OpenStream - 免费在线视频搜索与观看平台`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

// 获取自定义API信息
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    if (isNaN(index) || index < 0 || index >= customAPIs.length) {
        return null;
    }
    return customAPIs[index];
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', hookInput);

// 显示详情 - 修改为支持自定义API
async function showDetails(id, vod_name, sourceCode) {
    if (!isPasswordReadyForApiCalls()) {
        window.showPasswordModal?.();
        return;
    }
    if (!id) {
        showToast('视频ID无效', 'error');
        return;
    }

    activeDetailAbortController?.abort();
    const requestSeq = ++activeDetailRequestSeq;
    const requestController = new AbortController();
    activeDetailAbortController = requestController;
    const isCurrentRequest = () => (
        requestSeq === activeDetailRequestSeq &&
        !requestController.signal.aborted
    );

    showLoading();
    try {
        // 构建API参数
        let apiParams = '';

        // 处理自定义API源
        if (sourceCode.startsWith('custom_')) {
            const customIndex = sourceCode.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceCode;
        }

        const isBridgeSource = window.OpenStreamSourceAdapter?.isBridgeSource?.(sourceCode);
        const bridgeDetail = isBridgeSource
            ? await window.OpenStreamSourceAdapter.detail(sourceCode, id, {
                signal: requestController.signal
            })
            : null;
        const data = isBridgeSource
            ? {
                episodes: (bridgeDetail?.episodes || []).filter(Boolean),
                videoInfo: bridgeDetail?.data?.videoInfo || bridgeDetail?.videoInfo || {}
            }
            : await fetchVideoDetailWithCache(id, apiParams, {
                signal: requestController.signal
            });

        if (!isCurrentRequest()) return;

        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');

        modalTitle.replaceChildren();
        const titleText = document.createElement('span');
        titleText.className = 'break-words';
        titleText.textContent = vod_name || '未知视频';
        modalTitle.appendChild(titleText);
        if (data.videoInfo?.source_name) {
            const sourceText = document.createElement('span');
            sourceText.className = 'text-sm font-normal text-gray-400';
            sourceText.textContent = ` (${data.videoInfo.source_name})`;
            modalTitle.appendChild(sourceText);
        }

        currentVideoTitle = vod_name || '未知视频';
        currentDetailSourceCode = sourceCode;
        currentDetailVideoId = id;

        if (data.episodes && data.episodes.length > 0) {
            // 构建详情信息HTML
            let detailInfoHtml = '';
            if (data.videoInfo) {
                // Prepare description text, strip HTML and trim whitespace
                const descriptionText = data.videoInfo.desc
                    ? escapeAppHtml(String(data.videoInfo.desc).replace(/<[^>]+>/g, '').trim())
                    : '';

                // Check if there's any actual grid content
                const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                if (hasGridContent || descriptionText) { // Only build if there's something to show
                    detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${data.videoInfo.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.type)}</span></div>` : ''}
                        ${data.videoInfo.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.year)}</span></div>` : ''}
                        ${data.videoInfo.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.area)}</span></div>` : ''}
                        ${data.videoInfo.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.director)}</span></div>` : ''}
                        ${data.videoInfo.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.actor)}</span></div>` : ''}
                        ${data.videoInfo.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${escapeAppHtml(data.videoInfo.remarks)}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${descriptionText}</p>
                    </div>` : ''}
                </div>
                `;
                }
            }

            currentEpisodes = data.episodes;
            currentEpisodeIndex = 0;

            modalContent.innerHTML = `
                ${detailInfoHtml}
                <div class="flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="flex items-center gap-2">
                        <button id="toggleEpisodeOrderBtn"
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span class="text-gray-400 text-sm">共 ${data.episodes.length} 集</span>
                    </div>
                    <button id="copyEpisodeLinksBtn" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
            bindDetailModalControls();
        } else {
            modalContent.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    } catch (error) {
        if (requestController.signal.aborted || error?.name === 'AbortError') return;
        console.error('获取详情错误:', error);
        showToast('获取详情失败，请稍后重试', 'error');
    } finally {
        if (requestSeq === activeDetailRequestSeq) {
            activeDetailAbortController = null;
            hideLoading();
        }
    }
}

function cancelActiveDetailRequest() {
    activeDetailRequestSeq += 1;
    activeDetailAbortController?.abort();
    activeDetailAbortController = null;
    hideLoading();
}

window.cancelActiveDetailRequest = cancelActiveDetailRequest;

// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
async function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {
    if (!isPasswordReadyForApiCalls()) {
        window.showPasswordModal?.();
        return;
    }

    let playableUrl = '';
    try {
        const resolved = await window.OpenStreamPlayerEpisodes.resolveEpisode(
            url,
            episodeIndex,
            { sourceKey: sourceCode, videoId: vodId }
        );
        if (resolved.status !== 'ready' || !resolved.url) {
            showToast(`当前剧集暂不可播放：${resolved.status || 'unknown'}`, 'error');
            return;
        }
        playableUrl = resolved.url;
    } catch (error) {
        console.error('播放地址解析失败:', error);
        showToast('播放地址解析失败，请尝试其他资源', 'error');
        return;
    }

    // 获取当前路径作为返回页面
    let currentPath = window.location.href;

    // 构建播放页面URL，使用watch.html作为中间跳转页
    let watchUrl = `watch.html?id=${encodeURIComponent(vodId || '')}&source=${encodeURIComponent(sourceCode || '')}&url=${encodeURIComponent(playableUrl)}&index=${episodeIndex}&title=${encodeURIComponent(vod_name || '')}`;

    // 添加返回URL参数
    if (currentPath.includes('index.html') || currentPath.endsWith('/')) {
        watchUrl += `&back=${encodeURIComponent(currentPath)}`;
    }

    // 保存当前状态到localStorage
    try {
        localStorage.setItem('currentVideoTitle', vod_name || '未知视频');
        localStorage.setItem('currentEpisodes', JSON.stringify(currentEpisodes));
        localStorage.setItem('currentEpisodeIndex', episodeIndex);
        localStorage.setItem('currentSourceCode', sourceCode || '');
        localStorage.setItem('lastPlayTime', Date.now());
        localStorage.setItem('lastSearchPage', currentPath);
        localStorage.setItem('lastPageUrl', currentPath);  // 确保保存返回页面URL
    } catch (e) {
        console.error('保存播放状态失败:', e);
    }

    // 在当前标签页中打开播放页面
    window.location.href = watchUrl;
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = currentEpisodes[prevIndex];
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = currentEpisodes[nextIndex];
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        return `
            <button id="episode-${realIndex}" data-detail-episode-index="${realIndex}"
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    }).join('');
}

function bindDetailModalControls() {
    document.getElementById('toggleEpisodeOrderBtn')?.addEventListener('click', () => {
        toggleEpisodeOrder(currentDetailSourceCode, currentDetailVideoId);
    });
    document.getElementById('copyEpisodeLinksBtn')?.addEventListener('click', copyLinks);
    document.getElementById('episodesGrid')?.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-detail-episode-index]');
        if (!button) return;
        const index = Number.parseInt(button.dataset.detailEpisodeIndex || '', 10);
        if (!Number.isInteger(index) || !currentEpisodes[index]) return;
        playVideo(
            currentEpisodes[index],
            currentVideoTitle,
            currentDetailSourceCode,
            index,
            currentDetailVideoId
        );
    });
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes
        .map((episode) => typeof episode === 'string' ? episode : episode?.url)
        .filter(Boolean)
        .join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.getElementById('toggleEpisodeOrderBtn');
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

function getPortableConfigKeys() {
    return new Set([
        'selectedAPIs',
        'customAPIs',
        'yellowFilterEnabled',
        'adFilteringEnabled',
        'doubanEnabled',
        'hasInitializedDefaults',
        SEARCH_FILTERS_CONFIG.storageKey,
        'viewingHistory',
        SEARCH_HISTORY_KEY
    ]);
}

function parseImportedJsonValue(key, value) {
    try {
        return JSON.parse(value);
    } catch (_) {
        throw `配置项 ${key} 不是有效的 JSON`;
    }
}

function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(String(value || '')).protocol);
    } catch (_) {
        return false;
    }
}

function validatePortableConfigValue(key, value) {
    const booleanKeys = new Set([
        'yellowFilterEnabled',
        'adFilteringEnabled',
        'doubanEnabled',
        'hasInitializedDefaults'
    ]);
    if (booleanKeys.has(key)) {
        if (!['true', 'false'].includes(value)) throw `配置项 ${key} 必须是布尔值`;
        return;
    }

    const parsed = parseImportedJsonValue(key, value);
    if (key === 'selectedAPIs') {
        if (
            !Array.isArray(parsed) ||
            parsed.length > 200 ||
            parsed.some(item => typeof item !== 'string' || item.length > 100)
        ) {
            throw 'selectedAPIs 格式不正确';
        }
        return;
    }

    if (key === 'customAPIs') {
        const invalid = !Array.isArray(parsed) || parsed.length > 100 || parsed.some(item => (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            item.name.length > 100 ||
            typeof item.url !== 'string' ||
            item.url.length > 2048 ||
            !isHttpUrl(item.url) ||
            (item.detail !== undefined && (
                typeof item.detail !== 'string' ||
                item.detail.length > 2048
            )) ||
            (item.isAdult !== undefined && typeof item.isAdult !== 'boolean')
        ));
        if (invalid) throw 'customAPIs 格式不正确';
        return;
    }

    if (key === SEARCH_FILTERS_CONFIG.storageKey) {
        const validTypes = new Set(SEARCH_FILTERS_CONFIG.types.map(item => item.value));
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            !validTypes.has(parsed.type || 'all') ||
            !(/^$|^\d{4}$/).test(String(parsed.year || '')) ||
            typeof (parsed.genre || '') !== 'string' ||
            String(parsed.genre || '').length > 32
        ) {
            throw 'searchFilters 格式不正确';
        }
        return;
    }

    if (key === 'viewingHistory' || key === SEARCH_HISTORY_KEY) {
        if (!Array.isArray(parsed) || parsed.length > 200) {
            throw `配置项 ${key} 格式不正确`;
        }
    }
}

function applyImportedConfigData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw '配置数据格式不正确';
    }

    const allowedKeys = getPortableConfigKeys();
    const stagedEntries = [];
    for (const [key, value] of Object.entries(data)) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value !== 'string' || value.length > 1024 * 1024) {
            throw `配置项 ${key} 格式不正确`;
        }
        validatePortableConfigValue(key, value);
        stagedEntries.push([key, value]);
    }

    if (stagedEntries.length === 0) {
        throw '配置文件中没有可导入的设置';
    }

    const previousValues = new Map(
        stagedEntries.map(([key]) => [key, localStorage.getItem(key)])
    );
    try {
        stagedEntries.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
        stagedEntries.forEach(([key]) => {
            try {
                localStorage.removeItem(key);
            } catch (_) {}
        });
        previousValues.forEach((value, key) => {
            if (value === null) return;
            try {
                localStorage.setItem(key, value);
            } catch (_) {}
        });
        throw error;
    }
}

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            if (!['LibreTV-Settings', 'NovaStream-Settings', 'OpenStream-Settings'].includes(config.name)) throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            applyImportedConfigData(config.data);

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            // 解析并验证配置
            const config = JSON.parse(content);
            if (!['LibreTV-Settings', 'NovaStream-Settings', 'OpenStream-Settings'].includes(config.name)) throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            applyImportedConfigData(config.data);

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 配置文件导出功能
async function exportConfig() {
    // 存储配置数据
    const config = {};
    const items = {};

    const settingsToExport = getPortableConfigKeys();

    // 导出设置项
    settingsToExport.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            items[key] = value;
        }
    });

    const times = Date.now().toString();
    config['name'] = 'OpenStream-Settings';  // 配置文件名，用于校验
    config['time'] = times;               // 配置文件生成时间
    config['cfgVer'] = '1.0.0';           // 配置文件版本
    config['data'] = items;               // 配置文件数据
    config['hash'] = await sha256(JSON.stringify(config['data']));  // 计算数据的哈希值，用于校验

    // 将配置数据保存为 JSON 文件
    saveStringAsFile(JSON.stringify(config), 'OpenStream-Settings_' + times + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// 根据延迟质量选择API
function selectApisByLatency(quality) {
    if (Object.keys(apiLatencies).length === 0) {
        showToast('请先进行测速', 'error');
        return;
    }

    // 定义质量阈值
    const thresholds = {
        excellent: { min: 0, max: 500 },    // 优质: < 500ms
        good: { min: 500, max: 700 },       // 普通: 500-700ms
        poor: { min: 700, max: 1000 }       // 低质: 700-1000ms
    };

    const threshold = thresholds[quality];
    if (!threshold) return;

    // 清空当前选择
    selectedAPIs = [];

    // 选择符合条件的内置API
    Object.keys(API_SITES).forEach(apiKey => {
        const latency = apiLatencies[apiKey];
        if (latency !== undefined && latency >= threshold.min && latency < threshold.max) {
            selectedAPIs.push(apiKey);
        }
    });

    // 选择符合条件的自定义API
    customAPIs.forEach((api, index) => {
        const latency = apiLatencies['custom_' + index];
        if (latency !== undefined && latency >= threshold.min && latency < threshold.max) {
            selectedAPIs.push('custom_' + index);
        }
    });

    // 更新UI和本地存储
    initAPICheckboxes();
    renderCustomAPIsList();
    updateSelectedApiCount();
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    const qualityNames = {
        excellent: '优质',
        good: '普通',
        poor: '低质'
    };
    showToast(`已选择${selectedAPIs.length}个${qualityNames[quality]}资源`, 'success');
}

// 测速并排序所有API源
async function testAllApiLatency() {
    const btn = document.getElementById('testSpeedBtn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = `<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 测速中...`;

    try {
        showToast('正在对所有数据源进行测速，请稍候...', 'info');

        // 获取所有需要测试的API（仅测试内置API，跳过自定义API）
        const builtinApis = Object.keys(API_SITES);
        const allApiIds = [...builtinApis]; // 不包含自定义API

        console.log(`开始测速，共${allApiIds.length}个内置API源`);

        // 并行测试延迟，提高并发数以加快测速
        const concurrency = 10; // 从5提升到10
        const results = [];

        for (let i = 0; i < allApiIds.length; i += concurrency) {
            const batch = allApiIds.slice(i, i + concurrency);
            const batchPromises = batch.map(async (apiId) => {
                let apiUrl;
                if (apiId.startsWith('custom_')) {
                    const index = parseInt(apiId.replace('custom_', ''));
                    apiUrl = customAPIs[index].url;
                } else {
                    apiUrl = API_SITES[apiId].api;
                }

                const latency = await measureApiLatency(apiUrl);
                console.log(`${apiId}: ${latency}ms`);
                return { apiId, latency };
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        console.log('测速完成，处理结果...');

        // 更新全局延迟数据和时间戳
        results.forEach(res => {
            apiLatencies[res.apiId] = res.latency;
        });
        latencyTestTime = Date.now();

        // 保存到localStorage
        saveLatencyCache();

        // 自动选择延迟最低的前5个资源
        const sortedResults = results
            .filter(res => res.latency < 9999) // 排除失败的API
            .sort((a, b) => a.latency - b.latency) // 按延迟升序排序
            .slice(0, 5); // 取前5个

        selectedAPIs = sortedResults.map(res => res.apiId);
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        // 重新初始化UI以应用排序和显示延迟
        initAPICheckboxes();
        renderCustomAPIsList();
        updateSelectedApiCount();

        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;

        // 更新测速时间显示
        updateLatencyTimeDisplay();

        showToast(`测速完成！已自动选择延迟最低的${selectedAPIs.length}个资源`, 'success');
    } catch (error) {
        console.error('测速过程出错:', error);
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
        showToast('测速失败: ' + error.message, 'error');
    }
}

// 质量检测：更贴近真实播放体验（搜索 + 详情 + 首集链接可达性）
async function testAllApiQuality(options = {}) {
    const { silent = false } = options;
    const btn = document.getElementById('testSpeedBtn');
    if (!btn || btn.disabled) return;

    // 没有完成密码验证时，/api/* 可能被拦截成空响应，导致“瞬间完成且全 0 分”
    if (!isPasswordReadyForApiCalls()) {
        try {
            if (typeof showPasswordModal === 'function') showPasswordModal();
        } catch (_) {}
        if (!silent) showToast('请先完成密码验证后再进行质量检测', 'warning');
        return;
    }

    btn.disabled = true;
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = `<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 检测中...`;

    try {
        await ensureQualityRuntime();
        if (!silent) showToast('正在对所有数据源进行质量检测（先测搜索/详情，再抽样测播放），请稍候...', 'info');

        const builtinApis = Object.keys(API_SITES);
        // 两阶段：先全量测搜索+详情，再只对候选源测播放。
        // 动态并发池不会让一个慢源阻塞下一整批任务。
        const baseConcurrency = 10;
        const playConcurrency = 5;
        const baseResults = await window.OpenStreamQualitySelection.mapWithConcurrency(builtinApis, {
            concurrency: baseConcurrency,
            worker: (id) => measureApiQuality(id, {
                playTest: false,
                searchTimeoutMs: 7_000,
                detailTimeoutMs: 9_000
            })
        });

        // 候选：有集数的源里按详情耗时排序，分批验证直到拿到 5 个可播放源。
        const candidates = baseResults
            .filter(r => r.quality?.detailOk && (r.quality.episodesCount || 0) > 0)
            .sort((a, b) => {
                const am = typeof a.quality.detailMs === 'number' ? a.quality.detailMs : 1e9;
                const bm = typeof b.quality.detailMs === 'number' ? b.quality.detailMs : 1e9;
                return am - bm;
            });

        const playResults = await window.OpenStreamQualitySelection.testCandidatesUntilLimit(candidates, {
            batchSize: playConcurrency,
            limit: 5,
            test: (result) => measureApiQuality(result.apiId, {
                playTest: true,
                seed: result
            })
        });

        // 合并：以 baseResults 为底，候选用 playResults 覆盖
        const playMap = new Map(playResults.map(r => [r.apiId, r]));
        const results = baseResults.map(r => playMap.get(r.apiId) || r);

        const testedAt = Date.now();
        results.forEach(res => {
            apiQualities[res.apiId] = { ...res.quality, testedAt, passive: false };
            // 兼容旧逻辑：把搜索耗时也存到 apiLatencies，便于没有质量分时展示
            if (typeof res.quality?.searchMs === 'number') {
                apiLatencies[res.apiId] = res.quality.searchMs;
            }
            const healthStatus = getQualityHealthStatus(res.quality);
            if (healthStatus) {
                window.OpenStreamSourceHealth?.recordSourceEvent?.(res.apiId, {
                    status: healthStatus,
                    ms: res.quality.playTtfbMs ?? res.quality.detailMs ?? res.quality.searchMs,
                    verifiedPlayable: healthStatus === 'ready'
                });
            }
        });

        qualityTestTime = testedAt;
        // 保留旧字段，避免只读依赖 latencyTestTime 的逻辑失效
        latencyTestTime = qualityTestTime;

        saveQualityCache();
        saveLatencyCache();
        window.OpenStreamSourceHealth?.refreshStoredMetrics?.();

        // 只自动选择真实通过播放首包验证的源，不用未验证候选补足数量。
        const preferred = window.OpenStreamQualitySelection
            .selectVerifiedPlayable(results, 5)
            .map((result) => result.apiId);
        selectedAPIs = preferred;
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        initAPICheckboxes();
        renderCustomAPIsList();
        updateSelectedApiCount();
        updateLatencyTimeDisplay();

        if (!silent) {
            const message = selectedAPIs.length > 0
                ? `检测完成！已自动选择${selectedAPIs.length}个验证可播放的资源`
                : '检测完成，但本次没有验证出可播放资源';
            showToast(message, selectedAPIs.length > 0 ? 'success' : 'warning');
        }
    } catch (error) {
        console.error('质量检测过程出错:', error);
        if (!silent) showToast('质量检测失败: ' + (error?.message || '未知错误'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
    }
}

function createAbortError(reason, fallbackMessage = '请求已取消') {
    const error = reason instanceof Error ? reason : new Error(fallbackMessage);
    error.name = 'AbortError';
    return error;
}

async function runWithAbortableTimeout(factory, timeoutMs, label, externalSignal) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        throw createAbortError(externalSignal.reason);
    }
    externalSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timeoutId = setTimeout(() => controller.abort(new Error(label || `超时(${timeoutMs}ms)`)), timeoutMs);
    try {
        return await factory(controller.signal);
    } catch (error) {
        if (externalSignal?.aborted) throw createAbortError(externalSignal.reason);
        if (controller.signal.aborted) {
            const timeoutError = new Error(label || `超时(${timeoutMs}ms)`);
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', abortFromParent);
    }
}

async function measureTtfb(url, timeoutMs, externalSignal) {
    const t0 = performance.now();
    try {
        return await runWithAbortableTimeout(async (signal) => {
            const res = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                mode: 'cors',
                signal
            });
            if (!res.ok) {
                return { ok: false, ms: Math.round(performance.now() - t0), status: res.status };
            }
            if (!res.body || !res.body.getReader) {
                return { ok: true, ms: Math.round(performance.now() - t0), status: res.status, note: 'no-stream' };
            }
            const reader = res.body.getReader();
            await reader.read();
            try { await reader.cancel(); } catch (_) {}
            return { ok: true, ms: Math.round(performance.now() - t0), status: res.status };
        }, timeoutMs, `播放首包超时(${timeoutMs}ms)`, externalSignal);
    } catch (e) {
        if (externalSignal?.aborted) throw createAbortError(externalSignal.reason);
        const ms = Math.round(performance.now() - t0);
        return { ok: false, ms, error: e?.name === 'TimeoutError' ? '超时' : (e?.message || '失败') };
    }
}

async function probePlaybackQuality(url, timeoutMs, externalSignal) {
    const startedAt = performance.now();
    try {
        return await runWithAbortableTimeout(async (signal) => {
            const probe = window.OpenStreamPlaybackQuality?.probePlayback;
            if (typeof probe !== 'function') {
                const fallback = await measureTtfb(url, timeoutMs, signal);
                return {
                    ...fallback,
                    playOk: !!fallback.ok,
                    segmentOk: false
                };
            }
            return probe(url, { signal });
        }, timeoutMs, `播放链路检测超时(${timeoutMs}ms)`, externalSignal);
    } catch (error) {
        if (externalSignal?.aborted) throw createAbortError(externalSignal.reason);
        return {
            ok: false,
            playOk: false,
            segmentOk: false,
            ms: Math.round(performance.now() - startedAt),
            error: error?.name === 'TimeoutError' ? '超时' : (error?.message || '失败')
        };
    }
}

function computeQualityScore(q) {
    let score = 0;
    if (q.searchOk) score += 20;
    if (q.detailOk) score += 20;
    if ((q.episodesCount || 0) > 0) score += 10;
    if ((q.episodesCount || 0) >= 10) score += 5;
    if (q.playOk) score += 15;
    if (q.segmentOk) score += 30;

    // 延迟惩罚（轻惩罚，避免“延迟高但播放好”被误杀）
    const penalty = (ms, w) => {
        if (typeof ms !== 'number' || ms <= 0) return 0;
        if (ms <= 1000) return 0;
        return Math.min(w, Math.log(ms / 1000) * w);
    };
    score -= penalty(q.searchMs, 8);
    score -= penalty(q.detailMs, 12);
    score -= penalty(q.playTtfbMs, 15);
    score -= penalty(q.segmentTtfbMs, 10);

    if (!q.searchOk) score = 0;
    return Math.max(0, Math.min(100, Math.round(score)));
}

async function measureApiQuality(apiId, opts) {
    const options = { playTest: true, ...(opts || {}) };
    const quality = {
        score: 0,
        searchOk: false,
        detailOk: false,
        playOk: false,
        segmentOk: false,
        searchMs: null,
        detailMs: null,
        playTtfbMs: null,
        segmentTtfbMs: null,
        searchStatus: null,
        detailStatus: null,
        playStatus: null,
        playTested: false,
        episodesCount: 0,
        error: null
    };

    let currentPhase = 'setup';
    try {
        const adapter = window.OpenStreamSourceAdapter;
        if (!adapter?.search || !adapter?.detail) {
            throw new Error('统一源适配器未就绪');
        }

        const sharedOptions = {
            signal: options.signal,
            bypassCache: options.bypassCache !== false
        };
        let vodId = options.seed?.sample?.vodId || '';
        let episodes = Array.isArray(options.seed?.sample?.episodes)
            ? options.seed.sample.episodes
            : [];

        if (vodId && episodes.length > 0 && options.seed?.quality) {
            Object.assign(quality, options.seed.quality, {
                playOk: false,
                segmentOk: false,
                playTtfbMs: null,
                playStatus: null,
                playTested: false,
                error: null
            });
        } else {
            currentPhase = 'search';
            const searchStart = performance.now();
            const searchResult = await runWithAbortableTimeout(
                (signal) => adapter.search(apiId, '庆余年', {}, { ...sharedOptions, maxPages: 1, signal }),
                options.searchTimeoutMs || 12_000,
                '资源搜索超时',
                options.signal
            );
            quality.searchMs = Math.round(performance.now() - searchStart);
            quality.searchStatus = searchResult?.status || null;
            const effectiveList = Array.isArray(searchResult?.list) ? searchResult.list : [];
            quality.searchOk = searchResult?.status === adapter.STATUS.READY && effectiveList.length > 0;
            vodId = effectiveList[0]?.vod_id || '';

            if (!vodId) {
                quality.error = searchResult?.message || searchResult?.status || '无搜索结果';
                quality.score = computeQualityScore(quality);
                return { apiId, quality };
            }

            currentPhase = 'detail';
            const detailStart = performance.now();
            const detailResult = await runWithAbortableTimeout(
                (signal) => adapter.detail(apiId, vodId, { ...sharedOptions, signal }),
                options.detailTimeoutMs || 15_000,
                '资源详情超时',
                options.signal
            );
            quality.detailMs = Math.round(performance.now() - detailStart);
            quality.detailStatus = detailResult?.status || null;
            episodes = Array.isArray(detailResult?.episodes) ? detailResult.episodes : [];
            quality.episodesCount = episodes.length;
            quality.detailOk = detailResult?.status === adapter.STATUS.READY && episodes.length > 0;

            if (!quality.detailOk) {
                quality.error = detailResult?.message || detailResult?.status || '详情失败';
                quality.score = computeQualityScore(quality);
                return { apiId, quality };
            }
        }

        if (options.playTest) {
            currentPhase = 'play';
            quality.playTested = true;
            let playUrl = episodes[0]?.url || episodes[0];
            quality.playStatus = playUrl ? 'ready' : 'unsupported';
            if (adapter.isBridgeSource?.(apiId)) {
                const playStart = performance.now();
                const playResult = await runWithAbortableTimeout(
                    (signal) => adapter.play(apiId, vodId, episodes[0]?.flag || '', 0, { ...sharedOptions, signal }),
                    options.playResolveTimeoutMs || 15_000,
                    '播放地址解析超时',
                    options.signal
                );
                quality.playTtfbMs = Math.round(performance.now() - playStart);
                quality.playStatus = playResult?.status || 'error';
                playUrl = playResult?.url || '';
            }

            if (playUrl) {
                playUrl = window.OpenStreamPlayerEpisodes?.normalizePlaybackUrl?.(playUrl, apiId) || playUrl;
                const proxiedPlayUrl = await window.ProxyAuth?.addAuthToProxyUrl
                    ? await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(playUrl))
                    : PROXY_URL + encodeURIComponent(playUrl);
                const playProbe = await probePlaybackQuality(
                    proxiedPlayUrl,
                    options.playProbeTimeoutMs || 8_000,
                    options.signal
                );
                quality.playOk = !!playProbe.playOk;
                quality.segmentOk = !!playProbe.segmentOk;
                quality.playStatus = playProbe.ok
                    ? 'ready'
                    : (
                        [408, 429, 502, 503, 504].includes(playProbe.status) ||
                        /超时|timed out/i.test(String(playProbe.error || ''))
                            ? 'timeout'
                            : (playProbe.inconclusive ? 'unknown' : 'unplayable')
                    );
                quality.playTtfbMs = (quality.playTtfbMs || 0) + playProbe.ms;
                if (!playProbe.ok) quality.error = playProbe.error || '播放链路检测失败';
            } else if (!quality.error) {
                quality.error = quality.playStatus || '播放地址无效';
            }
        }

        quality.score = computeQualityScore(quality);
        return { apiId, quality, sample: { vodId, episodes } };
    } catch (e) {
        if (options.signal?.aborted || e?.name === 'AbortError') throw createAbortError(options.signal?.reason || e);
        const status = (
            e?.name === 'TimeoutError' ||
            [408, 429, 502, 503, 504].includes(Number(e?.status)) ||
            /超时|timed out/i.test(String(e?.message || ''))
        ) ? 'timeout' : 'error';
        if (currentPhase === 'search') quality.searchStatus = status;
        if (currentPhase === 'detail') quality.detailStatus = status;
        if (currentPhase === 'play') quality.playStatus = status;
        quality.error = e?.message || '检测失败';
        quality.score = computeQualityScore(quality);
        return { apiId, quality };
    }
}

// 测量单个API的延迟
async function measureApiLatency(apiUrl) {
    const start = performance.now();
    try {
        // 使用一个极简的搜索请求来测试延迟
        // 我们通过 handleApiRequest 拦截这个请求，它会走代理
        const response = await fetch('/api/search?wd=1&customApi=' + encodeURIComponent(apiUrl), {
            signal: AbortSignal.timeout(3000) // 3秒超时（从5秒优化到3秒）
        });

        if (!response.ok) {
            return 9999; // 请求失败视为极高延迟
        }

        const end = performance.now();
        const latency = Math.round(end - start);
        // 不再限制返回值，保留真实延迟
        return latency;
    } catch (error) {
        console.warn(`测速失败 (${apiUrl}):`, error);
        return 9999; // 超时或错误
    }
}

// 获取相对时间显示
function getRelativeTime(timestamp) {
    if (!timestamp) return '';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}min ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// 更新测速时间显示
function updateLatencyTimeDisplay() {
    const timeElement = document.getElementById('latencyTestTime');
    if (!timeElement) return;
    const ts = qualityTestTime || latencyTestTime;
    if (ts) {
        timeElement.textContent = `检测时间: ${getRelativeTime(ts)}`;
    } else {
        timeElement.textContent = '';
    }
}

// 移除Node.js的require语句，因为这是在浏览器环境中运行的

// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表 - 修改为默认标签
let defaultMovieTags = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '日综', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
let defaultTvTags = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '综艺'];

// 用户标签列表 - 存储用户实际使用的标签（包含保留的系统标签和用户添加的自定义标签）
let movieTags = [];
let tvTags = [];

function normalizeTagValue(value) {
    const tag = typeof value === 'string' ? value.trim() : '';
    if (!tag || tag.length > 20 || /[<>"'`\\\u0000-\u001f]/u.test(tag)) return '';
    return tag;
}

function normalizeStoredTags(value, fallback) {
    const input = Array.isArray(value) ? value : fallback;
    return Array.from(new Set(
        input
            .map(normalizeTagValue)
            .filter(Boolean)
    )).slice(0, 40);
}

// 加载用户标签
function loadUserTags() {
    try {
        // 尝试从本地存储加载用户保存的标签
        const savedMovieTags = localStorage.getItem('userMovieTags');
        const savedTvTags = localStorage.getItem('userTvTags');
        
        // 如果本地存储中有标签数据，则使用它
        if (savedMovieTags) {
            movieTags = normalizeStoredTags(JSON.parse(savedMovieTags), defaultMovieTags);
        } else {
            // 否则使用默认标签
            movieTags = [...defaultMovieTags];
        }
        
        if (savedTvTags) {
            tvTags = normalizeStoredTags(JSON.parse(savedTvTags), defaultTvTags);
        } else {
            // 否则使用默认标签
            tvTags = [...defaultTvTags];
        }
        tvTags = sanitizeTvTags(tvTags);
    } catch (e) {
        console.error('加载标签失败：', e);
        // 初始化为默认值，防止错误
        movieTags = [...defaultMovieTags];
        tvTags = [...defaultTvTags];
    }
}

// 保存用户标签
function saveUserTags() {
    try {
        localStorage.setItem('userMovieTags', JSON.stringify(movieTags));
        tvTags = sanitizeTvTags(tvTags);
        localStorage.setItem('userTvTags', JSON.stringify(tvTags));
    } catch (e) {
        console.error('保存标签失败：', e);
        showToast('保存标签失败', 'error');
    }
}

function sanitizeTvTags(tags) {
    const blocked = new Set(['日本动画', '纪录片']);
    const input = normalizeStoredTags(tags, defaultTvTags);
    const next = input.filter(tag => tag && !blocked.has(tag));
    if (!next.includes('热门')) {
        next.unshift('热门');
    }
    return Array.from(new Set(next));
}

let doubanMovieTvCurrentSwitch = 'movie';
let doubanCurrentTag = '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量
let doubanCurrentCategory = 'movie'; // movie | tv | anime | variety
let doubanMode = 'recommend'; // recommend | filter
let doubanFilterYear = '';
let doubanFilterGenre = '';
let doubanFilterSort = 'latest';
let doubanDisplayPage = 1;
let doubanPrefetchInFlight = false;
let doubanFilterRenderTimer = null;
let doubanFilterRequestSeq = 0;
let doubanRenderSeq = 0;
let doubanActiveAbortController = null;
let doubanRecommendAbortController = null;
let doubanPrefetchAbortController = null;
let doubanPaginationAbortController = null;
let doubanPaginationRequestSeq = 0;
let doubanEnsureQueue = Promise.resolve();
let doubanInitReady = false;
let doubanInitialized = false;
const doubanDisplayPageSize = 16;
const doubanMaxSourcePages = 12;
const doubanMetaCache = new Map();
const DOUBAN_FILTER_FETCH_PAGE_SIZE = 20;
const PREFETCH_WINDOW_SIZE = 2;
const PREFETCH_AHEAD_LIMIT = 6;
const FILTER_RENDER_DEBOUNCE_MS = 180;
const DOUBAN_META_CONCURRENCY = 8;
const DOUBAN_PAGE_DOM_CACHE_LIMIT = 24;
const DOUBAN_DATA_CACHE_LIMIT = 180;
const DOUBAN_POSTER_FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMjAwIDMwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIzMDAiIGZpbGw9IiMxMTExMTEiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iIzY2NiIgZm9udC1zaXplPSIxNCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+5peg5rOV6K6+5aSHPC90ZXh0Pjwvc3ZnPg==';
let doubanFilterCache = {
    key: '',
    items: [],
    sourceOffset: 0,
    exhausted: false,
    prefetchMaxPage: 2,
    sourceTags: [],
    sourceTagIndex: 0,
    sourceTagOffsets: {}
};
const doubanPageDomCache = new Map();
const doubanDataCache = new Map();
const doubanDataInFlight = new Map();
const doubanCardContainersBound = new WeakSet();
const DOUBAN_MODE_KEY = 'doubanMode';
const DOUBAN_FILTER_STATE_KEY = 'doubanFilterState';
let doubanRecommendState = {
    category: 'movie',
    tag: '热门',
    pageStart: 0
};
let doubanFilterState = {
    category: 'movie',
    year: '',
    genre: '',
    sort: 'latest',
    displayPage: 1,
    prefetchMaxPage: 2
};

const DOUBAN_SORT_OPTIONS = [
    { value: 'latest', label: '最新', apiSort: 'R' },
    { value: 'rating', label: '豆瓣高分', apiSort: 'S' },
    { value: 'hot', label: '最多评价', apiSort: 'T' },
];

const DOUBAN_GENRES_BY_CATEGORY = {
    movie: ['剧情', '爱情', '喜剧', '动作', '科幻', '悬疑', '惊悚', '犯罪', '冒险', '动画', '战争', '历史', '奇幻', '家庭', '纪录片'],
    tv: ['剧情', '爱情', '悬疑', '古装', '历史', '都市', '家庭', '职场', '喜剧', '犯罪'],
    anime: ['热血', '奇幻', '科幻', '校园', '治愈', '冒险', '搞笑'],
    variety: ['真人秀', '脱口秀', '音乐', '访谈', '竞技'],
};

const DOUBAN_ADVANCED_CATEGORY_TAGS = {
    movie: '电影',
    tv: '电视剧',
    anime: '动画',
    variety: '综艺',
};

const doubanCategoryConfig = {
    movie: {
        label: '电影',
        sourceType: 'movie',
        defaultTag: '热门',
        typeKeywords: ['电影', '剧情', '动作', '爱情', '科幻', '悬疑', '惊悚', '动画', '战争', '犯罪'],
    },
    tv: {
        label: '电视剧',
        sourceType: 'tv',
        defaultTag: '热门',
        typeKeywords: ['电视剧', '剧情', '家庭', '爱情', '悬疑', '古装', '历史', '都市'],
    },
    anime: {
        label: '动漫',
        sourceType: 'tv',
        defaultTag: '动漫',
        typeKeywords: ['动画', '动漫', '动画电影'],
    },
    variety: {
        label: '综艺',
        sourceType: 'tv',
        defaultTag: '综艺',
        typeKeywords: ['综艺', '真人秀', '脱口秀', '选秀'],
    },
};

function loadDoubanModeState() {
    try {
        const savedMode = localStorage.getItem(DOUBAN_MODE_KEY);
        if (savedMode === 'recommend' || savedMode === 'filter') {
            doubanMode = savedMode;
        }
    } catch (e) {
        console.warn('读取豆瓣模式失败：', e);
    }

    try {
        const raw = localStorage.getItem(DOUBAN_FILTER_STATE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        doubanFilterState = {
            category: parsed.category || 'movie',
            year: parsed.year || '',
            genre: parsed.genre || '',
            sort: parsed.sort || 'latest',
            displayPage: Number(parsed.displayPage) > 0 ? Number(parsed.displayPage) : 1,
            prefetchMaxPage: Number(parsed.prefetchMaxPage) > 0 ? Number(parsed.prefetchMaxPage) : 2,
        };
    } catch (e) {
        console.warn('读取豆瓣筛选状态失败：', e);
    }
}

function saveDoubanModeState() {
    localStorage.setItem(DOUBAN_MODE_KEY, doubanMode);
}

function saveDoubanFilterState() {
    localStorage.setItem(DOUBAN_FILTER_STATE_KEY, JSON.stringify({
        category: doubanFilterState.category,
        year: doubanFilterState.year,
        genre: doubanFilterState.genre,
        sort: doubanFilterState.sort,
        displayPage: doubanFilterState.displayPage,
        prefetchMaxPage: doubanFilterState.prefetchMaxPage,
    }));
}

function syncDoubanModeStateFromRuntime() {
    if (doubanMode === 'recommend') {
        doubanRecommendState = {
            category: doubanCurrentCategory,
            tag: doubanCurrentTag,
            pageStart: doubanPageStart
        };
        return;
    }
    doubanFilterState = {
        category: doubanCurrentCategory,
        year: doubanFilterYear || '',
        genre: doubanFilterGenre || '',
        sort: doubanFilterSort || 'latest',
        displayPage: doubanDisplayPage || 1,
        prefetchMaxPage: doubanFilterCache.prefetchMaxPage || 2,
    };
    saveDoubanFilterState();
}

function doubanContainerNeedsRender(container) {
    return !!container && (
        container.children.length === 0 ||
        container.querySelector('.douban-skeleton-card')
    );
}

function isDoubanFeatureEnabled() {
    const stored = localStorage.getItem('doubanEnabled');
    if (stored !== null) return stored === 'true';
    return !localStorage.getItem('hasInitializedDefaults');
}

// 初始化豆瓣功能
function initDouban() {
    if (doubanInitialized) {
        updateDoubanVisibility();
        return;
    }
    doubanInitialized = true;

    // 设置豆瓣开关的初始状态
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = isDoubanFeatureEnabled();
        doubanToggle.checked = isEnabled;
        
        // 设置开关外观
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg.nextElementSibling;
        if (isEnabled) {
            toggleBg.classList.add('bg-orange-500');
            toggleDot.classList.add('translate-x-6');
        }
        
        // 添加事件监听
        doubanToggle.addEventListener('change', function(e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);
            
            // 更新开关外观
            if (isChecked) {
                toggleBg.classList.add('bg-orange-500');
                toggleDot.classList.add('translate-x-6');
            } else {
                toggleBg.classList.remove('bg-orange-500');
                toggleDot.classList.remove('translate-x-6');
            }
            
            // 更新显示状态
            updateDoubanVisibility();
        });
        
        // 初始更新显示状态
        updateDoubanVisibility();

        // 滚动到页面顶部
        window.scrollTo(0, 0);
    }

    // 加载用户标签与模式状态
    loadUserTags();
    loadDoubanModeState();

    // 渲染并绑定交互
    renderDoubanCategorySwitch();
    setupDoubanModeSwitch();
    setupDoubanFilterControls();
    setupDoubanRefreshBtn();

    // 初次切换模式（会恢复各模式状态）
    switchDoubanMode(doubanMode, { persist: false, forceRender: false });

    // 初始化完成后，才允许可见性逻辑触发自动加载，避免推荐/筛选竞态覆盖
    doubanInitReady = true;

    // 密码弹窗尚未验证时不抢跑代理请求；验证成功后由事件恢复。
    if (isDoubanFeatureEnabled() && isDoubanRequestReady()) {
        renderCurrentDoubanMode(true);
    }
}

function isDoubanRequestReady() {
    try {
        if (window.isAuthSessionReady?.() !== true) return false;
        return window.isPasswordVerified?.() === true;
    } catch (_) {
        return false;
    }
}

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;
    
    const isEnabled = isDoubanFeatureEnabled();
    document.documentElement.dataset.doubanInitial = isEnabled ? 'enabled' : 'disabled';
    const isSearching = document.getElementById('resultsArea') && 
        !document.getElementById('resultsArea').classList.contains('hidden');
    
    // 认证期间保留骨架高度，避免验证完成后整个推荐区突然插入导致 CLS。
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        if (!isDoubanRequestReady()) return;
        if (!doubanInitReady) return;
        // 如果豆瓣结果为空，重新加载
        if (doubanContainerNeedsRender(document.getElementById('douban-results'))) {
            renderCurrentDoubanMode(true);
        }
    } else {
        doubanArea.classList.add('hidden');
    }
}

document.addEventListener('passwordVerified', () => {
    updateDoubanVisibility();
});

function setupDoubanModeSwitch() {
    const recommendBtn = document.getElementById('douban-mode-recommend');
    const filterBtn = document.getElementById('douban-mode-filter');
    if (!recommendBtn || !filterBtn) return;
    recommendBtn.addEventListener('click', () => switchDoubanMode('recommend'));
    filterBtn.addEventListener('click', () => switchDoubanMode('filter'));
}

function applyDoubanModeUI() {
    const recommendBtn = document.getElementById('douban-mode-recommend');
    const filterBtn = document.getElementById('douban-mode-filter');
    const recommendActions = document.getElementById('douban-recommend-actions');
    const tagsWrap = document.getElementById('douban-tags-wrap');
    const filterControls = document.getElementById('douban-filter-controls');
    const filterMeta = document.getElementById('douban-filter-meta');
    const filterPagination = document.getElementById('douban-filter-pagination');

    const isRecommend = doubanMode === 'recommend';
    recommendBtn?.classList.toggle('is-active', isRecommend);
    filterBtn?.classList.toggle('is-active', !isRecommend);
    recommendActions?.classList.toggle('is-hidden', !isRecommend);
    tagsWrap?.classList.toggle('is-hidden', !isRecommend);
    filterControls?.classList.toggle('is-hidden', isRecommend);
    filterMeta?.classList.toggle('is-hidden', isRecommend);
    filterPagination?.classList.toggle('is-hidden', isRecommend);

    if (isRecommend) {
        document.getElementById('douban-pagination')?.classList.add('hidden');
    }
}

function renderCurrentDoubanMode(resetCache = true) {
    if (doubanMode === 'recommend') {
        return renderRecommendMode();
    }
    return renderFilterMode(resetCache);
}

function switchDoubanMode(mode, options = {}) {
    if (mode !== 'recommend' && mode !== 'filter') return;
    const { persist = true, forceRender = true } = options;
    cancelDoubanRequests();
    doubanMode = mode;
    if (persist) saveDoubanModeState();

    if (mode === 'recommend') {
        doubanCurrentCategory = doubanRecommendState.category || 'movie';
        const config = doubanCategoryConfig[doubanCurrentCategory] || doubanCategoryConfig.movie;
        doubanMovieTvCurrentSwitch = config.sourceType;
        doubanCurrentTag = doubanRecommendState.tag || getDefaultTagByCategory(doubanCurrentCategory);
        doubanPageStart = Number(doubanRecommendState.pageStart) || 0;
        renderDoubanTags();
    } else {
        doubanCurrentCategory = doubanFilterState.category || 'movie';
        const config = doubanCategoryConfig[doubanCurrentCategory] || doubanCategoryConfig.movie;
        doubanMovieTvCurrentSwitch = config.sourceType;
        doubanCurrentTag = getDefaultTagByCategory(doubanCurrentCategory);
        doubanFilterYear = doubanFilterState.year || '';
        doubanFilterGenre = doubanFilterState.genre || '';
        doubanFilterSort = doubanFilterState.sort || 'latest';
        // 刷新首次进入筛选，先从第一页展示，避免等待加载到历史页码
        doubanDisplayPage = 1;
        doubanFilterCache.prefetchMaxPage = Number(doubanFilterState.prefetchMaxPage) || PREFETCH_WINDOW_SIZE;
        renderDoubanGenreChips();
        renderDoubanSortChips();
        const yearSelect = document.getElementById('douban-year-select');
        if (yearSelect) yearSelect.value = doubanFilterYear;
    }
    syncDoubanModeStateFromRuntime();

    setCategoryButtonsActive(doubanCurrentCategory);
    applyDoubanModeUI();

    if (forceRender && isDoubanFeatureEnabled()) {
        renderCurrentDoubanMode(true);
    }
}

function getCurrentDoubanTags() {
    if (doubanCurrentCategory === 'anime') {
        return ['动漫', '日本动画', '动画'];
    }
    if (doubanCurrentCategory === 'variety') {
        return ['综艺', '真人秀', '脱口秀'];
    }
    if (doubanCurrentCategory === 'tv') {
        return sanitizeTvTags(tvTags);
    }
    return doubanMovieTvCurrentSwitch === 'movie' ? movieTags : tvTags;
}

function getDefaultTagByCategory(category) {
    const config = doubanCategoryConfig[category] || doubanCategoryConfig.movie;
    const tags = getCurrentDoubanTags();
    if (tags.includes(config.defaultTag)) return config.defaultTag;
    return tags.includes('热门') ? '热门' : (tags[0] || '热门');
}

function getSelectedSortConfig() {
    return DOUBAN_SORT_OPTIONS.find(item => item.value === doubanFilterSort) || DOUBAN_SORT_OPTIONS[0];
}

function getFilterSourceTags() {
    const categoryTag = DOUBAN_ADVANCED_CATEGORY_TAGS[doubanCurrentCategory] || '电影';
    return doubanFilterGenre ? [categoryTag, doubanFilterGenre] : [categoryTag];
}

function buildDoubanFilterKey() {
    return [
        doubanCurrentCategory,
        doubanMovieTvCurrentSwitch,
        doubanCurrentTag,
        doubanFilterYear || '',
        doubanFilterGenre || '',
        doubanFilterSort || 'latest',
    ].join('|');
}

function resetDoubanCache() {
    const fetchStep = doubanMode === 'filter' ? DOUBAN_FILTER_FETCH_PAGE_SIZE : doubanPageSize;
    doubanPageDomCache.clear();
    doubanFilterCache = {
        key: buildDoubanFilterKey(),
        items: [],
        sourceOffset: doubanMode === 'filter' ? 0 : doubanPageStart,
        exhausted: false,
        prefetchMaxPage: PREFETCH_WINDOW_SIZE,
        sourceTags: [],
        sourceTagIndex: 0,
        sourceTagOffsets: {},
        sourceFetchStep: fetchStep
    };
}

function cancelDoubanRequests() {
    doubanRenderSeq += 1;
    doubanPaginationRequestSeq += 1;
    doubanActiveAbortController?.abort();
    doubanActiveAbortController = null;
    doubanRecommendAbortController?.abort();
    doubanRecommendAbortController = null;
    doubanPrefetchAbortController?.abort();
    doubanPrefetchAbortController = null;
    doubanPaginationAbortController?.abort();
    doubanPaginationAbortController = null;
    doubanPrefetchInFlight = false;
}

function scheduleFilterRender(resetCache = true) {
    if (doubanFilterRenderTimer) {
        clearTimeout(doubanFilterRenderTimer);
        doubanFilterRenderTimer = null;
    }
    cancelDoubanRequests();
    doubanFilterRenderTimer = setTimeout(() => {
        doubanFilterRenderTimer = null;
        void renderFilterMode(resetCache);
    }, FILTER_RENDER_DEBOUNCE_MS);
}

function setupDoubanFilterControls() {
    const yearSelect = document.getElementById('douban-year-select');
    const resetBtn = document.getElementById('douban-filter-reset');
    const pagination = document.getElementById('douban-pagination');
    const prevBtn = document.getElementById('douban-page-prev');
    const nextBtn = document.getElementById('douban-page-next');

    if (!yearSelect || !resetBtn) return;

    yearSelect.innerHTML = '<option value=\"\">不限</option>';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 30; y--) {
        const option = document.createElement('option');
        option.value = String(y);
        option.textContent = String(y);
        yearSelect.appendChild(option);
    }

    // 初次加载题材/排序选项
    renderDoubanGenreChips();
    renderDoubanSortChips();
    yearSelect.value = doubanFilterYear || '';

    yearSelect.addEventListener('change', () => {
        if (doubanMode !== 'filter') return;
        doubanFilterYear = yearSelect.value || '';
        doubanDisplayPage = 1;
        syncDoubanModeStateFromRuntime();
        scheduleFilterRender(true);
    });

    resetBtn.addEventListener('click', () => {
        if (doubanMode !== 'filter') return;
        doubanFilterYear = '';
        doubanFilterGenre = '';
        doubanFilterSort = 'latest';
        yearSelect.value = '';
        doubanDisplayPage = 1;
        renderDoubanGenreChips();
        renderDoubanSortChips();
        syncDoubanModeStateFromRuntime();
        scheduleFilterRender(true);
    });

    if (pagination && prevBtn && nextBtn) {
        prevBtn.addEventListener('click', () => {
            if (doubanMode !== 'filter') return;
            if (doubanDisplayPage <= 1) return;
            doubanDisplayPage -= 1;
            syncDoubanModeStateFromRuntime();
            renderPagedDoubanCards();
        });

        nextBtn.addEventListener('click', async () => {
            if (doubanMode !== 'filter') return;
            const targetPage = doubanDisplayPage + 1;
            const filterKey = buildDoubanFilterKey();
            const requestSeq = ++doubanPaginationRequestSeq;
            doubanPaginationAbortController?.abort();
            const controller = new AbortController();
            doubanPaginationAbortController = controller;
            try {
                await ensureDoubanItemsForPage(targetPage, {
                    signal: controller.signal,
                    cacheKey: filterKey
                });
                if (
                    controller.signal.aborted ||
                    requestSeq !== doubanPaginationRequestSeq ||
                    doubanMode !== 'filter' ||
                    buildDoubanFilterKey() !== filterKey ||
                    doubanFilterCache.key !== filterKey
                ) return;

                const targetStart = (targetPage - 1) * doubanDisplayPageSize;
                if ((doubanFilterCache.items.length || 0) <= targetStart) {
                    updateDoubanPagination(0, true);
                    showToast('已到最后一页', 'info');
                    return;
                }
                doubanDisplayPage = targetPage;
                syncDoubanModeStateFromRuntime();
                renderPagedDoubanCards();
            } catch (error) {
                if (controller.signal.aborted || error?.name === 'AbortError') return;
                console.warn('豆瓣下一页加载失败：', error);
                showToast('下一页加载失败，请稍后重试', 'warning');
            } finally {
                if (doubanPaginationAbortController === controller) {
                    doubanPaginationAbortController = null;
                }
            }
        });
    }
}

function getGenreOptionsByCategory(category) {
    return DOUBAN_GENRES_BY_CATEGORY[category] || DOUBAN_GENRES_BY_CATEGORY.movie;
}

function renderDoubanGenreChips() {
    const container = document.getElementById('douban-genre-chips');
    if (!container) return;
    const options = ['全部题材', ...getGenreOptionsByCategory(doubanCurrentCategory)];
    if (doubanFilterGenre && !options.includes(doubanFilterGenre)) {
        doubanFilterGenre = '';
    }
    container.innerHTML = '';

    options.forEach(label => {
        const value = label === '全部题材' ? '' : label;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `douban-filter-chip${(doubanFilterGenre || '') === value ? ' is-active' : ''}`;
        chip.textContent = label;
        chip.addEventListener('click', () => {
            if (doubanMode !== 'filter') return;
            if ((doubanFilterGenre || '') === value) return;
            doubanFilterGenre = value;
            doubanDisplayPage = 1;
            renderDoubanGenreChips();
            syncDoubanModeStateFromRuntime();
            scheduleFilterRender(true);
        });
        container.appendChild(chip);
    });
}

function renderDoubanSortChips() {
    const container = document.getElementById('douban-sort-chips');
    if (!container) return;
    if (!DOUBAN_SORT_OPTIONS.some(item => item.value === doubanFilterSort)) {
        doubanFilterSort = 'latest';
    }
    container.innerHTML = '';
    DOUBAN_SORT_OPTIONS.forEach(item => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `douban-filter-chip${doubanFilterSort === item.value ? ' is-active' : ''}`;
        chip.textContent = item.label;
        chip.addEventListener('click', () => {
            if (doubanMode !== 'filter') return;
            if (doubanFilterSort === item.value) return;
            doubanFilterSort = item.value;
            doubanDisplayPage = 1;
            renderDoubanSortChips();
            syncDoubanModeStateFromRuntime();
            scheduleFilterRender(true);
        });
        container.appendChild(chip);
    });
}

function setCategoryButtonsActive(category) {
    ['movie', 'tv', 'anime', 'variety'].forEach(key => {
        const btn = document.getElementById(`douban-cat-${key}`);
        if (!btn) return;
        if (key === category) {
            btn.classList.add('bg-orange-700', 'text-white');
            btn.classList.remove('text-gray-300');
        } else {
            btn.classList.remove('bg-orange-700', 'text-white');
            btn.classList.add('text-gray-300');
        }
    });
}

// 推荐条目只提供片名，播放搜索沿用用户选源。
async function fillAndSearchWithDouban(title) {
    if (!title) return;
    const searchTitle = String(title).trim();
    if (!searchTitle) return;
    
    // 填充搜索框并执行搜索
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = searchTitle;
        await search(); // 使用已有的search函数执行搜索

        if (window.innerWidth <= 768) {
          window.scrollTo({
              top: 0,
              behavior: 'smooth'
          });
        }
    }
}

// 渲染大类切换器（电影、电视剧、动漫、综艺）
function renderDoubanCategorySwitch() {
    const categories = ['movie', 'tv', 'anime', 'variety'];
    categories.forEach(category => {
        const btn = document.getElementById(`douban-cat-${category}`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (doubanCurrentCategory === category) return;
            switchDoubanCategory(category);
        });
    });
    setCategoryButtonsActive(doubanCurrentCategory);
}

function switchDoubanCategory(category) {
    doubanCurrentCategory = category;
    const config = doubanCategoryConfig[category] || doubanCategoryConfig.movie;
    doubanMovieTvCurrentSwitch = config.sourceType;
    setCategoryButtonsActive(category);

    if (doubanMode === 'recommend') {
        doubanCurrentTag = getDefaultTagByCategory(category);
        doubanPageStart = 0;
        renderDoubanTags();
        syncDoubanModeStateFromRuntime();
        renderRecommendMode();
        return;
    }

    doubanCurrentTag = getDefaultTagByCategory(category);
    doubanDisplayPage = 1;
    renderDoubanGenreChips();
    renderDoubanSortChips();
    syncDoubanModeStateFromRuntime();
    scheduleFilterRender(true);
}

// 渲染豆瓣标签选择器
function renderDoubanTags(tags) {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;
    
    // 确定当前应该使用的标签列表
    const currentTags = getCurrentDoubanTags();
    
    // 清空标签容器
    tagContainer.innerHTML = '';

    // 先添加标签管理按钮
    const manageBtn = document.createElement('button');
    manageBtn.className = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-[#1a1a1a] text-gray-300 hover:bg-orange-700 hover:text-white border border-[#333] hover:border-white';
    manageBtn.innerHTML = '<span class="flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>管理标签</span>';
    manageBtn.onclick = function() {
        showTagManageModal();
    };
    tagContainer.appendChild(manageBtn);

    // 添加所有标签
    currentTags.forEach(tag => {
        const btn = document.createElement('button');
        
        // 设置样式
        let btnClass = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 border ';
        
        // 当前选中的标签使用高亮样式
        if (tag === doubanCurrentTag) {
            btnClass += 'bg-orange-700 text-white shadow-md border-orange-300';
        } else {
            btnClass += 'bg-[#1a1a1a] text-gray-300 hover:bg-orange-700 hover:text-white border-[#333] hover:border-white';
        }
        
        btn.className = btnClass;
        btn.textContent = tag;
        
        btn.onclick = function() {
            if (doubanCurrentTag !== tag) {
                doubanCurrentTag = tag;
                doubanPageStart = 0;
                doubanDisplayPage = 1;
                syncDoubanModeStateFromRuntime();
                renderCurrentDoubanMode(true);
                renderDoubanTags();
            }
        };
        
        tagContainer.appendChild(btn);
    });
}

// 设置换一批按钮事件
function setupDoubanRefreshBtn() {
    // 修复ID，使用正确的ID douban-refresh 而不是 douban-refresh-btn
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;
    
    btn.onclick = function() {
        if (doubanMode !== 'recommend') return;
        doubanPageStart += doubanPageSize;
        if (doubanPageStart > 9 * doubanPageSize) {
            doubanPageStart = 0;
        }
        syncDoubanModeStateFromRuntime();
        renderRecommendMode();
    };
}

function fetchDoubanTags() {
    const movieTagsTarget = `https://movie.douban.com/j/search_tags?type=movie`
    fetchDoubanData(movieTagsTarget)
        .then(data => {
            movieTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'movie') {
                renderDoubanTags(movieTags);
                renderDoubanGenreChips();
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电影标签失败：", error);
        });
    const tvTagsTarget = `https://movie.douban.com/j/search_tags?type=tv`
    fetchDoubanData(tvTagsTarget)
       .then(data => {
            tvTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'tv') {
                renderDoubanTags(tvTags);
                renderDoubanGenreChips();
            }
        })
       .catch(error => {
            console.error("获取豆瓣热门电视剧标签失败：", error);
        });
}

// 渲染热门推荐内容（兼容旧调用，内部转到新筛选流）
function renderRecommend(tag, pageLimit, pageStart) {
    if (typeof tag === 'string' && tag) {
        doubanCurrentTag = tag;
    }
    if (typeof pageStart === 'number' && !Number.isNaN(pageStart)) {
        doubanPageStart = pageStart;
    }
    syncDoubanModeStateFromRuntime();
    return renderRecommendMode();
}

function showDoubanLoadingOverlay(container) {
    container.querySelectorAll('[data-douban-loading]').forEach(node => node.remove());
    container.classList.add('relative');
    const overlay = document.createElement('div');
    overlay.dataset.doubanLoading = 'true';
    overlay.className = 'absolute inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-24 z-10';
    overlay.innerHTML = `
        <div class="flex items-center justify-center rounded-full bg-black/70 px-4 py-2">
            <div class="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin inline-block"></div>
            <span class="text-orange-300 ml-3">加载中...</span>
        </div>
    `;
    container.appendChild(overlay);
    return overlay;
}

async function renderRecommendMode() {
    const container = document.getElementById('douban-results');
    if (!container) return;

    cancelDoubanRequests();
    const renderSeq = ++doubanRenderSeq;
    doubanRecommendAbortController = new AbortController();
    const { signal } = doubanRecommendAbortController;
    const loadingOverlay = showDoubanLoadingOverlay(container);

    try {
        const target = `https://movie.douban.com/j/search_subjects?type=${doubanMovieTvCurrentSwitch}&tag=${encodeURIComponent(doubanCurrentTag)}&sort=recommend&page_limit=${doubanPageSize}&page_start=${doubanPageStart}`;
        const data = await fetchDoubanData(target, { signal });
        if (renderSeq !== doubanRenderSeq || signal.aborted || doubanMode !== 'recommend') return;
        const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
        renderDoubanCards(subjects, container);
    } catch (error) {
        if (signal.aborted) return;
        console.error('获取豆瓣推荐失败：', error);
        container.innerHTML = `
            <div class="col-span-full text-center py-8">
                <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                <div class="text-gray-500 text-sm mt-2">提示：使用VPN可能有助于解决此问题</div>
            </div>
        `;
    } finally {
        loadingOverlay.remove();
        if (doubanRecommendAbortController?.signal === signal) {
            doubanRecommendAbortController = null;
        }
    }
}

async function renderFilterMode(resetCache = false) {
    const container = document.getElementById('douban-results');
    if (!container) return;

    cancelDoubanRequests();
    const requestSeq = ++doubanFilterRequestSeq;
    const renderSeq = ++doubanRenderSeq;
    doubanActiveAbortController = new AbortController();
    const { signal } = doubanActiveAbortController;

    if (resetCache) {
        resetDoubanCache();
    }

    const loadingOverlay = showDoubanLoadingOverlay(container);

    try {
        // 先保证当前页，优先首屏可见速度
        await ensureDoubanItemsForPage(doubanDisplayPage, {
            signal,
            onProgress: () => {
                if (requestSeq !== doubanFilterRequestSeq || renderSeq !== doubanRenderSeq || signal.aborted) return;
                const pageStart = (doubanDisplayPage - 1) * doubanDisplayPageSize;
                if (doubanFilterCache.items.length > pageStart) {
                    renderPagedDoubanCards({ prefetch: false });
                }
            }
        });
        if (requestSeq !== doubanFilterRequestSeq || renderSeq !== doubanRenderSeq || signal.aborted) return;
        renderPagedDoubanCards();

        // 后台补齐窗口，减少用户翻页等待
        const initialTargetPage = Math.max(doubanDisplayPage, PREFETCH_WINDOW_SIZE);
        if (initialTargetPage > doubanDisplayPage && !doubanFilterCache.exhausted) {
            const cacheKey = doubanFilterCache.key;
            doubanPrefetchInFlight = true;
            doubanPrefetchAbortController = new AbortController();
            const prefetchSignal = doubanPrefetchAbortController.signal;
            void (async () => {
                try {
                    await ensureDoubanItemsForPage(initialTargetPage, { signal: prefetchSignal });
                    if (
                        requestSeq !== doubanFilterRequestSeq ||
                        renderSeq !== doubanRenderSeq ||
                        prefetchSignal.aborted ||
                        doubanFilterCache.key !== cacheKey
                    ) return;
                    doubanFilterCache.prefetchMaxPage = Math.max(doubanFilterCache.prefetchMaxPage || PREFETCH_WINDOW_SIZE, initialTargetPage);
                    updateDoubanPagination(0, doubanFilterCache.exhausted);
                    syncDoubanModeStateFromRuntime();
                } catch (_) {
                    // 后台预取失败不打断首屏
                } finally {
                    if (doubanPrefetchAbortController?.signal === prefetchSignal) {
                        doubanPrefetchAbortController = null;
                        doubanPrefetchInFlight = false;
                    }
                }
            })();
        }
    } catch (error) {
        if (signal.aborted) return;
        console.error('获取豆瓣数据失败：', error);
        container.innerHTML = `
            <div class="col-span-full text-center py-8">
                <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                <div class="text-gray-500 text-sm mt-2">提示：使用VPN可能有助于解决此问题</div>
            </div>
        `;
        updateDoubanPagination(0, true);
    } finally {
        loadingOverlay.remove();
        if (requestSeq === doubanFilterRequestSeq) {
            doubanActiveAbortController = null;
        }
    }
}

function createDoubanAbortError(reason) {
    const error = reason instanceof Error ? reason : new Error('请求已取消');
    error.name = 'AbortError';
    return error;
}

function getDoubanDataTtl(url) {
    if (url.includes('/j/search_tags')) return 6 * 60 * 60 * 1000;
    if (url.includes('/j/subject_abstract')) return 24 * 60 * 60 * 1000;
    return 10 * 60 * 1000;
}

function readDoubanDataCache(url) {
    const cached = doubanDataCache.get(url);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        doubanDataCache.delete(url);
        return null;
    }
    doubanDataCache.delete(url);
    doubanDataCache.set(url, cached);
    return cached.data;
}

function writeDoubanDataCache(url, data) {
    doubanDataCache.set(url, {
        data,
        expiresAt: Date.now() + getDoubanDataTtl(url)
    });
    while (doubanDataCache.size > DOUBAN_DATA_CACHE_LIMIT) {
        doubanDataCache.delete(doubanDataCache.keys().next().value);
    }
    return data;
}

async function fetchDoubanJson(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
    const externalSignal = options.signal;
    const onAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        clearTimeout(timeoutId);
        throw createDoubanAbortError(externalSignal.reason);
    }
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: options.headers
        });
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        if (externalSignal?.aborted) throw createDoubanAbortError(externalSignal.reason);
        if (controller.signal.aborted) {
            const timeoutError = new Error('豆瓣请求超时');
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onAbort);
    }
}

async function fetchDoubanDataUncached(url, options = {}) {
    const requestHeaders = {
        'Accept': 'application/json, text/plain, */*'
    };
    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl
            ? await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url))
            : PROXY_URL + encodeURIComponent(url);
        return await fetchDoubanJson(proxiedUrl, {
            signal: options.signal,
            timeoutMs: 8000,
            headers: requestHeaders
        });
    } catch (error) {
        if (options.signal?.aborted || error?.name === 'AbortError') throw error;
        console.warn('豆瓣代理请求失败，尝试备用通道:', error?.message || error);
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const data = await fetchDoubanJson(fallbackUrl, {
            signal: options.signal,
            timeoutMs: 6000,
            headers: requestHeaders
        });
        if (!data?.contents) throw new Error('豆瓣备用通道返回无效数据');
        return JSON.parse(data.contents);
    }
}

async function fetchDoubanData(url, options = {}) {
    const cached = options.bypassCache ? null : readDoubanDataCache(url);
    if (cached) return cached;

    // 无取消信号的推荐/标签请求可共享同一个在途 Promise；筛选请求保留独立取消能力。
    if (!options.signal && doubanDataInFlight.has(url)) {
        return doubanDataInFlight.get(url);
    }

    const task = fetchDoubanDataUncached(url, options)
        .then((data) => writeDoubanDataCache(url, data))
        .finally(() => {
            if (doubanDataInFlight.get(url) === task) doubanDataInFlight.delete(url);
        });
    if (!options.signal) doubanDataInFlight.set(url, task);
    return task;
}

async function ensureDoubanItemsForPage(page, options = {}) {
    const cacheKey = options.cacheKey || buildDoubanFilterKey();
    const mode = doubanMode;
    const task = doubanEnsureQueue
        .catch(() => {})
        .then(() => ensureDoubanItemsForPageUnlocked(page, {
            ...options,
            cacheKey,
            mode
        }));
    doubanEnsureQueue = task.catch(() => {});
    return task;
}

async function ensureDoubanItemsForPageUnlocked(page, options = {}) {
    const signal = options.signal;
    const cacheKey = options.cacheKey || buildDoubanFilterKey();
    const expectedMode = options.mode || doubanMode;
    const assertRequestIsCurrent = () => {
        if (
            signal?.aborted ||
            doubanMode !== expectedMode ||
            buildDoubanFilterKey() !== cacheKey
        ) {
            throw createDoubanAbortError(signal?.reason);
        }
    };

    assertRequestIsCurrent();
    const targetCount = page * doubanDisplayPageSize;
    if (doubanFilterCache.key !== cacheKey) {
        resetDoubanCache();
    }
    assertRequestIsCurrent();

    const fetchPageSize = doubanMode === 'filter'
        ? (doubanFilterCache.sourceFetchStep || DOUBAN_FILTER_FETCH_PAGE_SIZE)
        : doubanPageSize;
    let loops = 0;
    while (!doubanFilterCache.exhausted && doubanFilterCache.items.length < targetCount && loops < doubanMaxSourcePages) {
        assertRequestIsCurrent();
        loops += 1;
        const start = doubanFilterCache.sourceOffset;
        const beforeCount = doubanFilterCache.items.length;
        const sourceSort = getSelectedSortConfig().apiSort;
        const tags = getFilterSourceTags().join(',');
        const yearRange = doubanFilterYear
            ? `&year_range=${encodeURIComponent(`${doubanFilterYear},${doubanFilterYear}`)}`
            : '';
        const target = `https://movie.douban.com/j/new_search_subjects?sort=${sourceSort}&range=0,10&tags=${encodeURIComponent(tags)}&start=${start}${yearRange}`;
        const data = await fetchDoubanData(target, { signal });
        assertRequestIsCurrent();
        if (doubanFilterCache.key !== cacheKey) {
            throw createDoubanAbortError();
        }
        const subjects = (Array.isArray(data?.data) ? data.data : []).map(item => ({
            ...item,
            __meta: {
                release_year: doubanFilterYear || '',
                types: doubanFilterGenre ? [doubanFilterGenre] : [],
                is_tv: doubanCurrentCategory === 'tv',
                subtype: doubanCurrentCategory
            }
        }));

        if (subjects.length === 0) {
            doubanFilterCache.exhausted = true;
            break;
        }

        const existing = new Set(doubanFilterCache.items.map(item => String(item.id)));
        subjects.forEach(item => {
            const key = String(item.id);
            if (existing.has(key)) return;
            existing.add(key);
            doubanFilterCache.items.push(item);
        });
        if (doubanFilterCache.items.length > beforeCount) {
            options.onProgress?.({
                items: doubanFilterCache.items,
                exhausted: doubanFilterCache.exhausted
            });
        }

        doubanFilterCache.sourceOffset = start + fetchPageSize;
        if (subjects.length < fetchPageSize) {
            doubanFilterCache.exhausted = true;
        }

        // 当前批次没有新增结果且目标数量仍未满足，避免后续出现连续空页
        if (doubanFilterCache.items.length === beforeCount) {
            doubanFilterCache.exhausted = true;
        }
    }

    if (loops >= doubanMaxSourcePages && doubanFilterCache.items.length < targetCount) {
        doubanFilterCache.exhausted = true;
    }
}

async function maybePrefetchNextWindow() {
    if (doubanMode !== 'filter' || doubanPrefetchInFlight || doubanFilterCache.exhausted) return;
    const loadedEndPage = Math.max(doubanFilterCache.prefetchMaxPage || 0, Math.ceil((doubanFilterCache.items.length || 0) / doubanDisplayPageSize));
    if (loadedEndPage < PREFETCH_WINDOW_SIZE) return;
    if (doubanDisplayPage < 2) return;
    if (doubanDisplayPage < loadedEndPage - (PREFETCH_WINDOW_SIZE - 1)) return;

    const maxAllowedByAhead = doubanDisplayPage + PREFETCH_AHEAD_LIMIT;
    const targetPage = Math.min(loadedEndPage + PREFETCH_WINDOW_SIZE, maxAllowedByAhead);
    if (targetPage <= loadedEndPage) return;

    doubanPrefetchInFlight = true;
    const cacheKey = doubanFilterCache.key;
    doubanPrefetchAbortController?.abort();
    doubanPrefetchAbortController = new AbortController();
    const signal = doubanPrefetchAbortController.signal;
    try {
        await ensureDoubanItemsForPage(targetPage, { signal });
        if (signal.aborted || doubanFilterCache.key !== cacheKey || doubanMode !== 'filter') return;
        doubanFilterCache.prefetchMaxPage = Math.max(doubanFilterCache.prefetchMaxPage || 0, targetPage);
        updateDoubanPagination(0, doubanFilterCache.exhausted);
        syncDoubanModeStateFromRuntime();
    } catch (e) {
        if (!signal.aborted && e?.name !== 'AbortError') {
            console.warn('后台预取失败：', e);
        }
    } finally {
        if (doubanPrefetchAbortController?.signal === signal) {
            doubanPrefetchAbortController = null;
            doubanPrefetchInFlight = false;
        }
    }
}

function shouldUseDoubanMetaFilter() {
    return Boolean(
        doubanFilterYear ||
        doubanCurrentCategory === 'anime' ||
        doubanCurrentCategory === 'variety'
    );
}

function useGenreAsSourceTagOnly() {
    return Boolean(
        doubanFilterGenre &&
        (doubanCurrentCategory === 'movie' || doubanCurrentCategory === 'tv')
    );
}

function applyPostFilterSort(items) {
    const list = Array.isArray(items) ? [...items] : [];
    if (doubanFilterSort === 'rating') {
        return list.sort((a, b) => Number(b?.rate || 0) - Number(a?.rate || 0));
    }
    if (doubanFilterSort === 'latest') {
        return list.sort((a, b) => {
            const ya = Number(getItemReleaseYear(a));
            const yb = Number(getItemReleaseYear(b));
            if (yb !== ya) return yb - ya;
            return Number(b?.rate || 0) - Number(a?.rate || 0);
        });
    }
    return list;
}

function extractYearFromTitle(title) {
    const text = String(title || '');
    const m = text.match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : '';
}

function getItemReleaseYear(item) {
    return String(item?.__meta?.release_year || extractYearFromTitle(item?.title) || '');
}

async function enrichDoubanSubjects(subjects, options = {}) {
    const list = Array.isArray(subjects) ? subjects : [];
    const signal = options.signal;
    const requireTypes = !!options.requireTypes;
    if (list.length === 0) return [];
    const output = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
        while (cursor < list.length) {
            if (signal?.aborted) throw new Error('请求已取消');
            const index = cursor++;
            const item = list[index];
            const id = String(item.id || '').trim();
            if (!id) {
                output[index] = null;
                continue;
            }
            if (doubanMetaCache.has(id)) {
                output[index] = { ...item, __meta: doubanMetaCache.get(id) };
                continue;
            }
            const titleYear = extractYearFromTitle(item.title);
            // 仅按年份筛选时，优先用标题年份，避免逐条详情请求
            if (!requireTypes && titleYear) {
                const quickMeta = {
                    release_year: titleYear,
                    types: [],
                    is_tv: doubanCurrentCategory !== 'movie',
                    subtype: '',
                };
                output[index] = { ...item, __meta: quickMeta };
                continue;
            }
            try {
                const detailUrl = `https://movie.douban.com/j/subject_abstract?subject_id=${id}`;
                const detail = await fetchDoubanData(detailUrl, { signal });
                const subject = detail?.subject || {};
                const meta = {
                    release_year: String(subject.release_year || titleYear || ''),
                    types: Array.isArray(subject.types) ? subject.types : [],
                    is_tv: !!subject.is_tv,
                    subtype: String(subject.subtype || ''),
                };
                doubanMetaCache.set(id, meta);
                output[index] = { ...item, __meta: meta };
            } catch (e) {
                if (signal?.aborted) throw new Error('请求已取消');
                // 详情失败时保留基础卡片，避免整批丢失
                output[index] = { ...item, __meta: { release_year: '', types: [], is_tv: false, subtype: '' } };
            }
        }
    };

    const workers = Array.from({ length: Math.min(DOUBAN_META_CONCURRENCY, list.length) }, () => worker());
    await Promise.all(workers);
    return output.filter(Boolean);
}

function matchesDoubanAdvancedFilters(item) {
    if (!item) return false;
    const config = doubanCategoryConfig[doubanCurrentCategory] || doubanCategoryConfig.movie;
    const meta = item.__meta || {};
    const types = Array.isArray(meta.types) ? meta.types : [];
    const typeText = types.join(' ');

    const effectiveYear = getItemReleaseYear(item);
    // 年份筛选
    if (doubanFilterYear && String(effectiveYear || '') !== String(doubanFilterYear)) {
        return false;
    }

    // 大类筛选
    if (doubanCurrentCategory === 'movie') {
        if (meta.is_tv === true) return false;
    } else if (doubanCurrentCategory === 'tv') {
        if (meta.is_tv === false && !containsKeyword(typeText, config.typeKeywords)) return false;
    } else if (doubanCurrentCategory === 'anime') {
        if (!containsKeyword(typeText, config.typeKeywords)) return false;
    } else if (doubanCurrentCategory === 'variety') {
        if (!containsKeyword(typeText, config.typeKeywords)) return false;
    }

    // 题材筛选
    if (doubanFilterGenre && !useGenreAsSourceTagOnly()) {
        if (!containsKeyword(typeText, [doubanFilterGenre])) return false;
    }

    return true;
}

function containsKeyword(text, keywords) {
    const src = String(text || '');
    return (Array.isArray(keywords) ? keywords : []).some(word => src.includes(word));
}

function renderPagedDoubanCards(options = {}) {
    const container = document.getElementById('douban-results');
    if (!container) return;
    const all = doubanFilterCache.items || [];
    let start = (doubanDisplayPage - 1) * doubanDisplayPageSize;
    if (start >= all.length && doubanDisplayPage > 1) {
        doubanDisplayPage -= 1;
        start = (doubanDisplayPage - 1) * doubanDisplayPageSize;
    }
    const end = start + doubanDisplayPageSize;
    const currentPageItems = all.slice(start, end);
    const itemSignature = currentPageItems.map(item => String(item.id || '')).join(',');
    const pageCacheKey = `${doubanFilterCache.key}|p=${doubanDisplayPage}|${itemSignature}`;
    const cachedNodes = doubanPageDomCache.get(pageCacheKey);
    if (Array.isArray(cachedNodes) && cachedNodes.length > 0) {
        container.innerHTML = "";
        const fragment = document.createDocumentFragment();
        cachedNodes.forEach(node => fragment.appendChild(node));
        container.appendChild(fragment);
    } else {
        renderDoubanCards(currentPageItems, container);
        const nodes = Array.from(container.childNodes);
        doubanPageDomCache.set(pageCacheKey, nodes);
        // 控制缓存体积，避免长时间筛选导致内存增长
        while (doubanPageDomCache.size > DOUBAN_PAGE_DOM_CACHE_LIMIT) {
            const oldestKey = doubanPageDomCache.keys().next().value;
            doubanPageDomCache.delete(oldestKey);
        }
    }
    syncDoubanModeStateFromRuntime();
    updateDoubanPagination(currentPageItems.length, doubanFilterCache.exhausted);
    if (options.prefetch !== false) void maybePrefetchNextWindow();
}

function updateDoubanPagination(currentPageCount, exhausted) {
    const wrapper = document.getElementById('douban-filter-pagination');
    const pagination = document.getElementById('douban-pagination');
    const prevBtn = document.getElementById('douban-page-prev');
    const nextBtn = document.getElementById('douban-page-next');
    const info = document.getElementById('douban-page-info');
    if (!pagination || !prevBtn || !nextBtn || !info) return;

    if (doubanMode !== 'filter') {
        wrapper?.classList.add('is-hidden');
        pagination.classList.add('hidden');
        return;
    }

    wrapper?.classList.remove('is-hidden');
    pagination.classList.remove('hidden');
    prevBtn.disabled = doubanDisplayPage <= 1;
    const currentEnd = doubanDisplayPage * doubanDisplayPageSize;
    const hasNextLoaded = doubanFilterCache.items.length > currentEnd;
    nextBtn.disabled = exhausted && !hasNextLoaded;
    const loadedPages = Math.max(1, Math.ceil((doubanFilterCache.items.length || 0) / doubanDisplayPageSize));
    const knownTotalPages = Math.max(loadedPages, doubanDisplayPage);
    if (exhausted) {
        info.textContent = `第 ${doubanDisplayPage} 页 / 共 ${knownTotalPages} 页`;
    } else {
        info.textContent = `第 ${doubanDisplayPage} 页 / 共计算中`;
    }
}

function escapeDoubanHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSafeDoubanSourceUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch {
        return '#';
    }
}

function bindDoubanCardInteractions(container) {
    if (!container || doubanCardContainersBound.has(container)) return;
    doubanCardContainersBound.add(container);

    const openCard = (target) => {
        const trigger = target.closest?.('[data-douban-open]');
        if (!trigger || !container.contains(trigger)) return;
        try {
            fillAndSearchWithDouban(decodeURIComponent(trigger.dataset.doubanTitle || ''));
        } catch {
            showToast('影片信息无效，请刷新后重试', 'error');
        }
    };

    container.addEventListener('click', (event) => {
        if (event.target.closest?.('[data-douban-source]')) return;
        openCard(event.target);
    });
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!event.target.closest?.('[data-douban-open]')) return;
        event.preventDefault();
        openCard(event.target);
    });
    container.addEventListener('error', (event) => {
        const image = event.target.closest?.('img[data-douban-poster]');
        if (!image || image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = DOUBAN_POSTER_FALLBACK;
        image.classList.add('object-contain');
    }, true);
}

// 抽取渲染豆瓣卡片的逻辑到单独函数
function renderDoubanCards(items, container) {
    function buildAuthedProxyUrlSync(targetUrl) {
        if (!targetUrl) return '';
        const base = PROXY_URL + encodeURIComponent(targetUrl);
        return window.ProxyAuth?.addAuthToProxyUrlSync?.(base) || base;
    }

    const fragment = document.createDocumentFragment();

    if (!items || items.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'col-span-full text-center py-8';
        emptyEl.innerHTML = '<div class="text-orange-400">❌ 暂无数据，请尝试其他分类或刷新</div>';
        fragment.appendChild(emptyEl);
    } else {
        items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'douban-card bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg';

            const rawTitle = String(item.title || '');
            const safeTitle = escapeDoubanHtml(rawTitle);
            const encodedTitle = escapeDoubanHtml(encodeURIComponent(rawTitle));
            const safeRate = escapeDoubanHtml(item.rate || '暂无');
            const meta = item.__meta || {};
            const yearText = meta.release_year
                ? `<span class="text-[11px] text-gray-300 mt-1">${escapeDoubanHtml(meta.release_year)}</span>`
                : '';
            const typeText = Array.isArray(meta.types) ? meta.types.slice(0, 2).join(' / ') : '';
            const typeHtml = typeText
                ? `<span class="text-[11px] text-gray-500 mt-1 block truncate">${escapeDoubanHtml(typeText)}</span>`
                : '';
            const proxiedCoverUrl = escapeDoubanHtml(buildAuthedProxyUrlSync(item.cover));
            const sourceUrl = escapeDoubanHtml(getSafeDoubanSourceUrl(item.url));

            card.innerHTML = `
                <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer" role="button" tabindex="0"
                     data-douban-open data-douban-title="${encodedTitle}">
                    <img src="${proxiedCoverUrl}" alt="${safeTitle}" width="300" height="450" data-douban-poster
                        class="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        loading="${index === 0 ? 'eager' : 'lazy'}" decoding="${index === 0 ? 'sync' : 'async'}"${index === 0 ? ' fetchpriority="high"' : ' fetchpriority="low"'}>
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                    <div class="absolute bottom-2 left-2 bg-white/35 backdrop-blur-md text-white text-xs px-2 py-1 rounded-lg shadow-sm">
                        <span class="text-yellow-300">★</span> ${safeRate}
                    </div>
                    <div class="absolute bottom-2 right-2 bg-white/35 backdrop-blur-md text-white text-xs px-2 py-1 rounded-lg shadow-sm hover:bg-white/45 transition-colors">
                        <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" title="查看来源（豆瓣）"
                           aria-label="Source，查看豆瓣来源" class="text-[10px] leading-none tracking-wide text-white/95 font-medium"
                           data-douban-source>Source</a>
                    </div>
                </div>
                <div class="p-2 text-center bg-[#111]">
                    <button type="button" data-douban-open data-douban-title="${encodedTitle}"
                            class="text-sm font-medium text-white truncate w-full hover:text-orange-300 transition"
                            title="${safeTitle}">
                        ${safeTitle}
                    </button>
                    ${yearText}
                    ${typeHtml}
                </div>
            `;

            fragment.appendChild(card);
        });
    }

    container.innerHTML = '';
    container.appendChild(fragment);
    bindDoubanCardInteractions(container);
}

// 重置到首页
function resetToHome() {
    resetSearchArea();
    updateDoubanVisibility();
}

// 加载豆瓣首页内容
document.addEventListener('DOMContentLoaded', initDouban);

// 显示标签管理模态框
function showTagManageModal() {
    // 确保模态框在页面上只有一个实例
    let modal = document.getElementById('tagManageModal');
    if (modal) {
        document.body.removeChild(modal);
    }
    
    // 创建模态框元素
    modal = document.createElement('div');
    modal.id = 'tagManageModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';
    
    // 当前使用的标签类型和默认标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    const defaultTags = isMovie ? defaultMovieTags : defaultTvTags;
    
    // 模态框内容
    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeTagModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold text-white mb-4">标签管理 (${isMovie ? '电影' : '电视剧'})</h3>
            
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-lg font-medium text-gray-300">标签列表</h4>
                    <button id="resetTagsBtn" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">
                        恢复默认标签
                    </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4" id="tagsGrid"></div>
            </div>
            
            <div class="border-t border-gray-700 pt-4">
                <h4 class="text-lg font-medium text-gray-300 mb-3">添加新标签</h4>
                <form id="addTagForm" class="flex items-center">
                    <input type="text" id="newTagInput" placeholder="输入标签名称..." 
                           class="flex-1 bg-[#222] text-white border border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-orange-500">
                    <button type="submit" class="ml-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded">添加</button>
                </form>
                <p class="text-xs text-gray-500 mt-2">提示：标签名称不能为空，不能重复，不能包含特殊字符</p>
            </div>
        </div>
    `;
    
    // 添加模态框到页面
    document.body.appendChild(modal);

    const tagsGrid = modal.querySelector('#tagsGrid');
    if (currentTags.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'col-span-full text-center py-4 text-gray-500';
        empty.textContent = '无标签，请添加或恢复默认';
        tagsGrid.appendChild(empty);
    } else {
        currentTags.forEach((tag) => {
            const row = document.createElement('div');
            row.className = 'bg-[#1a1a1a] text-gray-300 py-1.5 px-3 rounded text-sm font-medium flex justify-between items-center group';

            const label = document.createElement('span');
            label.textContent = tag;
            row.appendChild(label);

            if (tag !== '热门') {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'delete-tag-btn text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity';
                deleteButton.dataset.tag = tag;
                deleteButton.setAttribute('aria-label', `删除标签 ${tag}`);
                deleteButton.textContent = '✕';
                row.appendChild(deleteButton);
            } else {
                const required = document.createElement('span');
                required.className = 'text-gray-500 text-xs italic opacity-0 group-hover:opacity-100';
                required.textContent = '必需';
                row.appendChild(required);
            }
            tagsGrid.appendChild(row);
        });
    }
    
    // 焦点放在输入框上
    setTimeout(() => {
        document.getElementById('newTagInput').focus();
    }, 100);
    
    // 添加事件监听器 - 关闭按钮
    document.getElementById('closeTagModal').addEventListener('click', function() {
        document.body.removeChild(modal);
    });
    
    // 添加事件监听器 - 点击模态框外部关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // 添加事件监听器 - 恢复默认标签按钮
    document.getElementById('resetTagsBtn').addEventListener('click', function() {
        resetTagsToDefault();
        showTagManageModal(); // 重新加载模态框
    });
    
    // 添加事件监听器 - 删除标签按钮
    const deleteButtons = document.querySelectorAll('.delete-tag-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const tagToDelete = this.getAttribute('data-tag');
            deleteTag(tagToDelete);
            showTagManageModal(); // 重新加载模态框
        });
    });
    
    // 添加事件监听器 - 表单提交
    document.getElementById('addTagForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const input = document.getElementById('newTagInput');
        const newTag = input.value.trim();
        
        if (newTag) {
            addTag(newTag);
            input.value = '';
            showTagManageModal(); // 重新加载模态框
        }
    });
}

// 添加标签
function addTag(tag) {
    const normalizedTag = normalizeTagValue(tag);
    if (!normalizedTag) {
        showToast('标签需为 1-20 个字符，且不能包含特殊字符', 'warning');
        return;
    }
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 检查是否已存在（忽略大小写）
    const exists = currentTags.some(
        existingTag => existingTag.toLowerCase() === normalizedTag.toLowerCase()
    );
    
    if (exists) {
        showToast('标签已存在', 'warning');
        return;
    }
    
    // 添加到对应的标签数组
    if (isMovie) {
        movieTags.push(normalizedTag);
    } else {
        tvTags.push(normalizedTag);
    }
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签
    renderDoubanTags();
    renderDoubanGenreChips();
    syncDoubanModeStateFromRuntime();
    renderCurrentDoubanMode(true);
    
    showToast('标签添加成功', 'success');
}

// 删除标签
function deleteTag(tag) {
    // 热门标签不能删除
    if (tag === '热门') {
        showToast('热门标签不能删除', 'warning');
        return;
    }
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 寻找标签索引
    const index = currentTags.indexOf(tag);
    
    // 如果找到标签，则删除
    if (index !== -1) {
        currentTags.splice(index, 1);
        
        // 保存到本地存储
        saveUserTags();
        
        // 如果当前选中的是被删除的标签，则重置为"热门"
        if (doubanCurrentTag === tag) {
            doubanCurrentTag = getDefaultTagByCategory(doubanCurrentCategory);
            doubanPageStart = 0;
            syncDoubanModeStateFromRuntime();
            renderCurrentDoubanMode(true);
        }
        
        // 重新渲染标签
        renderDoubanTags();
        renderDoubanGenreChips();
        
        showToast('标签删除成功', 'success');
    }
}

// 重置为默认标签
function resetTagsToDefault() {
    // 确定当前使用的是电影还是电视剧
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    
    // 重置为默认标签
    if (isMovie) {
        movieTags = [...defaultMovieTags];
    } else {
        tvTags = [...defaultTvTags];
    }
    
    // 设置当前标签为热门
    doubanCurrentTag = getDefaultTagByCategory(doubanCurrentCategory);
    doubanPageStart = 0;
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签和内容
    renderDoubanTags();
    renderDoubanGenreChips();
    syncDoubanModeStateFromRuntime();
    renderCurrentDoubanMode(true);
    
    showToast('已恢复默认标签', 'success');
}

// 获取版本信息
async function fetchVersion(url, errorMessage, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(errorMessage);
    }
    return await response.text();
}

const VERSION_CHECK_CACHE_KEY = 'openstreamVersionCheckCache';
const VERSION_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const VERSION_CHECK_MIN_DELAY = 15 * 1000;
const VERSION_FETCH_TIMEOUT = 2500;

async function fetchVersionWithTimeout(url, errorMessage, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT);
    try {
        return await fetchVersion(url, errorMessage, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function readCachedVersionCheck() {
    try {
        const cached = JSON.parse(localStorage.getItem(VERSION_CHECK_CACHE_KEY) || 'null');
        if (!cached || !cached.result || !cached.checkedAt) return null;
        if (Date.now() - cached.checkedAt > VERSION_CHECK_INTERVAL) return null;
        return cached.result;
    } catch (_) {
        return null;
    }
}

function writeCachedVersionCheck(result) {
    try {
        localStorage.setItem(VERSION_CHECK_CACHE_KEY, JSON.stringify({
            checkedAt: Date.now(),
            result
        }));
    } catch (_) {}
}

// 版本检查函数
async function checkForUpdates() {
    try {
        // 获取当前版本
        const currentVersion = await fetchVersionWithTimeout('/VERSION.txt', '获取当前版本失败', {
            cache: 'no-cache'
        });
        
        // 获取最新版本
        let latestVersion;
        const VERSION_URL = {
            // 你自己的仓库（避免误报“发现新版”）
            PROXY: 'https://ghfast.top/raw.githubusercontent.com/GiZGY/LibreTV/main/VERSION.txt',
            DIRECT: 'https://raw.githubusercontent.com/GiZGY/LibreTV/main/VERSION.txt'
        };
        try {
            // 直接地址优先，避免把第三方 GitHub 加速服务放进页面关键依赖链。
            latestVersion = await fetchVersionWithTimeout(VERSION_URL.DIRECT, '获取最新版本失败', {
                cache: 'no-cache'
            });
        } catch (error) {
            try {
                latestVersion = await fetchVersionWithTimeout(VERSION_URL.PROXY, '代理请求失败', {
                    cache: 'no-cache'
                });
            } catch (directError) {
                // 对“最新版本获取失败”不再视为致命错误：
                // 例如还没把 VERSION.txt 合并到 main，raw 可能是 404。
                console.warn('获取最新版本信息失败，将仅展示当前版本:', directError);
                latestVersion = currentVersion;
            }
        }
        
        // 清理版本字符串（移除可能的空格或换行符）
        const cleanCurrentVersion = currentVersion.trim();
        const cleanLatestVersion = latestVersion.trim();
        
        // 返回版本信息
        const result = {
            current: cleanCurrentVersion,
            latest: cleanLatestVersion,
            hasUpdate: compareVersions(cleanLatestVersion, cleanCurrentVersion) > 0,
            currentFormatted: formatVersion(cleanCurrentVersion),
            latestFormatted: formatVersion(cleanLatestVersion)
        };
        writeCachedVersionCheck(result);
        return result;
    } catch (error) {
        console.error('版本检测出错:', error);
        throw error;
    }
}

// 格式化版本号为可读形式 (yyyyMMddhhmm -> yyyy-MM-dd hh:mm)
function formatVersion(versionString) {
    // 检测版本字符串是否有效
    if (!versionString) {
        return '未知版本';
    }
    
    // 清理版本字符串（移除可能的空格或换行符）
    const cleanedString = versionString.trim();
    
    // 格式化标准12位版本号
    if (cleanedString.length === 12) {
        const year = cleanedString.substring(0, 4);
        const month = cleanedString.substring(4, 6);
        const day = cleanedString.substring(6, 8);
        const hour = cleanedString.substring(8, 10);
        const minute = cleanedString.substring(10, 12);
        
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }
    
    return cleanedString;
}

// 版本比较：支持时间戳(12位)和 semver(1.2.3) 两种常见格式
function compareVersions(a, b) {
    const av = (a || '').trim();
    const bv = (b || '').trim();
    if (!av && !bv) return 0;
    if (!av) return -1;
    if (!bv) return 1;

    // 时间戳版本：yyyyMMddhhmm
    const tsRe = /^\d{12}$/;
    if (tsRe.test(av) && tsRe.test(bv)) {
        if (av === bv) return 0;
        return av > bv ? 1 : -1;
    }

    // semver / 数字片段：按数字段落依次比较
    const parseParts = (s) => s.split(/[^0-9]+/).filter(Boolean).map(n => parseInt(n, 10));
    const ap = parseParts(av);
    const bp = parseParts(bv);
    const len = Math.max(ap.length, bp.length);
    for (let i = 0; i < len; i++) {
        const x = ap[i] ?? 0;
        const y = bp[i] ?? 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

function createVersionElement(result) {
    const versionElement = document.createElement('p');
    versionElement.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';

    if (result.hasUpdate) {
        versionElement.innerHTML = `版本: ${result.currentFormatted} <span class="inline-flex items-center bg-red-600 text-white text-xs px-2 py-0.5 rounded-md ml-1 cursor-pointer animate-pulse font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            发现新版
        </span>`;

        setTimeout(() => {
            const updateBtn = versionElement.querySelector('span');
            if (updateBtn) {
                updateBtn.addEventListener('click', () => {
                    window.open('https://github.com/GiZGY/LibreTV', '_blank');
                });
            }
        }, 100);
    } else {
        versionElement.innerHTML = `版本: ${result.currentFormatted} <span class="text-green-500">(最新版本)</span>`;
    }

    return versionElement;
}

// 创建错误版本信息元素
function createErrorVersionElement(errorMessage) {
    const errorElement = document.createElement('p');
    errorElement.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';
    errorElement.innerHTML = `版本: <span class="text-amber-500">检测失败</span>`;
    errorElement.title = errorMessage;
    return errorElement;
}

// 添加版本信息到页脚
function addVersionInfoToFooter() {
    const cachedResult = readCachedVersionCheck();
    if (cachedResult) {
        displayVersionElement(createVersionElement(cachedResult));
    }

    const runCheck = () => checkForUpdates().then(result => {
        if (!result) {
            // 如果版本检测失败，显示错误信息
            const versionElement = createErrorVersionElement();
            // 在页脚显示错误元素
            displayVersionElement(versionElement);
            return;
        }

        const versionElement = createVersionElement(result);
        // 显示版本元素
        displayVersionElement(versionElement);
    }).catch(error => {
        console.error('版本检测出错:', error);
        // 创建错误版本信息元素并显示
        const errorElement = createErrorVersionElement(`错误信息: ${error.message}`);
        displayVersionElement(errorElement);
    });

    if (!cachedResult) {
        setTimeout(() => {
            const schedule = window.requestIdleCallback || ((callback) => setTimeout(callback, 1000));
            schedule(() => {
                if (document.hidden) {
                    const runWhenVisible = () => {
                        if (document.hidden) return;
                        document.removeEventListener('visibilitychange', runWhenVisible);
                        runCheck();
                    };
                    document.addEventListener('visibilitychange', runWhenVisible);
                    return;
                }
                runCheck();
            }, { timeout: 10000 });
        }, VERSION_CHECK_MIN_DELAY);
    }
}

// 在页脚显示版本元素的辅助函数
function displayVersionElement(element) {
    const existing = document.querySelector('[data-version-info="true"]');
    if (existing) existing.remove();
    element.dataset.versionInfo = 'true';

    // 获取页脚元素
    const footerElement = document.querySelector('.footer p.text-gray-500.text-sm');
    if (footerElement) {
        // 在原版权信息后插入版本信息
        footerElement.insertAdjacentElement('afterend', element);
    } else {
        // 如果找不到页脚元素，尝试在页脚区域最后添加
        const footer = document.querySelector('.footer .container');
        if (footer) {
            footer.querySelector('div').appendChild(element);
        }
    }
}

// 页面加载完成后添加版本信息
document.addEventListener('DOMContentLoaded', addVersionInfoToFooter);

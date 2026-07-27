// 保留中转页兼容旧链接，但完成状态写入后立即进入播放器。
function redirectToPlayer() {
    const currentParams = new URLSearchParams(window.location.search);
    const playerUrlObj = new URL("player.html", window.location.origin);
    const statusElement = document.getElementById('redirect-status');
    const manualRedirect = document.getElementById('manual-redirect');

    currentParams.forEach((value, key) => {
        playerUrlObj.searchParams.set(key, value);
    });

    const referrer = document.referrer;
    const backUrl = currentParams.get('back');
    let returnUrl = '';
    if (backUrl) {
        returnUrl = decodeURIComponent(backUrl);
    } else if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        returnUrl = referrer;
    } else if (referrer && referrer.trim() !== '') {
        returnUrl = referrer;
    } else {
        returnUrl = '/';
    }

    if (!playerUrlObj.searchParams.has('returnUrl')) {
        playerUrlObj.searchParams.set('returnUrl', encodeURIComponent(returnUrl));
    }

    localStorage.setItem('lastPageUrl', returnUrl);
    if (returnUrl.includes('/s=') || returnUrl.includes('?s=')) {
        localStorage.setItem('cameFromSearch', 'true');
        localStorage.setItem('searchPageUrl', returnUrl);
    }

    const finalPlayerUrl = playerUrlObj.toString();
    if (manualRedirect) {
        manualRedirect.href = finalPlayerUrl;
    }

    if (statusElement) statusElement.textContent = '即将开始播放...';
    // replace 避免浏览器“返回”时再次进入中转页形成跳转循环。
    window.location.replace(finalPlayerUrl);
}

try {
    redirectToPlayer();
} catch (error) {
    console.error('播放器跳转失败:', error);
    const statusElement = document.getElementById('redirect-status');
    if (statusElement) statusElement.textContent = '自动跳转失败，请点击下方链接继续';
}

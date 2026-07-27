let proxyCredentials = null;
let proxyCredentialsRequest = null;
let proxyCredentialsRefreshTimer = null;

function normalizeProxyCredentials(value) {
    const token = String(value?.token || '');
    const bucket = Number(value?.bucket);
    const expiresAt = Number(value?.expiresAt);
    if (!token || !Number.isFinite(bucket) || !Number.isFinite(expiresAt)) return null;
    return { token, bucket, expiresAt };
}

function setSession(authStatus) {
    proxyCredentials = normalizeProxyCredentials(authStatus?.proxy);
    if (proxyCredentialsRefreshTimer) clearTimeout(proxyCredentialsRefreshTimer);
    proxyCredentialsRefreshTimer = null;
    if (proxyCredentials) {
        const refreshDelay = Math.max(15_000, proxyCredentials.expiresAt - Date.now() - 60_000);
        proxyCredentialsRefreshTimer = setTimeout(() => {
            proxyCredentials = null;
            refreshProxyCredentials().catch(() => {});
        }, refreshDelay);
    }
}

function clearAuthCache() {
    proxyCredentials = null;
    proxyCredentialsRequest = null;
    if (proxyCredentialsRefreshTimer) clearTimeout(proxyCredentialsRefreshTimer);
    proxyCredentialsRefreshTimer = null;
    localStorage.removeItem('proxyAuthHash');
}

function hasUsableCredentials() {
    return proxyCredentials && proxyCredentials.expiresAt > Date.now() + 5_000;
}

async function refreshProxyCredentials() {
    if (hasUsableCredentials()) return proxyCredentials;
    if (proxyCredentialsRequest) return proxyCredentialsRequest;

    proxyCredentialsRequest = fetch('/api/auth/status', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
    })
        .then(async (response) => {
            if (!response.ok) return null;
            const status = await response.json();
            setSession(status);
            return proxyCredentials;
        })
        .finally(() => {
            proxyCredentialsRequest = null;
        });

    return proxyCredentialsRequest;
}

function addAuthToProxyUrlSync(url) {
    if (!hasUsableCredentials()) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}auth=${encodeURIComponent(proxyCredentials.token)}&t=${proxyCredentials.bucket}`;
}

async function addAuthToProxyUrl(url) {
    if (!hasUsableCredentials()) {
        await refreshProxyCredentials();
    }
    return addAuthToProxyUrlSync(url);
}

window.ProxyAuth = {
    addAuthToProxyUrl,
    addAuthToProxyUrlSync,
    clearAuthCache,
    refreshProxyCredentials,
    setSession
};

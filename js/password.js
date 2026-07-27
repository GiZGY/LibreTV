const authSessionState = {
    loaded: false,
    configured: null,
    authenticated: false,
    error: ''
};
let authSessionRequest = null;

function applyAuthStatus(status) {
    authSessionState.loaded = true;
    authSessionState.configured = status?.configured === true;
    authSessionState.authenticated = status?.authenticated === true;
    authSessionState.error = '';
    window.ProxyAuth?.setSession?.(status);

    // Remove credentials left by the legacy client-side hash scheme.
    localStorage.removeItem('proxyAuthHash');
    localStorage.removeItem('passwordVerified');
}

async function refreshAuthSession() {
    if (authSessionRequest) return authSessionRequest;
    const preloadedRequest = window.__openStreamAuthStatusPromise;
    window.__openStreamAuthStatusPromise = null;
    authSessionRequest = (preloadedRequest || fetch('/api/auth/status', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
    }))
        .then(async (response) => {
            if (!response.ok) throw new Error(`认证服务异常 (${response.status})`);
            const status = await response.json();
            applyAuthStatus(status);
            return status;
        })
        .catch((error) => {
            authSessionState.loaded = true;
            authSessionState.configured = null;
            authSessionState.authenticated = false;
            authSessionState.error = error?.message || '认证服务暂不可用';
            throw error;
        })
        .finally(() => {
            authSessionRequest = null;
        });
    return authSessionRequest;
}

function isPasswordProtected() {
    return authSessionState.loaded && authSessionState.configured === true;
}

function isPasswordRequired() {
    return authSessionState.loaded && authSessionState.configured === false;
}

function isPasswordVerified() {
    return authSessionState.loaded && authSessionState.authenticated === true;
}

function ensurePasswordProtection() {
    if (!authSessionState.loaded || authSessionState.error || isPasswordRequired() || !isPasswordVerified()) {
        showPasswordModal();
        throw new Error('Password verification required');
    }
    return true;
}

async function verifyPassword(password) {
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ password })
        });
        const status = await response.json().catch(() => ({}));
        if (!response.ok || !status.authenticated) return false;
        applyAuthStatus(status);
        return true;
    } catch (error) {
        console.error('验证密码时出错:', error);
        authSessionState.error = '认证服务暂不可用，请稍后重试';
        return false;
    }
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;
window.isPasswordVerified = isPasswordVerified;
window.isAuthSessionReady = () => authSessionState.loaded;
window.verifyPassword = verifyPassword;
window.ensurePasswordProtection = ensurePasswordProtection;
window.refreshAuthSession = refreshAuthSession;

function showPasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (!passwordModal) return;

    document.getElementById('passwordCancelBtn')?.classList.add('hidden');

    const title = passwordModal.querySelector('h2');
    const description = passwordModal.querySelector('p');
    const form = passwordModal.querySelector('form');
    const errorMsg = document.getElementById('passwordError');

    if (!authSessionState.loaded) {
        if (title) title.textContent = '正在验证访问状态';
        if (description) description.textContent = '请稍候...';
        if (form) form.style.display = 'none';
        errorMsg?.classList.add('hidden');
    } else if (authSessionState.error || authSessionState.configured === null) {
        if (title) title.textContent = '认证服务暂不可用';
        if (description) description.textContent = '暂时无法确认访问状态，请稍后刷新重试';
        if (form) form.style.display = 'none';
        if (errorMsg) {
            errorMsg.textContent = authSessionState.error || '认证服务暂不可用';
            errorMsg.classList.remove('hidden');
        }
    } else if (isPasswordRequired()) {
        if (title) title.textContent = '需要设置密码';
        if (description) description.textContent = '请先在部署平台设置 PASSWORD 环境变量来保护您的实例';
        if (form) form.style.display = 'none';
        if (errorMsg) {
            errorMsg.textContent = '为确保安全，必须设置 PASSWORD 环境变量才能使用本服务，请联系管理员进行配置';
            errorMsg.className = 'text-red-500 mt-2 font-medium';
        }
    } else {
        if (title) title.textContent = '访问验证';
        if (description) description.textContent = '请输入密码继续访问';
        if (form) form.style.display = 'block';
        errorMsg?.classList.add('hidden');
    }

    passwordModal.style.display = 'flex';
    if (isPasswordProtected() && !isPasswordVerified()) {
        setTimeout(() => document.getElementById('passwordInput')?.focus(), 100);
    }
}

function hidePasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (!passwordModal) return;

    hidePasswordError();
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) passwordInput.value = '';
    passwordModal.style.display = 'none';

    window.updateDoubanVisibility?.();
}

function showPasswordError(message = '密码错误，请重试') {
    const errorElement = document.getElementById('passwordError');
    if (!errorElement) return;
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
}

function hidePasswordError() {
    document.getElementById('passwordError')?.classList.add('hidden');
}

async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('passwordInput');
    const submitButton = document.getElementById('passwordSubmitBtn');
    const password = passwordInput ? passwordInput.value : '';
    if (!password) {
        showPasswordError('请输入密码');
        return;
    }

    if (submitButton) submitButton.disabled = true;
    if (await verifyPassword(password)) {
        hidePasswordModal();
        document.dispatchEvent(new CustomEvent('passwordVerified'));
    } else {
        showPasswordError(authSessionState.error || '密码错误，请重试');
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
    }
    if (submitButton) submitButton.disabled = false;
}

async function logoutAuthSession() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store'
        });
    } finally {
        authSessionState.authenticated = false;
        window.ProxyAuth?.clearAuthCache?.();
    }
}

window.showPasswordModal = showPasswordModal;
window.hidePasswordModal = hidePasswordModal;
window.handlePasswordSubmit = handlePasswordSubmit;
window.logoutAuthSession = logoutAuthSession;

async function initPasswordProtection() {
    showPasswordModal();
    try {
        await refreshAuthSession();
    } catch (_) {
        showPasswordModal();
        return;
    }

    if (isPasswordVerified()) {
        hidePasswordModal();
        document.dispatchEvent(new CustomEvent('passwordVerified'));
    } else {
        showPasswordModal();
    }
}

document.addEventListener('DOMContentLoaded', initPasswordProtection);

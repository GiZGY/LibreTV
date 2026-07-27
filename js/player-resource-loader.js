let playerResourceSwitchLoadPromise = null;

function removePlayerResourceSwitchScript(script) {
    if (!script) return;
    if (typeof script.remove === 'function') {
        script.remove();
    } else if (script.parentNode) {
        script.parentNode.removeChild(script);
    }
}

function loadPlayerResourceSwitch() {
    if (window.OpenStreamResourceSwitch) {
        return Promise.resolve(window.OpenStreamResourceSwitch);
    }
    if (playerResourceSwitchLoadPromise) return playerResourceSwitchLoadPromise;

    const source = document.body?.dataset?.playerSwitchSrc;
    if (!source) {
        return Promise.reject(new Error('换源模块地址未配置'));
    }

    const staleScript = document.querySelector('script[data-player-switch-module]');
    removePlayerResourceSwitchScript(staleScript);

    playerResourceSwitchLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');

        const handleLoad = () => {
            if (window.OpenStreamResourceSwitch) {
                script.dataset.playerSwitchState = 'ready';
                resolve(window.OpenStreamResourceSwitch);
                return;
            }
            script.dataset.playerSwitchState = 'failed';
            removePlayerResourceSwitchScript(script);
            playerResourceSwitchLoadPromise = null;
            reject(new Error('换源模块初始化失败'));
        };
        const handleError = () => {
            script.dataset.playerSwitchState = 'failed';
            removePlayerResourceSwitchScript(script);
            playerResourceSwitchLoadPromise = null;
            reject(new Error('换源模块加载失败'));
        };

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
        script.src = source;
        script.async = true;
        script.dataset.playerSwitchModule = 'true';
        script.dataset.playerSwitchState = 'loading';
        document.head.appendChild(script);
    });

    return playerResourceSwitchLoadPromise;
}

async function showSwitchResourceModal(...args) {
    try {
        const resourceSwitch = await loadPlayerResourceSwitch();
        return resourceSwitch.showSwitchResourceModal(...args);
    } catch (error) {
        console.error('换源模块加载失败:', error);
        showToast('换源功能加载失败，请稍后重试', 'error');
        return false;
    }
}

async function switchToResource(...args) {
    const resourceSwitch = await loadPlayerResourceSwitch();
    return resourceSwitch.switchToResource(...args);
}

async function autoSwitchToBestResource(...args) {
    try {
        const resourceSwitch = await loadPlayerResourceSwitch();
        return resourceSwitch.autoSwitchToBestResource(...args);
    } catch (error) {
        console.warn('自动换线模块加载失败:', error);
        return false;
    }
}

window.loadPlayerResourceSwitch = loadPlayerResourceSwitch;
window.showSwitchResourceModal = showSwitchResourceModal;
window.switchToResource = switchToResource;
window.autoSwitchToBestResource = autoSwitchToBestResource;

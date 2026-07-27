async function sha256(message) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
        throw new Error('当前浏览器不支持安全哈希功能');
    }
    const input = new TextEncoder().encode(String(message));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

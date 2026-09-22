(function () {
    function authorize(url, signal) {
        if (signal?.aborted) return Promise.reject(Error('aborted'));
        return new Promise((resolve, reject) => {
            const abort = () => finish(Error('aborted'));
            function finish(error, value) {
                signal?.removeEventListener('abort', abort);
                error ? reject(error) : resolve(value);
            }
            signal?.addEventListener('abort', abort, { once: true });
            // The shared credential refresh may outlive this playback session.
            Promise.resolve().then(() => window.ProxyAuth.addAuthToProxyUrl(url))
                .then(value => finish(null, value), error => finish(error));
        });
    }
    async function read(url, { signal, maxBytes }) {
        if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 8 * 1024 * 1024) throw Error('invalid_limit');
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw Error('invalid_target');
        const proxy = await authorize('/proxy/' + encodeURIComponent(target.href) + '?inspect=manifest', signal);
        if (signal?.aborted) throw Error('aborted');
        const response = await fetch(proxy, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
        if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('unavailable'); }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
            await response.body.cancel(); throw Error('response_limit');
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                if (signal?.aborted) throw Error('aborted');
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxBytes) throw Error('response_limit');
                chunks.push(value);
            }
            const result = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
            return result;
        } finally {
            await reader.cancel().catch(() => {}); reader.releaseLock();
        }
    }
    window.OpenStreamNativeAdTransport = { read };
})();

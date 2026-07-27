(function (root) {
    'use strict';

    const DEFAULT_MANIFEST_LIMIT = 512 * 1024;
    const SEGMENT_SAMPLE_BYTES = 4096;
    const PLAYLIST_CONTENT_TYPE = /(?:mpegurl|x-mpegurl)/i;
    const DIRECT_MEDIA_CONTENT_TYPE = /^(?:video|audio)\//i;
    const SEGMENT_MEDIA_CONTENT_TYPE = /^(?:video|audio)\/|^(?:application\/(?:octet-stream|mp4)|binary\/octet-stream)$/i;
    const EXPLICIT_NON_MEDIA_CONTENT_TYPE = /^(?:image|text)\//i;

    function elapsed(startedAt) {
        return Math.max(0, Math.round(performance.now() - startedAt));
    }

    function normalizeContentType(response) {
        return String(response.headers?.get?.('content-type') || '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
    }

    function looksLikeHtmlOrJson(text, contentType) {
        const sample = String(text || '').trimStart().slice(0, 256).toLowerCase();
        return contentType.includes('text/html')
            || contentType.includes('application/json')
            || sample.startsWith('<!doctype html')
            || sample.startsWith('<html')
            || sample.startsWith('{')
            || sample.startsWith('[');
    }

    function hasTransportStreamSignature(bytes) {
        return bytes.byteLength > 188 &&
            bytes[0] === 0x47 &&
            bytes[188] === 0x47;
    }

    function hasIsoBmffSignature(bytes) {
        if (bytes.byteLength < 8) return false;
        const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        return ['ftyp', 'styp', 'moof', 'mdat'].includes(box);
    }

    function hasAudioSignature(bytes) {
        if (bytes.byteLength < 3) return false;
        const hasId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
        const hasAdts = bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
        return hasId3 || hasAdts;
    }

    function hasContainerSignature(bytes) {
        if (bytes.byteLength < 4) return false;
        const isWebm = bytes[0] === 0x1a && bytes[1] === 0x45 &&
            bytes[2] === 0xdf && bytes[3] === 0xa3;
        const isFlv = bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56;
        const isOgg = bytes[0] === 0x4f && bytes[1] === 0x67 &&
            bytes[2] === 0x67 && bytes[3] === 0x53;
        return isWebm || isFlv || isOgg;
    }

    function isValidMediaPayload(bytes, contentType) {
        if (!bytes.byteLength || EXPLICIT_NON_MEDIA_CONTENT_TYPE.test(contentType)) return false;
        const signatureValid = hasTransportStreamSignature(bytes) ||
            hasIsoBmffSignature(bytes) ||
            hasAudioSignature(bytes) ||
            hasContainerSignature(bytes);
        if (signatureValid) return true;
        if (SEGMENT_MEDIA_CONTENT_TYPE.test(contentType)) {
            return !/^(?:application|binary)\/octet-stream$/i.test(contentType);
        }
        return false;
    }

    async function readLimited(response, maxBytes) {
        if (!response.body?.getReader) {
            const buffer = new Uint8Array(await response.arrayBuffer());
            return buffer.slice(0, maxBytes);
        }

        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (total < maxBytes) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value?.byteLength) continue;
                const remaining = maxBytes - total;
                const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
                chunks.push(chunk);
                total += chunk.byteLength;
            }
        } finally {
            try { await reader.cancel(); } catch (_) {}
        }

        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    }

    function decodeText(bytes) {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }

    function parseAttributeList(line) {
        const attributes = {};
        const value = String(line || '').slice(String(line || '').indexOf(':') + 1);
        const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
        let match;
        while ((match = pattern.exec(value))) {
            const raw = match[2].trim();
            attributes[match[1].toUpperCase()] = raw.startsWith('"') && raw.endsWith('"')
                ? raw.slice(1, -1)
                : raw;
        }
        return attributes;
    }

    function parseFirstPlaylistUri(manifest) {
        const lines = String(manifest || '').split(/\r?\n/);
        let followsVariant = false;
        let mediaSequence = 0;
        let activeEncryption = null;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                const parsed = Number.parseInt(line.slice(line.indexOf(':') + 1), 10);
                if (Number.isFinite(parsed) && parsed >= 0) mediaSequence = parsed;
                continue;
            }
            if (line.startsWith('#EXT-X-KEY:')) {
                const attributes = parseAttributeList(line);
                activeEncryption = attributes.METHOD === 'NONE'
                    ? null
                    : {
                        method: attributes.METHOD || '',
                        uri: attributes.URI || '',
                        iv: attributes.IV || '',
                        sequence: mediaSequence
                    };
                continue;
            }
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                followsVariant = true;
                continue;
            }
            if (line.startsWith('#')) continue;
            return {
                uri: line,
                playlist: followsVariant || /\.m3u8(?:$|[?#])/i.test(line),
                encryption: activeEncryption ? { ...activeEncryption } : null
            };
        }
        return null;
    }

    function resolveMediaUrl(value, baseUrl) {
        try {
            const documentBase = root.location?.href || 'http://localhost/';
            const absoluteBase = new URL(baseUrl, documentBase);
            return new URL(value, absoluteBase).href;
        } catch (_) {
            return '';
        }
    }

    async function fetchResponse(fetchImpl, url, signal, headers) {
        const response = await fetchImpl(url, {
            method: 'GET',
            cache: 'no-store',
            mode: 'cors',
            credentials: 'same-origin',
            signal,
            headers
        });
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: `HTTP ${response.status}`
            };
        }
        return { ok: true, response };
    }

    function parseEncryptionIv(value, sequence) {
        const raw = String(value || '').replace(/^0x/i, '');
        if (raw) {
            if (!/^[a-f0-9]{1,32}$/i.test(raw)) return null;
            const padded = raw.padStart(32, '0');
            return Uint8Array.from(
                Array.from({ length: 16 }, (_, index) => (
                    Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16)
                ))
            );
        }

        const iv = new Uint8Array(16);
        let remaining;
        try {
            remaining = BigInt(Math.max(0, Number(sequence) || 0));
        } catch (_) {
            return null;
        }
        for (let index = 15; index >= 0 && remaining > 0n; index -= 1) {
            iv[index] = Number(remaining & 0xffn);
            remaining >>= 8n;
        }
        return iv;
    }

    async function inspectEncryptedSegment(fetchImpl, bytes, encryption, signal) {
        if (String(encryption?.method || '').toUpperCase() !== 'AES-128') {
            return {
                ok: false,
                inconclusive: true,
                error: `暂不验证加密方式 ${encryption?.method || 'unknown'}`
            };
        }
        if (!encryption.keyUrl) {
            return { ok: false, error: '加密清单缺少密钥地址' };
        }
        const subtle = root.crypto?.subtle;
        if (!subtle) {
            return { ok: false, inconclusive: true, error: '当前环境无法验证加密分片' };
        }

        const keyRequest = await fetchResponse(fetchImpl, encryption.keyUrl, signal);
        if (!keyRequest.ok) return keyRequest;
        const keyBytes = await readLimited(keyRequest.response, 64);
        if (keyBytes.byteLength !== 16) {
            return { ok: false, error: 'AES-128 密钥长度无效' };
        }

        const cipherLength = Math.floor(bytes.byteLength / 16) * 16;
        if (cipherLength < 208) {
            return { ok: false, inconclusive: true, error: '加密分片样本过短' };
        }
        const cipherBytes = bytes.slice(0, cipherLength);
        const iv = parseEncryptionIv(encryption.iv, encryption.sequence);
        if (!iv) return { ok: false, inconclusive: true, error: '加密分片 IV 无效' };

        try {
            const key = await subtle.importKey(
                'raw',
                keyBytes,
                { name: 'AES-CBC' },
                false,
                ['encrypt', 'decrypt']
            );
            // Add a synthetic padding block so WebCrypto can decrypt a bounded
            // Range sample without downloading the complete media segment.
            const previousBlock = cipherBytes.slice(cipherBytes.byteLength - 16);
            const paddingCipher = new Uint8Array(await subtle.encrypt(
                { name: 'AES-CBC', iv: previousBlock },
                key,
                new Uint8Array(0)
            )).slice(0, 16);
            const paddedCipher = new Uint8Array(cipherBytes.byteLength + 16);
            paddedCipher.set(cipherBytes);
            paddedCipher.set(paddingCipher, cipherBytes.byteLength);
            const plaintext = new Uint8Array(await subtle.decrypt(
                { name: 'AES-CBC', iv },
                key,
                paddedCipher
            ));
            const valid = isValidMediaPayload(plaintext, 'application/octet-stream');
            return {
                ok: valid,
                encrypted: true,
                decryptedBytes: plaintext.byteLength,
                error: valid ? null : '解密后的媒体分片内容无效'
            };
        } catch (_) {
            return { ok: false, inconclusive: true, error: '加密分片验证失败' };
        }
    }

    async function inspectSegment(fetchImpl, url, signal, encryption = null) {
        const request = await fetchResponse(fetchImpl, url, signal, {
            Range: `bytes=0-${SEGMENT_SAMPLE_BYTES - 1}`
        });
        if (!request.ok) return request;

        const contentType = normalizeContentType(request.response);
        const bytes = await readLimited(request.response, SEGMENT_SAMPLE_BYTES);
        const sample = decodeText(bytes);
        if (EXPLICIT_NON_MEDIA_CONTENT_TYPE.test(contentType)) {
            return {
                ok: false,
                status: request.response.status,
                contentType,
                bytes: bytes.byteLength,
                error: '媒体分片内容无效'
            };
        }
        if (encryption) {
            const encryptedResult = await inspectEncryptedSegment(
                fetchImpl,
                bytes,
                encryption,
                signal
            );
            return {
                ...encryptedResult,
                status: encryptedResult.status || request.response.status,
                contentType,
                bytes: bytes.byteLength
            };
        }
        const invalidPayload = looksLikeHtmlOrJson(sample, contentType) ||
            !isValidMediaPayload(bytes, contentType);
        return {
            ok: !invalidPayload,
            status: request.response.status,
            contentType,
            bytes: bytes.byteLength,
            error: invalidPayload ? '媒体分片内容无效' : null
        };
    }

    async function probePlayback(url, options = {}) {
        const fetchImpl = options.fetchImpl || root.fetch?.bind(root);
        if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
        if (!url) return { ok: false, playOk: false, segmentOk: false, error: '播放地址为空' };

        const startedAt = performance.now();
        const maxManifestBytes = Math.max(1024, options.maxManifestBytes || DEFAULT_MANIFEST_LIMIT);
        const maxPlaylistDepth = Math.max(0, options.maxPlaylistDepth ?? 2);
        let currentUrl = url;

        for (let depth = 0; depth <= maxPlaylistDepth; depth += 1) {
            const request = await fetchResponse(fetchImpl, currentUrl, options.signal);
            if (!request.ok) {
                return {
                    ...request,
                    playOk: false,
                    segmentOk: false,
                    ms: elapsed(startedAt)
                };
            }

            const contentType = normalizeContentType(request.response);
            const expectedPlaylist = PLAYLIST_CONTENT_TYPE.test(contentType)
                || /\.m3u8(?:$|[?#])/i.test(currentUrl);
            const bytes = await readLimited(
                request.response,
                expectedPlaylist ? maxManifestBytes : SEGMENT_SAMPLE_BYTES
            );
            const sample = decodeText(bytes);

            if (
                looksLikeHtmlOrJson(sample, contentType) ||
                bytes.byteLength === 0 ||
                EXPLICIT_NON_MEDIA_CONTENT_TYPE.test(contentType)
            ) {
                return {
                    ok: false,
                    playOk: false,
                    segmentOk: false,
                    status: request.response.status,
                    contentType,
                    ms: elapsed(startedAt),
                    error: '播放响应不是有效媒体'
                };
            }

            const isPlaylist = expectedPlaylist || sample.trimStart().startsWith('#EXTM3U');
            if (!isPlaylist) {
                const directMedia = DIRECT_MEDIA_CONTENT_TYPE.test(contentType)
                    ? true
                    : isValidMediaPayload(bytes, contentType);
                return {
                    ok: directMedia,
                    playOk: directMedia,
                    segmentOk: directMedia,
                    status: request.response.status,
                    contentType,
                    ms: elapsed(startedAt),
                    error: directMedia ? null : '响应类型不是可识别媒体'
                };
            }

            if (!sample.trimStart().startsWith('#EXTM3U')) {
                return {
                    ok: false,
                    playOk: false,
                    segmentOk: false,
                    status: request.response.status,
                    contentType,
                    ms: elapsed(startedAt),
                    error: 'HLS 清单格式无效'
                };
            }

            const firstEntry = parseFirstPlaylistUri(sample);
            const nextUrl = firstEntry && resolveMediaUrl(firstEntry.uri, currentUrl);
            if (!nextUrl) {
                return {
                    ok: false,
                    playOk: false,
                    segmentOk: false,
                    status: request.response.status,
                    contentType,
                    ms: elapsed(startedAt),
                    error: 'HLS 清单没有可播放分片'
                };
            }

            if (firstEntry.playlist && depth < maxPlaylistDepth) {
                currentUrl = nextUrl;
                continue;
            }

            const encryption = firstEntry.encryption
                ? {
                    ...firstEntry.encryption,
                    keyUrl: resolveMediaUrl(firstEntry.encryption.uri, currentUrl)
                }
                : null;
            const segment = await inspectSegment(
                fetchImpl,
                nextUrl,
                options.signal,
                encryption
            );
            return {
                ok: !!segment.ok,
                playOk: !!segment.ok,
                segmentOk: !!segment.ok,
                encrypted: !!segment.encrypted,
                inconclusive: !!segment.inconclusive,
                status: segment.status,
                contentType,
                segmentContentType: segment.contentType,
                bytes: segment.bytes,
                ms: elapsed(startedAt),
                error: segment.error || null
            };
        }

        return {
            ok: false,
            playOk: false,
            segmentOk: false,
            ms: elapsed(startedAt),
            error: 'HLS 清单嵌套层级过深'
        };
    }

    root.OpenStreamPlaybackQuality = Object.freeze({
        probePlayback,
        parseFirstPlaylistUri
    });
})(typeof window !== 'undefined' ? window : globalThis);

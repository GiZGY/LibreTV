import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto, createHash } from 'node:crypto';
import vm from 'node:vm';

// Private review bundles stay outside the repository. Export only whitelisted hashes/times.
export function publicEvidence(value) {
    return { schema: value.schema, mediaUrlSha256: value.mediaUrlSha256,
        manifestSha256: value.manifestSha256, reviewedAt: value.reviewedAt, expiresAt: value.expiresAt,
        ...(value.entry ? { entry: { urlSha256: value.entry.urlSha256, manifestSha256: value.entry.manifestSha256 } } : {}),
        timeline: { engine: value.timeline?.engine, start: value.timeline?.start, duration: value.timeline?.duration },
        ranges: value.ranges?.map(range => ({ ruleId: range.ruleId, start: range.start, end: range.end,
            segments: range.segments?.map(segment => ({ index: segment.index, identity: segment.identity })) })) };
}

export async function verifyReview(bundlePath) {
    const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const directory = await realpath(dirname(resolve(bundlePath)));
    if ((await stat(bundlePath)).size > 1024 * 1024) throw Error('Review bundle too large');
    const bytes = await readFile(bundlePath);
    if (bytes.length > 1024 * 1024) throw Error('Review bundle too large');
    const bundle = JSON.parse(bytes);
    if (!Array.isArray(bundle.resources) || bundle.resources.length > 256) throw Error('Invalid resource map');
    const resources = new Map();
    for (const item of bundle.resources) {
        if (typeof item.url !== 'string' || typeof item.file !== 'string' || resources.has(item.url)) throw Error('Invalid resource entry');
        const path = await realpath(resolve(directory, item.file));
        const within = relative(directory, path);
        if (within.startsWith('..') || isAbsolute(within)) throw Error('Resource must stay in review directory');
        resources.set(item.url, path);
    }
    const context = { window: { crypto: webcrypto }, crypto: webcrypto, TextEncoder, TextDecoder,
        URL, Uint8Array, ArrayBuffer, AbortController, setTimeout, clearTimeout };
    vm.createContext(context);
    for (const file of ['ad-rules.js', 'ad-guard.js', 'native-ad-evidence.js', 'native-ad-verifier.js']) {
        vm.runInContext(await readFile(resolve(root, 'js', file), 'utf8'), context, { filename: file });
    }
    const evidence = publicEvidence(bundle.evidence || {});
    const inspectedResources = [];
    const result = await context.window.OpenStreamNativeAdVerifier.verify({
        mediaUrl: bundle.mediaUrl, evidence, rules: context.window.OpenStreamAdRules,
        read: async (url, { maxBytes, signal }) => {
            if (signal.aborted) throw Error('Aborted');
            const path = resources.get(url);
            if (!path || (await stat(path)).size > maxBytes) throw Error('Missing or oversized resource');
            const data = new Uint8Array(await readFile(path, { signal }));
            if (data.length > maxBytes) throw Error('Resource changed size');
            inspectedResources.push({ urlSha256: createHash('sha256').update(url).digest('hex'),
                bodySha256: createHash('sha256').update(data).digest('hex'), maxBytes: data.length });
            return data;
        }
    });
    if (result.status !== 'verified') throw Error('Review byte verification failed');
    return { evidence, requests: result.requests, bytes: result.bytes, verification: result.verification, inspectedResources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [bundle, output, ...extra] = process.argv.slice(2);
        if (!bundle || !output || extra.length) throw Error('Usage: node scripts/verify-native-ad-review.mjs PRIVATE_BUNDLE.json NEW_OUTPUT.json');
        const result = await verifyReview(bundle);
        await writeFile(output, JSON.stringify(result.evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ status: 'bytes_verified', requests: result.requests, bytes: result.bytes,
            nativeTimeline: 'requires independent native playback review', published: false }));
    } catch (_) {
        console.error('Native review rejected. Check bundle, local evidence, rule validity and a new output path. No rule published.');
        process.exitCode = 1;
    }
}

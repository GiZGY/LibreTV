import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const records = JSON.parse(readFileSync(new URL('./native-inspection.json', import.meta.url), 'utf8'));
export const inspectionHash = value => createHash('sha256').update(value).digest('hex');
// Leave headroom below the serverless buffered-response ceiling.
export const MAX_NATIVE_INSPECTION_BYTES = 4 * 1024 * 1024;
export function nativeInspectionResource(url, now = Date.now(), registry = records) {
    const hash = inspectionHash(url);
    for (const record of registry) {
        const start = Date.parse(record.reviewedAt), end = Date.parse(record.expiresAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end - start > 30 * 86400000) continue;
        const resource = record.resources?.find(item => item.urlSha256 === hash);
        if (resource && /^[a-f0-9]{64}$/.test(resource.bodySha256) &&
            Number.isInteger(resource.maxBytes) && resource.maxBytes > 0 && resource.maxBytes <= MAX_NATIVE_INSPECTION_BYTES) return resource;
    }
    return null;
}

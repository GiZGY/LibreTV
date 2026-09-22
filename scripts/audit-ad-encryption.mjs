import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runAudit } from './audit-source-ads.mjs';
import { parseMediaPlaylist } from './audit-hls-ads.mjs';
import { fetchWithTimeout, readResponseBytes } from '../bridge/tvbox-bridge/src/http.mjs';

export async function decryptSample(payload, key, iv) {
  if (key.byteLength !== 16 || iv.byteLength !== 16 || !payload.byteLength ||
      payload.byteLength % 16 || payload.byteLength > 8 * 1024 * 1024) throw new Error('Invalid AES sample');
  const imported = await webcrypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-CBC', iv }, imported, payload));
}

export function transportStream(bytes) {
  // Structural evidence only, not successful audiovisual decoding or ad detection.
  return bytes.length >= 188 * 5 && bytes.length % 188 === 0 &&
    Array.from({ length: 5 }, (_, i) => bytes[i * 188]).every(value => value === 0x47);
}

async function read(url, limit, signal) {
  return fetchWithTimeout(fetch, url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, {
    signal, timeoutMs: 12000, consume: async response => {
      if (!response.ok) { await response.body?.cancel(); throw new Error('Unavailable sample'); }
      return readResponseBytes(response, limit);
    }
  });
}

export async function auditEncryption() {
  const signal = AbortSignal.timeout(120000);
  return runAudit({ sources: ['jisu', 'guangsu', 'huya', 'hongniu'],
    queries: [{ keyword: 'X战警', title: 'X战警：天启' }], signal,
    onMedia: async ({ media }) => {
      const tags = media.text.split(/\r?\n/).filter(line => line.startsWith('#EXT-X-KEY:'));
      if (tags.length !== 1) return { status: 'unsupported_key_rotation' };
      const tag = tags[0];
      const method = tag.match(/(?:^|[:,])METHOD=([^,]+)/)?.[1];
      const format = tag.match(/(?:^|,)KEYFORMAT="([^"]*)"/)?.[1] || 'identity';
      const ivHex = tag.match(/(?:^|,)IV=0x([a-fA-F0-9]{32})(?:,|$)/)?.[1];
      const uri = tag.match(/(?:^|,)URI="([^"]+)"/)?.[1];
      if (method !== 'AES-128' || format !== 'identity' || !ivHex || !uri)
        return { status: 'unsupported_encryption' };
      const parts = parseMediaPlaylist(media.text);
      const part = parts[Math.floor(parts.length / 2)];
      if (!part || part.byteRange || part.initMap || part.gap) return { status: 'unsupported_segment' };
      let key, plaintext;
      try {
        key = await read(new URL(uri, media.url).href, 16, signal);
        const payload = await read(new URL(part.url, media.url).href, 8 * 1024 * 1024, signal);
        plaintext = await decryptSample(payload, key, Buffer.from(ivHex, 'hex'));
        return { status: 'decrypted_sample', method, format, ciphertextBytes: payload.length,
          plaintextBytes: plaintext.length, transportStream: transportStream(plaintext),
          adClassification: 'not_executed', persistedMediaOrKeys: false };
      } catch (_) { return { status: 'sample_verification_failed' }; }
      finally { key?.fill(0); plaintext?.fill(0); }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditEncryption();
  await fs.writeFile(new URL('../docs/reviews/ad-aes-samples-2026-09-22.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.rows.map(row => ({ source: row.source, status: row.status,
    samples: row.lines.map(line => line.observation) })), null, 2));
}

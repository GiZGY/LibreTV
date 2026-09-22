import { webcrypto } from 'node:crypto';

export function aesInspection(text, base, read, budget) {
  const tags = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('#EXT-X-KEY:'));
  if (tags.length !== 1 || text.indexOf(tags[0]) > text.indexOf('#EXTINF:')) return null;
  const tag = tags[0];
  const attributes = new Map();
  const items = tag.slice(11).match(/[^=,]+=(?:"[^"]*"|[^,]*)/g) || [];
  if (items.join(',') !== tag.slice(11)) return null;
  for (const item of items) {
    const split = item.indexOf('='), name = item.slice(0, split);
    if (attributes.has(name)) return null;
    attributes.set(name, item.slice(split + 1).replace(/^"|"$/g, ''));
  }
  if (attributes.get('METHOD') !== 'AES-128' ||
      (attributes.get('KEYFORMAT') || 'identity') !== 'identity' ||
      !/^0x[a-fA-F0-9]{32}$/.test(attributes.get('IV') || '') || !attributes.get('URI')) return null;
  const iv = Buffer.from(attributes.get('IV').slice(2), 'hex');
  const keyUrl = new URL(attributes.get('URI'), base).href;
  let imported;
  return {
    // Discovery only: neither the upstream playlist nor playback is modified.
    discoveryText: text.replace(tag, '#EXT-X-KEY:METHOD=NONE'),
    async decrypt(bytes) {
      if (!bytes.byteLength || bytes.byteLength % 16 || bytes.byteLength > 8 * 1024 * 1024)
        throw new Error('Invalid encrypted sample');
      imported ||= (async () => {
        const raw = await read(keyUrl, budget);
        try {
          if (raw.byteLength !== 16) throw new Error('Invalid sample key');
          return await webcrypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']);
        } finally { raw.fill(0); }
      })();
      return Buffer.from(await webcrypto.subtle.decrypt({name:'AES-CBC',iv}, await imported, bytes));
    }
  };
}

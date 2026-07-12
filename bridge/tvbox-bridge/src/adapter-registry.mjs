import { libvioAdapter } from './adapters/libvio.mjs';
import { jianpianAdapter } from './adapters/jianpian.mjs';
import { guaziAdapter } from './adapters/guazi.mjs';

const adapters = new Map([
  [libvioAdapter.key, libvioAdapter],
  [jianpianAdapter.key, jianpianAdapter],
  [guaziAdapter.key, guaziAdapter]
]);

export function getAdapter(sourceKey) {
  return adapters.get(sourceKey) || null;
}

export function hasAdapter(sourceKey) {
  return adapters.has(sourceKey);
}

export function listAdapterKeys() {
  return Array.from(adapters.keys());
}

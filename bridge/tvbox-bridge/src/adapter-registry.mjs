import { libvioAdapter } from './adapters/libvio.mjs';

const adapters = new Map([
  [libvioAdapter.key, libvioAdapter]
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

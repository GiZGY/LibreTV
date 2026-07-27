const DEFAULT_MAX_ENTRIES = 240;

function createAbortError(reason, message = 'Request aborted') {
  const error = reason instanceof Error ? reason : new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createResponseCache({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const entries = new Map();
  const inFlight = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key, value, ttlMs) {
    if (!(ttlMs > 0)) return value;
    entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
    return value;
  }

  function waitForSharedTask(shared, signal) {
    if (signal?.aborted) return Promise.reject(createAbortError(signal.reason));

    shared.waiters += 1;
    let settled = false;

    return new Promise((resolve, reject) => {
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        shared.waiters = Math.max(0, shared.waiters - 1);
        if (shared.waiters === 0 && !shared.settled) {
          shared.controller.abort(createAbortError(null, 'All request waiters disconnected'));
        }
      };
      const onAbort = () => {
        release();
        reject(createAbortError(signal.reason));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (value) => {
          release();
          resolve(value);
        },
        (error) => {
          release();
          reject(error);
        }
      );
    });
  }

  async function getOrCreate(key, factory, options = {}) {
    const cached = get(key);
    if (cached) return { value: cached, cacheStatus: 'HIT' };
    if (options.signal?.aborted) throw createAbortError(options.signal.reason);

    const existing = inFlight.get(key);
    if (existing) {
      return {
        value: await waitForSharedTask(existing, options.signal),
        cacheStatus: 'COALESCED'
      };
    }

    const controller = new AbortController();
    const shared = {
      controller,
      promise: null,
      settled: false,
      waiters: 0
    };
    shared.promise = Promise.resolve()
      .then(() => factory(controller.signal))
      .then((value) => {
        const ttlMs = typeof options.ttlForValue === 'function'
          ? options.ttlForValue(value)
          : options.ttlMs;
        if (ttlMs > 0) set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        shared.settled = true;
        inFlight.delete(key);
      });
    inFlight.set(key, shared);
    return {
      value: await waitForSharedTask(shared, options.signal),
      cacheStatus: 'MISS'
    };
  }

  return {
    get,
    set,
    getOrCreate,
    clear() {
      entries.clear();
      inFlight.forEach((shared) => {
        shared.controller.abort(createAbortError(null, 'Response cache cleared'));
      });
      inFlight.clear();
    },
    stats() {
      return { entries: entries.size, inFlight: inFlight.size };
    }
  };
}

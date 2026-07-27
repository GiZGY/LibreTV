function abortError(reason, message = 'Queued bridge request aborted') {
  const error = reason instanceof Error ? reason : new Error(message);
  error.name = 'AbortError';
  return error;
}

function busyError() {
  const error = new Error('Bridge adapter queue is full');
  error.code = 'BRIDGE_BUSY';
  return error;
}

export function createConcurrencyLimiter({ maxConcurrent = 12, maxQueue = 64 } = {}) {
  const concurrency = Math.max(1, Number(maxConcurrent) || 1);
  const queueLimit = Math.max(0, Number(maxQueue) || 0);
  const queue = [];
  let active = 0;

  function drain() {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift();
      if (job.signal?.aborted) {
        job.reject(abortError(job.signal.reason));
        continue;
      }

      job.signal?.removeEventListener('abort', job.onAbort);
      active += 1;
      Promise.resolve()
        .then(job.factory)
        .then(job.resolve, job.reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          drain();
        });
    }
  }

  function run(factory, { signal } = {}) {
    if (typeof factory !== 'function') {
      return Promise.reject(new TypeError('Limiter factory is required'));
    }
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    return new Promise((resolve, reject) => {
      const job = {
        factory,
        signal,
        resolve,
        reject,
        onAbort: null
      };

      if (active >= concurrency) {
        if (queue.length >= queueLimit) {
          reject(busyError());
          return;
        }
        job.onAbort = () => {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          reject(abortError(signal.reason));
        };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        queue.push(job);
        return;
      }

      queue.push(job);
      drain();
    });
  }

  return {
    run,
    stats() {
      return {
        active,
        queued: queue.length,
        maxConcurrent: concurrency,
        maxQueue: queueLimit
      };
    },
    clear() {
      for (const job of queue.splice(0)) {
        job.signal?.removeEventListener('abort', job.onAbort);
        job.reject(abortError(null, 'Bridge limiter cleared'));
      }
    }
  };
}

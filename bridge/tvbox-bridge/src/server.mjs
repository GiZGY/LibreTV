import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { STATUS, statusResponse } from './status.mjs';
import { getSource, listSources, summarizeSources } from './source-registry.mjs';
import { isAuthorized } from './auth.mjs';
import { getAdapter } from './adapter-registry.mjs';
import { createResponseCache } from './response-cache.mjs';
import { createConcurrencyLimiter } from './concurrency-limiter.mjs';

const DEFAULT_CACHE_ENTRIES = 240;
const DEFAULT_MAX_CONCURRENCY = 12;
const DEFAULT_MAX_QUEUE = 64;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function resolveBridgeConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'production').toLowerCase();
  const token = String(env.TVBOX_BRIDGE_TOKEN || '');
  const allowInsecureDevelopment =
    nodeEnv === 'development' &&
    env.BRIDGE_ALLOW_INSECURE_DEV === 'true';

  if (!token && !allowInsecureDevelopment) {
    throw new Error(
      'TVBOX_BRIDGE_TOKEN is required. Tokenless mode is only allowed with ' +
      'NODE_ENV=development and BRIDGE_ALLOW_INSECURE_DEV=true.'
    );
  }

  return {
    port: positiveInteger(env.PORT, 9979, 65535),
    host: env.HOST || '0.0.0.0',
    token,
    version: env.BRIDGE_VERSION || '0.1.1',
    nodeEnv,
    allowInsecureDevelopment,
    cacheMaxEntries: positiveInteger(
      env.BRIDGE_CACHE_MAX_ENTRIES,
      DEFAULT_CACHE_ENTRIES,
      5000
    ),
    maxConcurrency: positiveInteger(
      env.BRIDGE_MAX_CONCURRENCY,
      DEFAULT_MAX_CONCURRENCY,
      64
    ),
    maxQueue: positiveInteger(
      env.BRIDGE_MAX_QUEUE,
      DEFAULT_MAX_QUEUE,
      512
    )
  };
}

function createAbortError(reason, message = 'Bridge request aborted') {
  const error = reason instanceof Error ? reason : new Error(message);
  error.name = 'AbortError';
  return error;
}

function createRequestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(createAbortError(reason));
  };
  const onAborted = () => abort(null);
  const onClose = () => {
    if (!res.writableEnded) abort(null);
  };

  req.once('aborted', onAborted);
  res.once('close', onClose);

  return {
    signal: controller.signal,
    cleanup() {
      req.removeListener('aborted', onAborted);
      res.removeListener('close', onClose);
    }
  };
}

function ttlForAdapterResult(result, readyTtlMs) {
  if (result?.status === STATUS.READY) return readyTtlMs;
  if (result?.status === STATUS.NO_RESULT) return 20_000;
  if (result?.status === STATUS.LOGIN_REQUIRED) return 30_000;
  return 0;
}

function isResponseWritable(res) {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

export function createBridgeApp(
  config = resolveBridgeConfig(),
  dependencies = {}
) {
  const resolveSourceByKey = dependencies.getSource || getSource;
  const resolveAdapter = dependencies.getAdapter || getAdapter;
  const getSources = dependencies.listSources || listSources;
  const getSourceSummary = dependencies.summarizeSources || summarizeSources;
  const adapterCache = dependencies.adapterCache || createResponseCache({
    maxEntries: config.cacheMaxEntries
  });
  const adapterLimiter = dependencies.adapterLimiter || createConcurrencyLimiter({
    maxConcurrent: config.maxConcurrency,
    maxQueue: config.maxQueue
  });
  const app = express();

  app.disable('x-powered-by');

  async function runCachedAdapter(res, key, readyTtlMs, signal, factory) {
    const { value, cacheStatus } = await adapterCache.getOrCreate(key, (sharedSignal) => (
      adapterLimiter.run(() => factory(sharedSignal), { signal: sharedSignal })
    ), {
      signal,
      ttlForValue: (result) => ttlForAdapterResult(result, readyTtlMs)
    });
    if (!res.headersSent) res.setHeader('X-OpenStream-Cache', cacheStatus);
    return value;
  }

  function resolveSource(req, res) {
    const sourceKey = String(req.query.sourceKey || '').trim();
    if (!sourceKey || sourceKey.length > 64) {
      res.status(400).json(statusResponse(STATUS.UNSUPPORTED, 'Missing or invalid sourceKey'));
      return null;
    }
    const source = resolveSourceByKey(sourceKey);
    if (!source) {
      res.status(404).json(statusResponse(STATUS.UNSUPPORTED, 'Unknown TVBox source', { sourceKey }));
      return null;
    }
    return source;
  }

  function unsupportedBySource(source) {
    if (source.status === STATUS.LOGIN_REQUIRED) {
      return statusResponse(STATUS.LOGIN_REQUIRED, source.reason, { sourceKey: source.key, list: [] });
    }
    return statusResponse(STATUS.UNSUPPORTED, source.reason, { sourceKey: source.key, list: [] });
  }

  function sendAdapterError(res, error, requestSignal) {
    if (requestSignal?.aborted || !isResponseWritable(res)) return;
    const isBusy = error?.code === 'BRIDGE_BUSY';
    const isTimeout = error?.name === 'AbortError' || isBusy;
    const details = config.nodeEnv === 'development'
      ? { error: error?.message || String(error), list: [] }
      : { list: [] };
    res.status(isBusy ? 503 : 200).json(statusResponse(
      isTimeout ? STATUS.TIMEOUT : STATUS.ERROR,
      isBusy
        ? 'TVBox adapter queue is full'
        : (isTimeout ? 'TVBox adapter timed out' : 'TVBox adapter failed'),
      details
    ));
  }

  async function withRequestAbort(req, res, handler) {
    const request = createRequestAbortContext(req, res);
    try {
      return await handler(request.signal);
    } catch (error) {
      return sendAdapterError(res, error, request.signal);
    } finally {
      request.cleanup();
    }
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!isAuthorized(req, config.token, {
      allowInsecureDevelopment: config.allowInsecureDevelopment
    })) {
      return res.status(401).json(statusResponse(STATUS.UNSUPPORTED, 'Unauthorized bridge request'));
    }
    next();
  });

  app.get('/api/tvbox/health', (_req, res) => {
    res.json({
      status: STATUS.READY,
      service: 'openstream-tvbox-bridge',
      version: config.version,
      runtime: 'node',
      sourceSummary: getSourceSummary(),
      capabilities: {
        catvodSpider: false,
        credentialImport: false,
        cmsAdapter: false,
        httpAdapter: true
      },
      concurrency: adapterLimiter.stats()
    });
  });

  app.get('/api/tvbox/sources', (_req, res) => {
    res.json({
      status: STATUS.READY,
      list: getSources()
    });
  });

  app.get('/api/tvbox/search', async (req, res) => {
    const source = resolveSource(req, res);
    if (!source) return;
    const adapter = resolveAdapter(source.key);
    if (!adapter) {
      return res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json(unsupportedBySource(source));
    }

    return withRequestAbort(req, res, async (signal) => {
      const keyword = String(req.query.wd || req.query.keyword || '').trim();
      if (!keyword || keyword.length > 120) {
        return res.status(400).json(statusResponse(STATUS.NO_RESULT, 'Missing or invalid keyword', {
          sourceKey: source.key,
          list: []
        }));
      }
      const result = await runCachedAdapter(
        res,
        JSON.stringify(['search', source.key, keyword.toLowerCase()]),
        60_000,
        signal,
        (sharedSignal) => adapter.search(keyword, { signal: sharedSignal })
      );
      if (isResponseWritable(res)) return res.json(result);
    });
  });

  app.get('/api/tvbox/detail', async (req, res) => {
    const source = resolveSource(req, res);
    if (!source) return;
    const adapter = resolveAdapter(source.key);
    if (!adapter) {
      return res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
        ...unsupportedBySource(source),
        episodes: []
      });
    }

    return withRequestAbort(req, res, async (signal) => {
      const id = String(req.query.id || '').trim();
      if (!id || id.length > 512) {
        return res.status(400).json(statusResponse(STATUS.UNSUPPORTED, 'Missing or invalid video id', {
          sourceKey: source.key,
          episodes: []
        }));
      }
      const result = await runCachedAdapter(
        res,
        JSON.stringify(['detail', source.key, id]),
        5 * 60_000,
        signal,
        (sharedSignal) => adapter.detail(id, { signal: sharedSignal })
      );
      if (isResponseWritable(res)) return res.json(result);
    });
  });

  app.get('/api/tvbox/episodes', async (req, res) => {
    const source = resolveSource(req, res);
    if (!source) return;
    const adapter = resolveAdapter(source.key);
    if (!adapter) {
      return res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
        ...unsupportedBySource(source),
        episodes: []
      });
    }

    return withRequestAbort(req, res, async (signal) => {
      const id = String(req.query.id || '').trim();
      if (!id || id.length > 512) {
        return res.status(400).json(statusResponse(STATUS.UNSUPPORTED, 'Missing or invalid video id', {
          sourceKey: source.key,
          episodes: []
        }));
      }
      const detail = await runCachedAdapter(
        res,
        JSON.stringify(['detail', source.key, id]),
        5 * 60_000,
        signal,
        (sharedSignal) => adapter.detail(id, { signal: sharedSignal })
      );
      if (isResponseWritable(res)) {
        return res.json({
          status: detail.status,
          sourceKey: source.key,
          episodes: detail.episodes || []
        });
      }
    });
  });

  app.get('/api/tvbox/play', async (req, res) => {
    const source = resolveSource(req, res);
    if (!source) return;
    const adapter = resolveAdapter(source.key);
    if (!adapter) {
      return res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
        ...unsupportedBySource(source),
        url: ''
      });
    }

    return withRequestAbort(req, res, async (signal) => {
      const id = String(req.query.id || '').trim();
      const flag = String(req.query.flag || '').trim();
      const episode = String(req.query.episode || '0').trim();
      if (!id || id.length > 512 || flag.length > 128 || !/^\d{1,8}$/.test(episode)) {
        return res.status(400).json(statusResponse(STATUS.UNSUPPORTED, 'Invalid play parameters', {
          sourceKey: source.key,
          url: ''
        }));
      }
      const result = await runCachedAdapter(
        res,
        JSON.stringify(['play', source.key, id, flag, episode]),
        20_000,
        signal,
        (sharedSignal) => adapter.play(id, flag, episode, { signal: sharedSignal })
      );
      if (isResponseWritable(res)) return res.json(result);
    });
  });

  app.use((_req, res) => {
    res.status(404).json(statusResponse(STATUS.UNSUPPORTED, 'Unknown bridge endpoint'));
  });

  return app;
}

export function startBridgeServer(env = process.env) {
  const config = resolveBridgeConfig(env);
  const app = createBridgeApp(config);
  return app.listen(config.port, config.host, () => {
    console.log(`openstream-tvbox-bridge listening on ${config.host}:${config.port}`);
  });
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    startBridgeServer();
  } catch (error) {
    console.error(`[bridge] startup refused: ${error.message}`);
    process.exitCode = 1;
  }
}

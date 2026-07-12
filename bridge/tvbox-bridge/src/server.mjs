import express from 'express';
import { STATUS, statusResponse } from './status.mjs';
import { getSource, listSources, summarizeSources } from './source-registry.mjs';
import { isAuthorized } from './auth.mjs';
import { getAdapter } from './adapter-registry.mjs';

const config = {
  port: Number.parseInt(process.env.PORT || '9979', 10),
  token: process.env.TVBOX_BRIDGE_TOKEN || '',
  version: process.env.BRIDGE_VERSION || '0.1.0'
};

const app = express();

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req, config.token)) {
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
    sourceSummary: summarizeSources(),
    capabilities: {
      catvodSpider: false,
      credentialImport: false,
      cmsAdapter: false,
      httpAdapter: true
    }
  });
});

app.get('/api/tvbox/sources', (_req, res) => {
  res.json({
    status: STATUS.READY,
    list: listSources()
  });
});

function resolveSource(req, res) {
  const sourceKey = String(req.query.sourceKey || '').trim();
  if (!sourceKey) {
    res.status(400).json(statusResponse(STATUS.UNSUPPORTED, 'Missing sourceKey'));
    return null;
  }
  const source = getSource(sourceKey);
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

function sendAdapterError(res, error) {
  const isTimeout = error?.name === 'AbortError';
  res.status(200).json(statusResponse(
    isTimeout ? STATUS.TIMEOUT : STATUS.ERROR,
    isTimeout ? 'TVBox adapter timed out' : 'TVBox adapter failed',
    { error: error?.message || String(error), list: [] }
  ));
}

app.get('/api/tvbox/search', async (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  const adapter = getAdapter(source.key);
  if (adapter) {
    try {
      return res.json(await adapter.search(req.query.wd || req.query.keyword || ''));
    } catch (error) {
      return sendAdapterError(res, error);
    }
  }
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json(unsupportedBySource(source));
});

app.get('/api/tvbox/detail', async (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  const adapter = getAdapter(source.key);
  if (adapter) {
    try {
      return res.json(await adapter.detail(req.query.id || ''));
    } catch (error) {
      return sendAdapterError(res, error);
    }
  }
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
    ...unsupportedBySource(source),
    episodes: []
  });
});

app.get('/api/tvbox/episodes', async (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  const adapter = getAdapter(source.key);
  if (adapter) {
    try {
      const detail = await adapter.detail(req.query.id || '');
      return res.json({
        status: detail.status,
        sourceKey: source.key,
        episodes: detail.episodes || []
      });
    } catch (error) {
      return sendAdapterError(res, error);
    }
  }
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
    ...unsupportedBySource(source),
    episodes: []
  });
});

app.get('/api/tvbox/play', async (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  const adapter = getAdapter(source.key);
  if (adapter) {
    try {
      return res.json(await adapter.play(req.query.id || '', req.query.flag || '', req.query.episode || 0));
    } catch (error) {
      return sendAdapterError(res, error);
    }
  }
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
    ...unsupportedBySource(source),
    url: ''
  });
});

app.use((_req, res) => {
  res.status(404).json(statusResponse(STATUS.UNSUPPORTED, 'Unknown bridge endpoint'));
});

app.listen(config.port, () => {
  console.log(`openstream-tvbox-bridge listening on ${config.port}`);
});

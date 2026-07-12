import express from 'express';
import { STATUS, statusResponse } from './status.mjs';
import { getSource, listSources, summarizeSources } from './source-registry.mjs';
import { isAuthorized } from './auth.mjs';

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
      cmsAdapter: false
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

app.get('/api/tvbox/search', (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json(unsupportedBySource(source));
});

app.get('/api/tvbox/detail', (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
    ...unsupportedBySource(source),
    episodes: []
  });
});

app.get('/api/tvbox/episodes', (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
  res.status(source.status === STATUS.LOGIN_REQUIRED ? 200 : 501).json({
    ...unsupportedBySource(source),
    episodes: []
  });
});

app.get('/api/tvbox/play', (req, res) => {
  const source = resolveSource(req, res);
  if (!source) return;
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

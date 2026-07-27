import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import authHandler from './api/auth/[action].mjs';
import proxyHandler from './api/proxy/[...path].mjs';
import {
  isPasswordConfigured,
  isRequestAuthenticated
} from './server/auth-session.mjs';
import {
  proxyTvboxBridgeRequest,
  writeBridgeJsonResponse
} from './server/tvbox-bridge-proxy.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number.parseInt(process.env.PORT || '8080', 10);
const debug = process.env.DEBUG === 'true';
const app = express();

app.disable('x-powered-by');
app.use(compression());
const corsOrigin = String(process.env.CORS_ORIGIN || '').trim();
if (corsOrigin) {
  const allowAnyOrigin = corsOrigin === '*';
  const allowedOrigins = new Set(
    corsOrigin.split(',').map((value) => value.trim()).filter(Boolean)
  );
  app.use(cors({
    origin: allowAnyOrigin
      ? '*'
      : (origin, callback) => callback(
        null,
        !origin || allowedOrigins.has(origin)
      ),
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
    credentials: !allowAnyOrigin
  }));
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '4kb', type: 'application/json' }));

function sendHtml(res, fileName) {
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(__dirname, fileName));
}

app.get(['/', '/index.html'], (_req, res) => sendHtml(res, 'index.html'));
app.get('/player.html', (_req, res) => sendHtml(res, 'player.html'));
app.get('/s=:keyword', (_req, res) => sendHtml(res, 'index.html'));
app.get('/about.html', (_req, res) => sendHtml(res, 'about.html'));
app.get('/privacy.html', (_req, res) => sendHtml(res, 'privacy.html'));
app.get(['/watch', '/watch.html'], (_req, res) => sendHtml(res, 'watch.html'));

const staticFileRoutes = new Map([
  ['/VERSION.txt', { fileName: 'VERSION.txt', cache: 'no-store' }],
  ['/manifest.json', { fileName: 'manifest.json', cache: 'public, max-age=300' }],
  ['/robots.txt', { fileName: 'robots.txt', cache: 'public, max-age=300' }]
]);
for (const [route, config] of staticFileRoutes) {
  app.get(route, (_req, res) => {
    res.setHeader('Cache-Control', config.cache);
    return res.sendFile(path.join(__dirname, config.fileName));
  });
}

app.all('/api/auth/:action', (req, res) => authHandler(req, res));

app.get('/api/tvbox/:action', async (req, res) => {
  if (!isPasswordConfigured(process.env)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(503).json({ status: 'unsupported', message: 'PASSWORD is not configured' });
  }
  if (!isRequestAuthenticated(req, process.env)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(401).json({ status: 'unsupported', message: 'Authentication required' });
  }

  const result = await proxyTvboxBridgeRequest({
    action: req.params.action,
    query: req.query,
    env: process.env,
    fetchImpl: globalThis.fetch
  });
  return writeBridgeJsonResponse(res, result);
});

app.all('/proxy/:encodedUrl', (req, res) => proxyHandler(req, res));

const immutableStaticOptions = {
  dotfiles: 'deny',
  fallthrough: true,
  index: false,
  redirect: false,
  maxAge: '1y',
  immutable: true
};
app.use('/compiled', express.static(path.join(__dirname, 'compiled'), immutableStaticOptions));
app.use('/libs', express.static(path.join(__dirname, 'libs'), immutableStaticOptions));
app.use('/image', express.static(path.join(__dirname, 'image'), immutableStaticOptions));

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large' || error instanceof SyntaxError) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(400).json({ error: 'Invalid request body' });
  }
  console.error('服务器错误:', debug ? error : error?.message);
  if (!res.headersSent) return res.status(500).send('服务器内部错误');
  if (!res.writableEnded) res.end();
});

app.use((_req, res) => res.status(404).send('页面未找到'));

app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
  console.log(isPasswordConfigured(process.env)
    ? '用户登录密码已设置'
    : '警告: 未设置 PASSWORD 环境变量，受保护功能将保持关闭');
  if (debug) console.log('调试模式已启用');
});

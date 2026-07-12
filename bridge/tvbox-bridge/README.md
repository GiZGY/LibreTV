# OpenStream TVBox Bridge

这是 OpenStream 网站接入电视端源的独立 VPS bridge 服务。

## 当前能力

- 提供 `/api/tvbox/health`、`/api/tvbox/sources`、`/api/tvbox/search`、`/api/tvbox/detail`、`/api/tvbox/episodes`、`/api/tvbox/play`。
- 使用统一状态：`ready`、`timeout`、`unsupported`、`login_required`、`no_result`、`error`。
- 明确标记 8 个需要登录/本机凭据验证的网盘源。
- 对当前无法在 Node/VPS 内直接执行的 CatVod spider 源返回 `unsupported`，不伪装为无结果。

## 运行

```bash
npm install
npm run smoke
```

Docker：

```bash
cp .env.example .env
# 设置 TVBOX_BRIDGE_TOKEN
COMPOSE_PROJECT_NAME=openstream-tvbox-bridge docker compose up -d --build
```

## 与网站对接

OpenStream 网站只配置服务端环境变量：

```bash
TVBOX_BRIDGE_URL=https://your-bridge.example
TVBOX_BRIDGE_TOKEN=your-server-side-token
TVBOX_BRIDGE_TIMEOUT_MS=8000
```

浏览器不会看到 bridge URL 或 token。

## 不做的事

- 不读取、不复制、不提交 quark、UC、Ali、115 等网盘 cookie/token/fid。
- 不把电视 `api.json` 当成 CMS API。
- 不把未执行、超时、不支持伪装成无结果。

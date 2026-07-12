# OpenStream Streaming Pipeline

## 背景

OpenStream 的旧搜索流程会等待一批数据源完成后再刷新结果。慢源、僵尸源或超时源会拖慢首屏体验，也会让用户看到大量重复结果。

本次改造将搜索链路升级为本地流式调度：

- 快源优先返回，慢源后台补充。
- 单源超时只影响该源，不阻塞整次搜索。
- 重复影片聚合为一个候选，卡片优先绑定健康分更高的线路。
- 源成功、失败、超时会写入浏览器本地健康快照，下一次搜索自动排序。

## 当前架构

```text
index.html
  -> js/source-health.js
  -> js/source-adapter.js
  -> js/result-aggregator.js
  -> js/streaming-search.js
  -> js/app.js search()

player.html
  -> js/source-health.js
  -> js/source-adapter.js
  -> js/playback-health.js
  -> js/player.js
```

## 模块职责

`source-health.js`

- 读取历史质量检测、延迟和本地健康快照。
- 生成 S/A/B/C 分层搜索计划。
- 记录 `ready / timeout / no_result / error / dead / login_required / unsupported`。
- 排除明显登录网盘类来源，不进入实时搜索计划。

`source-adapter.js`

- 提供统一 `search / detail / episodes / play / health` 契约。
- CMS 与自定义 CMS 源先接入这层，后续 Remote bridge 也接入这层。
- `tvbox:` / `bridge:` 前缀源会按 Remote bridge 契约请求，不配置 bridge 时返回 `unsupported`。
- 播放地址会排除 UC、夸克、阿里云盘、115 等登录网盘链接。

`result-aggregator.js`

- 标准化标题、年份和类型。
- 合并不同源返回的同一影片。
- 保留 `source_lines`，卡片默认使用当前最佳线路。

`streaming-search.js`

- 首轮按源分层并发，只抓第一页。
- 对 S/A 源做有限后台补充。
- 按总时限停止，不为慢源拖住用户。
- 通过回调把部分结果持续交给页面渲染。

`playback-health.js`

- 播放开始后给当前源记录一次成功。
- 播放器 fatal/error 时给当前源记录一次失败。
- 不记录播放地址、凭据或用户私有信息。

`player-resource-switch.js`

- 手动切换资源时按源健康排序候选。
- 候选详情和播放地址经 `source-adapter` 验证。
- 播放失败时会尝试自动换到同名影片的备用可播放线路，并保留当前集数与播放进度。

## 电视源接入原则

电视端源不直接塞进前端。接入 LA VPS bridge 时，浏览器只请求本站同源接口 `/api/tvbox/*`，由 OpenStream 服务端/Vercel Function 转发到 bridge。

不接入需要登录网盘或凭据的源，包括但不限于夸克、UC、阿里云盘、115、Ypan、Bpan、ZPan。

Remote bridge 必须返回明确状态：

```text
ready
timeout
unsupported
login_required
no_result
error
```

不能把未执行、超时、不支持伪装成无结果。

Bridge 配置只存在服务端环境变量：

```text
TVBOX_BRIDGE_URL
TVBOX_BRIDGE_TOKEN
TVBOX_BRIDGE_TIMEOUT_MS
```

`TVBOX_BRIDGE_TOKEN` 不会注入 HTML，也不能写入前端 localStorage。它只用于 OpenStream 服务端到 LA bridge 的 Authorization 头。

同源代理实现路径：

```text
本地 Express: server.mjs -> server/tvbox-bridge-proxy.mjs
Vercel: api/tvbox/[action].mjs -> server/tvbox-bridge-proxy.mjs
```

代理会拒绝内网 bridge 地址，避免通过公网实例转发到 `127.0.0.1`、`192.168.x.x`、`10.x`、`172.16-31.x` 等地址。

## 验证

```bash
npm run smoke:streaming
npm run smoke:player-fallback
npm run smoke:tvbox-proxy
cd bridge/tvbox-bridge && npm run smoke:jianpian && npm run smoke
npm run smoke:production:tvbox -- https://tv.cursorflow.top
node --check js/source-adapter.js
node --check js/player.js
npm run build:css

PORT=8092 PASSWORD=opentest TVBOX_BRIDGE_URL=https://bridge.example.test npm start
curl -fsS 'http://localhost:8092/api/tvbox/health'
```

`smoke:streaming` 会模拟快源、慢源和超时源，验证部分结果可先返回、重复影片可聚合、源健康状态可记录。

`smoke:player-fallback` 会模拟当前线路失败，验证备用线路选择、集数继承和播放进度继承。

`smoke:tvbox-proxy` 会验证 bridge 未配置、内网地址拦截、服务端 token 转发和超时状态。

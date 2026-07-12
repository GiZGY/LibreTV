# TVBox 源接入兼容性报告

更新时间：2026-07-13

## 结论

电视端现有 48 个源已确认不是标准苹果 CMS V10 API，不能直接放进 OpenStream 的 `API_SITES` 当作网站源使用。

当前网站侧已具备 bridge 接入链路：

```text
Browser -> OpenStream /api/tvbox/* -> LA bridge -> TVBox adapter
```

这样可以保持 Vercel 无服务器前端/接口体系，同时把需要长期运行时的电视源适配放到 LA VPS。浏览器不会看到 bridge URL 或 token。

## 分类

### 可直接接入的网站 CMS 源

当前 OpenStream 已内置约 22 个标准 CMS V10 源，继续通过 `/api/search`、`/api/detail` 使用，不受 bridge 改造影响。

### 只能通过 CatVod/spider 运行的电视源

电视端 48 个源当前全部是 `type=3`，主要依赖：

- `spider: ./spider.jar`
- `csp_*Guard`
- 少量 `./api/drpy2.min.js`

这些源不能在 Vercel 里直接运行。它们必须满足以下任一条件才能进入可播放优选：

- bridge 内具备合法、可运行、可验证的 CatVod/spider 调用运行时；
- 或者为具体源实现独立 adapter，能稳定返回搜索、详情、分集和播放地址；
- 且播放地址不依赖本机网盘登录凭据。

当前 LA bridge 中：

- `立播` 已有 HTTP adapter canary，搜索和详情可运行；
- `立播` 当前抽样播放结果多为 UC/夸克/百度/迅雷等网盘地址，因此播放阶段会返回 `login_required`，不进入网站默认可播放源；
- 其余未适配 CatVod/spider 源返回 `unsupported`，不会伪装成空结果。

### 需要网盘登录的源

当前识别为需要登录/本机凭据/首帧验证的源：

```text
MDrive
玩偶
seed
ZPan
抠搜
UC
YpanSo
BpanSo
```

这些源不会读取、复制、提交或转移电视端凭据，包括但不限于：

- `quark_ut`
- `quark_fid`
- cookie
- token
- 网盘登录态

当前 LA bridge 对它们返回 `login_required`。

### 当前无法接入的源

没有稳定公开 API、没有可合法运行 spider runtime、或输出依赖本机登录态的源，当前都不进入网站默认源列表。状态必须显示为：

```text
unsupported
login_required
timeout
no_result
error
```

不能把未执行、超时、不支持伪装成 `no_result`。

## 已部署 bridge 状态

LA VPS：`vps2.cursorflow.top`

公开入口：

```text
https://vps2.cursorflow.top/api/tvbox/*
```

部署方式：

```text
/srv/openstream-tvbox-bridge/repo/bridge/tvbox-bridge
COMPOSE_PROJECT_NAME=openstream-tvbox-bridge docker compose up -d --build
```

容器仅监听：

```text
127.0.0.1:9979
```

Caddy 只反代：

```text
vps2.cursorflow.top/api/tvbox/* -> 127.0.0.1:9979
```

## 网站接入状态

已实现：

- `server/tvbox-bridge-proxy.mjs`
- `api/tvbox/[action].mjs`
- 本地 Express `/api/tvbox/:action`
- 前端 `OpenStreamSourceAdapter` 统一调用同源 `/api/tvbox/*`
- `smoke:tvbox-proxy`
- 播放页支持 `tvbox://` 占位 URL，在进入播放页后调用 bridge `play` 解析真实地址
- LA bridge `立播` adapter：
  - `search`：当前 live probe 可返回《庆余年 第二季》
  - `detail`：当前 live probe 可返回标题和 1 个播放入口
  - `play`：当前 live probe 返回 UC 网盘，状态为 `login_required`

待完成：

- 在 Vercel 生产环境设置服务端环境变量：
  - `TVBOX_BRIDGE_URL=https://vps2.cursorflow.top`
  - `TVBOX_BRIDGE_TOKEN=<LA bridge .env 中的 token>`
  - `TVBOX_BRIDGE_TIMEOUT_MS=8000`
- 找到至少一个返回 m3u8/mp4、且不依赖网盘登录的电视源 adapter，再把对应 `tvbox:*` 源加入用户可选源列表。

## 下一步 adapter 准入标准

每个电视源进入网站前必须通过：

1. `search(sourceKey, keyword)` 返回候选列表；
2. `detail(sourceKey, videoId)` 返回详情与分集；
3. `play(sourceKey, videoId, flag, episode)` 返回真实可播放 URL；
4. 首帧/播放稳定后才进入健康源优选；
5. 失败时返回明确状态，不污染搜索体验。

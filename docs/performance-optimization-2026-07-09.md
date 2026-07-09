# OpenStream Vercel 性能优化记录

## 背景

OpenStream 部署在 Vercel Serverless 环境。用户反馈网络慢，主要风险集中在首屏静态资源、跨源搜索并发、代理函数缓存与大资源转发。

## 本次变更

- 搜索结果改为流式渲染，快源先展示，慢源后台补齐。
- 搜索请求增加并发阀门：跨源并发最多 4 个，单源分页并发最多 2 个。
- 关键词搜索每源最多抓 5 页，避免一次搜索打出过多代理请求。
- 首次质量检测延后到空闲期，并在静默模式下运行，避免首屏抢网络。
- 视频详情增加 15 分钟前端内存缓存，避免重复打开同一卡片时重复请求。
- 版本检测增加 24 小时本地缓存，并延后到浏览器空闲期执行。
- 代理鉴权时间戳改为 5 分钟时间桶，提高 Vercel CDN 缓存命中机会。
- Vercel 代理响应增加 `Vercel-CDN-Cache-Control`，错误和鉴权失败响应保持 `no-store`。
- 代理二进制响应改为流式转发，并透传 `Range` 请求，减少 Serverless 内存占用。
- 移除页面里的 Tailwind 浏览器运行时，改为构建期生成 `css/tailwind.generated.css`。
- 删除未再引用的 `libs/tailwindcss.min.js`，减少部署包体积。
- 移除空 Service Worker 注册，避免无缓存收益的 PWA 生命周期成本。
- `npm audit` 漏洞已清零。

## 验证

- `npm run build:css`
- `npm audit`
- `npm audit --omit=dev`
- `node --check js/app.js`
- `node --check js/search.js`
- `node --check js/config.js`
- `node --check js/proxy-auth.js`
- `node --check js/version-check.js`
- `node --check api/proxy/[...path].mjs`
- `node --check server.mjs`
- `git diff --check`
- 本地 `PORT=8099 npm start` 冒烟：首页、播放页、版本文件、生成 CSS 均可访问。
- 浏览器冒烟：首页加载 `css/tailwind.generated.css`，不再加载 `libs/tailwindcss.min.js`。
- 首页不再加载 `js/pwa-register.js`。

## 受控例外

本次任务触及了既有超线文件，但为了避免把网络优化和大规模结构重构混入同一 PR，暂不做拆分：

- `js/app.js`：约 2253 行。
- `js/douban.js`：约 1755 行。
- `js/player.js`：约 1996 行。
- `css/styles.css`：约 1245 行。

建议下一阶段按职责拆分：

- `js/app.js` 拆出搜索渲染、质量检测、数据源设置、详情缓存。
- `js/player.js` 拆出播放器初始化、广告过滤、快捷键、播放历史。
- `js/douban.js` 拆出推荐模式、筛选模式、分页缓存、封面代理。
- `css/styles.css` 拆成 base、layout、components、utilities。

## 回滚

若上线后发现样式缺失，可通过 `git revert` 回滚本次 Tailwind 替换相关改动：

- 恢复各 HTML 中的 `libs/tailwindcss.min.js` 脚本引用。
- 移除 `css/tailwind.generated.css` 引用。
- 保留搜索流式、代理缓存与并发阀门不受影响。

若代理缓存或流式转发出现兼容问题，可回滚 `api/proxy/[...path].mjs` 与 `js/proxy-auth.js` 的本次变更。

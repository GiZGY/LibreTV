# OpenStream - 免费在线视频搜索与观看平台

<div align="center">
  <img src="image/openstream-logo.svg" alt="OpenStream Logo" width="220">
  <br>
  <p><strong>自由观影，畅享精彩</strong></p>
</div>

## 📺 项目简介

OpenStream 是一个轻量级、免费的在线视频搜索与观看平台，提供来自多个视频源的内容搜索与播放服务。无需注册，即开即用，支持多种设备访问。项目包含服务端鉴权和安全流式代理，支持 Vercel 与 Node.js/Docker 部署。

本项目基于 LibreTV 进行二次开发与增强。

<details>
  <summary>点击查看项目截图</summary>
  <img src="https://github.com/user-attachments/assets/df485345-e83b-4564-adf7-0680be92d3c7" alt="项目截图" style="max-width:600px">
</details>

## 🚀 快速部署

选择以下任一受支持的平台，即可创建自己的 OpenStream 实例：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGiZGY%2FLibreTV)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/GiZGY/LibreTV)

## 🚨 重要声明

- 本项目仅供学习和个人使用，为避免版权纠纷，必须设置PASSWORD环境变量
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任

## ⚠️ 同步与升级

OpenStream 已有独立的搜索、质量检测、代理和 TVBox bridge 架构，不再自动把 LibreTV 上游提交写入 `main`。需要吸收上游修复时，应在独立分支中人工审查冲突，运行 `npm run quality`，再通过 PR 合并；这样不会绕过质量门或触发未经验证的自动部署。

升级前建议在设置中导出配置。升级后若遇到旧资源缓存，可先清除站点数据并强制刷新。


## 📋 详细部署指南

### Vercel

1. Fork 或克隆本仓库到您的 GitHub/GitLab 账户
2. 登录 [Vercel](https://vercel.com/)，点击"New Project"
3. 导入您的仓库，使用默认设置
4. **⚠️ 重要：在"Settings" > "Environment Variables"中添加 `PASSWORD` 变量（必须设置）**
5. 点击"Deploy"

生产公开访问前，请按 `docs/vercel-firewall.md` 配置登录接口的跨实例全局限流。


### Docker

从当前仓库构建，确保镜像包含 OpenStream 的最新前端资源、安全代理和质量检测逻辑：

```bash
docker build -f deploy/docker/Dockerfile -t openstream:local .
docker run -d \
  --name openstream \
  --restart unless-stopped \
  -p 8899:8080 \
  -e PASSWORD='replace-with-at-least-16-characters' \
  openstream:local
```

### Docker Compose

```bash
export PASSWORD='replace-with-at-least-16-characters'
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

访问 `http://localhost:8899` 即可使用。

### 本地开发环境

项目包含后端代理功能，需要支持服务器端功能的环境：

```bash
# 通过复制示例来设置本地环境变量
cp .env.example .env

# 安装、构建并启动
npm ci
npm run build
npm start

# 开发时可使用自动重启
npm run dev
```

访问 `http://localhost:8080` 即可使用（端口可在.env文件中通过PORT变量修改）。

> ⚠️ 注意：使用简单静态服务器（如 `python -m http.server` 或 `npx http-server`）时，视频代理功能将不可用，视频无法正常播放。完整功能测试请使用 Node.js 开发服务器。

## 🔧 自定义配置

### 密码保护

**重要提示**: 为确保安全，所有部署都必须设置 PASSWORD 环境变量，否则用户将看到设置密码的提示。


### API 兼容性

OpenStream 支持标准的苹果 CMS V10 API 格式。添加自定义 API 时需遵循以下格式：
- 搜索接口: `https://example.com/api.php/provide/vod/?ac=videolist&wd=关键词`
- 详情接口: `https://example.com/api.php/provide/vod/?ac=detail&ids=视频ID`

**添加 CMS 源**:
1. 在设置面板中选择"自定义接口"
2. 接口地址: `https://example.com/api.php/provide/vod`

## ⌨️ 键盘快捷键

播放器支持以下键盘快捷键：

- **空格键**: 播放/暂停
- **左右箭头**: 快退/快进
- **上下箭头**: 音量增加/减小
- **M 键**: 静音/取消静音
- **F 键**: 全屏/退出全屏
- **Esc 键**: 退出全屏

## 🛠️ 技术栈

- HTML5 + CSS3 + JavaScript (ES6+)
- Tailwind CSS
- HLS.js 用于 HLS 流处理
- ArtPlayer 视频播放器核心
- Vercel Serverless Functions / Node.js
- 服务端 HLS 代理和处理技术
- localStorage 本地存储

## ⚡ 性能与质量

- 首页搜索采用快源优先的流式返回，慢源后台补充，不等待所有源结束。
- 搜索、详情、豆瓣筛选和 TVBox bridge 请求均具备超时、取消、去重与分层缓存。
- 质量检测会验证搜索、详情、真实 HLS 清单和首个媒体分片，不再只把接口延迟当作质量。
- 播放页按需加载线路切换模块，静态资源构建后压缩合并并设置长期缓存。
- Vercel 仅承载网站与安全代理；TVBox bridge 可独立部署在 VPS，登录型网盘源不会接入。

提交前运行完整质量门：

```bash
npm run quality
npm --prefix bridge/tvbox-bridge run smoke:ci
npm --prefix bridge/tvbox-bridge audit --audit-level=high
```

详细记录见 `docs/performance-optimization-2026-07-25.md`。

## ⚠️ 免责声明

OpenStream 仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方 API 接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

本项目开发者不对使用本项目产生的任何后果负责。使用本项目时，您必须遵守当地的法律法规。

## 🤝 衍生项目

它们提供了更多丰富的自定义功能，欢迎体验~

- **[MoonTV](https://github.com/senshinya/MoonTV)**
- **[OrionTV](https://github.com/zimplexing/OrionTV)**

## 🥇 感谢支持

- **[Sharon](https://sharon.io)**
- **[ZMTO](https://zmto.com)**
- **[YXVM](https://yxvm.com)**

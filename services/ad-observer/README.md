# Advertisement Observer

独立运行的内容指纹采样 worker。网站仍部署在 Vercel；持续采样适合在已有 LA VPS
上单独运行，不占用用户搜索、播放请求，不需要电视开机或网盘登录。
默认不会运行、部署或发布任何规则；下面命令需要在获准的环境执行。

## 工作流

1. 复用网站源目录和 TV bridge 的公开适配器，轮换影片样本，精确匹配片名。
2. 从有限点播清单中选择短的完整连续块，下载完整分片，计算逐片 SHA-256。
3. 相同内容跨影片聚类；同一电影跨源不算跨影片证据。
4. 已审核的相同完整指纹直接标记为已知广告；未知重复素材进入人工内容审核队列。
5. 审核人员检查本地完整片段，记录广告、正片或不确定。正片判定可以撤销旧规则。
6. 导出经过实际播放器匹配函数回归的版本化规则，按正常 PR、播放验收、发布流程上线。

重复不是广告证明：发行商片头、预告、片尾等也会跨影片重复。
这里不依靠 DISCONTINUITY 标签删除内容，也不伪装成能识别所有画面内广告的视觉模型。
清单原文、签名地址不会持久化。审核素材只含媒体字节和本地相对路径。

## 本地命令

Node 22；在仓库根目录运行。数据路径必须绝对路径、位于仓库外、专用且权限 0700。
首次创建时必须为空；不要指向已有用户文件目录。

```sh
npm run ads:observe -- once --data /tmp/openstream-ad-observer --sources bfzy,zy360,mdzy
npm run ads:observe -- status --data /tmp/openstream-ad-observer
npm run ads:observe -- watch --data /tmp/openstream-ad-observer --interval-hours 6
```

不传 `--sources` 时按当前普通源目录采样。默认每轮两部影片，六部样本轮换；
对同一影片再次采样时移动候选窗口，避免永远只看开头。
可使用 `--queries /private/title-samples.json` 设置 1–12 个精确片名样本：

```json
[{"keyword":"X战警","title":"X战警：天启"}]
```

样本池不是全片库。标题未命中、超时、清单失败、内容下载失败、预算耗尽、
没有可检查块和确认广告分别记录，不能把前几种解释成“没有广告”。
本机测试不等于 LA 或 Vercel 出口验收。

## 内容审核与规则发布

`report.json` 给出候选 ID、状态和证据是否可用。
`evidence/<候选ID>/preview.m3u8` 是可供本地 HLS 工具检查的完整候选，
配套 `0.bin` 等为原始分片。部分播放器需要本地 HTTP 服务或媒体工具才能打开。
它不是全片，且没有远程媒体 URL。判断应覆盖整段视听内容，不只看首帧或时长。
worker 不包含图像识别模型，也不自行声称已完成这项语义核验。

暂停 watch 后执行审核；命令会重新核对所有证据文件的摘要：

```sh
npm run ads:observe -- review --data /tmp/openstream-ad-observer \
  --id <候选ID> --verdict ad --confirm-content-review
npm run ads:observe -- export --data /tmp/openstream-ad-observer
```

`--verdict` 可选 `ad`、`content`、`uncertain`。确认参数只表示操作者已完成内容审核，
不是自动识别结果。审核有效期 30 天，采样不会自动续期；不确定和过期记录不能新增规则。

导出到 `releases/<内容摘要>/ad-rules.js` 和 `release.json`，包含仍有效的原有规则。
导出前调用当前 `js/ad-guard.js` 测试完整匹配、逐片缺失、逐片变化、时长边界和清单不变。
超过播放器 32 条规则上限会明确失败，不会偷偷截断。这个门禁是确定性回归，
**不是浏览器实播验收**，发布文件明确记录 `browserPlayback: not_executed`。

导出不改网站文件，也不推送。发布者应在开发分支将审核文件对接至 `js/ad-rules.js`，
运行 `npm run quality`，对新增素材做实际首尾跳转/续播验收后，再经授权发布。
规则是静态构建的一部分，不引入公网任意规则脚本加载接口。回滚到前一个已验收规则版本，
或用 `content` 审核撤销误判规则后重新导出；不要恢复删除整段清单的旧算法。

## 资源与运维

- 最多三个源并发，单源顺序采样；周期从上一轮结束后计时，不重叠、不补跑堆积。
- 每轮 10 分钟总期限，单请求 12 秒，清单 4 MiB，最多一个清晰度、两条线路。
- 每条线路最多四个候选块，2–100 片、合计不超过 120 秒；这些是候选上限，不是判广告标准。
- 加密、字节范围、初始化片段、缺失片段、直播暂不下载识别；保留明确的未覆盖边界。
- 单片最多 8 MiB，每轮最多 192 次媒体请求、128 MiB 预算，失败也扣预算。
- 候选最多 500 个，每条最多 40 个去重出现位置；30 天未见记录淘汰。
- 原始审核证据最多约 512 MiB，满后继续记录摘要并标记没有可审证据，不签发规则。
- 数据目录只清理本工具拥有的过期候选证据；报告只保留最近一轮，不无限追加日志。
- 复用现有 HTTP 公网地址校验、DNS 校验、安全重定向和超时；不允许访问局域网与元数据服务。
- 进程收到 SIGINT/SIGTERM 后取消网络任务、保存已完成的观察并释放独占锁。
- 崩溃遗留 `worker.lock` 时拒绝启动。核实锁中主机/PID 已停止后才手工恢复，不自动抢锁。

`status` 读取原子快照，可以在 watch 运行时调用；`review`、`export` 与 watch 共用独占锁，需要先正常停止 watch。
观察结果不自动删除源：一次超时或少量样本不足以判定死源，也不等于广告全覆盖。
已知原生 iPhone Safari 不走 HLS.js 观察链路，不能宣称原生全屏已支持相同过滤。

## 容器

```sh
docker compose -f services/ad-observer/compose.yml build
docker compose -f services/ad-observer/compose.yml up -d
docker compose -f services/ad-observer/compose.yml logs --tail 20
docker compose -f services/ad-observer/compose.yml stop
```

独立容器、无监听端口、非 root、只读系统盘、专用数据卷、0.5 CPU/384 MiB。
默认六小时一次；不自动重启以免崩溃锁造成循环启动，需要运维关注退出与报告新鲜度。
容器健康检查确认最近七小时内有完整轮次；它不证明采样源可播放或广告全覆盖。

### LA 定时部署

低内存主机可改用随附的 `openstream-ad-observer.service` 与 `.timer`，替代常驻 watch，
两种方式不能同时使用同一数据目录。timer 每六小时触发一次容器 `once`，完成后释放内存，
重启后补一次错过的计划，不补跑所有历史轮次。systemd 不会重叠启动同一 oneshot 服务。

固定镜像引用写入 `/srv/openstream-ad-observer/runtime.env` 的
`OPENSTREAM_AD_OBSERVER_IMAGE`。专用 volume 为 `openstream-ad-observer-data`，
无监听端口；host 网络用于复用 LA 已验证的源出口，公网地址限制仍由 HTTP 客户端强制执行。

检查 `systemctl list-timers openstream-ad-observer.timer`、
`systemctl show openstream-ad-observer.service -p Result -p ExecMainStatus` 和专用卷内 `report.json`。
服务退出成功不代表每个源成功，必须另查报告的各源和素材状态。
检查报告可用同镜像执行 `status --data /data`，不要读取无关容器的配置或数据。

暂停采样用 `systemctl disable --now openstream-ad-observer.timer`，
正在运行时再 `systemctl stop openstream-ad-observer.service`；保留专用数据卷。
镜像回退时修改 runtime.env 中的固定引用，下一轮才生效，不需要重启现有 TV bridge。
部署需单独授权，不能把本地命令成功当成 VPS 已经部署。

## 回归

```sh
npm run smoke:ad-observer
npm run smoke:ad-guard
npm run quality
```

覆盖真实运行时匹配器、候选非授权、完整下载、跨片去重、过期和撤销、SSRF/重定向、
流量预算、独占存储、证据篡改、持久化恢复、数据淘汰和命令参数边界。

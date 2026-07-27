# Vercel 登录限流上线门槛

OpenStream 在应用层限制登录失败次数，并且只在 Vercel 环境信任由平台覆盖的
`x-vercel-forwarded-for` / `x-forwarded-for`。本地或普通 Node 部署默认使用
socket 地址，不能通过伪造请求头绕过单实例限流。

Serverless 实例之间不共享进程内存，因此生产部署还必须在 Vercel Firewall
配置一条全局规则：

- Path：`/api/auth/login`
- Method：`POST`
- Rate limit key：IP
- 建议阈值：10 分钟 8 次（Hobby/Pro 可配置的最大窗口）
- 超限动作：返回 `429`

配置后先在 Firewall 日志中确认仅命中登录请求，再启用阻断。Enterprise
套餐如需更长窗口，可按实际能力调整；若套餐支持 persistent action，可对
持续攻击增加临时封禁，但不要把 `/api/auth/status` 纳入登录失败限流。

参考：

- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel rate limiting guide](https://vercel.com/kb/guide/add-rate-limiting-vercel)
- [Vercel WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)

此规则属于生产平台配置，不能由仓库代码自动创建。未完成该规则时，应用仍有
单实例保护，但不能声称具备跨实例全局登录限流。

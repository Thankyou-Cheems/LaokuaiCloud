# voice 浏览器首页

用户已预览并批准现有奇丽叶插画和页面，并明确要求将标语/title 改为“来唠嗑吧”后上线。
`index.html` 是实际部署的自包含版本，产品名为唠蒯云；只提供客户端添加 `voice.ruikang.wang` 的说明和复制按钮。
没有下载链接、登录表单、第三方跟踪、远程字体或自动播放。
图片沿用用户已有 Library 插画，不修改像素。见 `provenance.json`。

## 文件与路由

- `index.html`：2,141,608 bytes，SHA-256 `519faa9074d5331efae9642f010973ef86b51e7e81abeb40420b3c3a6b65e139`。
- `Caddyfile.voice-landing.reviewed`：voice 站点的独立片段，不是完整共享配置。静态 HTML 存放在已有 `/opt/Website` 挂载中的精确 hash 目录。
- 仅路径 `/`、空 query、GET/HEAD、有明确 Fetch Metadata 浏览器导航、Accept text/html 且无 Upgrade/Connection upgrade 才展示 HTML。
- 其余请求保持原 `laokuailiao-server:5000` 代理；不设置 SPA fallback。没有修改 SFU、ET、DNS、端口或鉴权。
- 不带 Fetch Metadata 的浏览器保守返回原 upstream；带 query 的根请求也保留原处理。

## 验证

`node verify-preview.cjs` 覆盖复制成功、Clipboard 拒绝、API 缺失、非安全预览环境和地址手动选中；并检查既定内容、无链接/远程资源/表单/媒体、移动端与 focus 样式。
`node verify-route.cjs` 检查候选正则的 18 个路由模型场景。

2026-10-11 发布时完整共享 Caddy 配置验证成功；仅替换 voice 块，其余配置字节保持不变。
真实 HTTPS 导航 GET/HEAD 返回 200，GET 响应 SHA-256 与本文件一致。
上线前后 `/info`、非 HTML/带 query/禁用 HTML Accept 根请求、未知 API/路径以及 Bomana/pay 首页响应保持一致；health 200、Socket.IO polling 和真实 WebSocket 101/Engine.IO open 正常。
根路径 Upgrade 保留原 502；polling 的 sid 和 health 动态字段不用于逐字 hash 比较。
没有执行鉴权房间/媒体会话或页面浏览器渲染。图片已在消费者本机提取并亲自查看。

部署诊断、完整共享配置备份和本地下载路径均不纳入此组件。
Task-6 为唯一 Git owner；本组件以独立 create-only 最终补丁交付，不推送整合分支。
早期含占位图的 `voice-landing-create-only.patch` 已被此次最终补丁取代，不可当最终页面整合。

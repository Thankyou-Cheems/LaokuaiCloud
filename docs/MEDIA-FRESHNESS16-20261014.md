# .16 媒体新鲜度与等待边界

本记录仅说明源码及纯 JavaScript 回放证据，不代表真实双设备或网络验收。
未运行真实 PeerConnection、麦克风、ET/TUN 或 Go 测试。

## 已复现的缓存问题

旧 `BrowserHybridPeer.waitForMedia()` 可直接返回最多 3000 ms 前的候选，
而 `HybridRouteController.validMedia()` 要求证据年龄不超过 500 ms。
默认路径稳定等待为 1000 ms。生产类的纯 JS 回放证明：501 ms 时 Peer
仍返回缓存且健康，控制器已经拒绝；稳定等待结束可能仍拿到 1000 ms 前的
同一份证据。此前 .15 日志出现 `verified_media` 后约 1001 ms 转回 SFU、
原因 `media_stale_before_switch`，与该行为相符；日志未提供逐次 RTP 计数，
因此不能将 DTX 或噪声门认定为实际根因。

当前默认 `waitForMedia()` 只复用 500 ms 内的实际解码证据；过期时等待下一次
包计数与样本计数同时增长。单独增长的样本/掩蔽计数不制造新的媒体证据。
稳态监测显式使用 3000 ms 健康窗口，保持原容忍。两种语义由
`hybridMediaTiming.ts` 的独立命名常量定义。

## 慢统计采样的红绿证据

修正缓存入口后，还发现等待新媒体使用 `pathMonitorMs`（默认 500 ms），
与 Peer 的 500 ms 采样间隔相同。这个周期不包含统计响应时间。

专用回归使用当前 TypeScript 生产类在内存中转译，内部 Peer/控制器协作均为
真实实现；仅浏览器 API、时钟、服务器响应及 RTP 计数为确定性边界替身。
`getStats()` 每次延迟 20 ms，实际包计数在 1520 ms 恢复。旧行为先触发
500 ms 证明等待超时，1600 ms 时仍为 SFU，回归失败：`sfu !== p2p`。

修复复用现有阶段预算：路径稳定阶段等新证据受剩余探测 deadline 限制，
切换前/ACK 后刷新使用 `switchTimeoutMs`。剩余 deadline 须有限且为正；
监控周期继续控制采样和稳态检查，不承担新媒体证明的超时预算。
同一回归在 1600 ms 完成 P2P 切换。持续没有新媒体且探测预算为 1500 ms 时，
仍按超时保留 SFU，未发送暂停转发请求。未新增重试或状态。

## 检查与范围

- `components/voice` 下 `node scripts/check-hybrid-media-freshness.mjs`：通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`：通过。
- `git diff --check`：通过。
- 本轮第一次缓存修复时 36 组核心契约通过；最终整合检查由 .16 主流程另行记录。

`validMedia()` 的 `finite(age)` 已同时要求有限与非负；未新增重复检查。
SFU→P2P 仍先取得媒体及路径证据、完成本地交接，再暂停 SFU；ACK 后保留
实际证据刷新。未删除这些与异步交接/服务端往返相关的验证。

ET 启停仍由社区身份、用户联机偏好及应用退出管理。`CommunityLanSession`
提交的 enrollment snapshot 不含语音房间；`HybridVoiceBridge` 仅读取 ET
观测用于路径分类，没有 ET 启停调用。

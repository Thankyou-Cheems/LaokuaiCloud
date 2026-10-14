# .16 候选对统计缺项的离线复现与有界容错

本记录针对 .16 现场 `fresh_decode` 与 `pair-unavailable` 同时出现、随后
`peer_path_changed` 恢复 SFU 的模式。现场记录见
[双人调查](LIVE16-AUDIO-LAN-DIAGNOSIS-20261014.md)。本次改动属于本地源码，
没有运行真实 ICE、Go 网络测试、客户端、生产部署或 GitHub CI；没有替换 .16
冻结产物，也不是双人语音或音质验收。

## 能确认的范围

生产统计解析器原来把三类结果合并成 `pair-unavailable`：

| 新增固定枚举 `pairUnavailableReason` | 源码判据 |
| --- | --- |
| `transport-unavailable` | 当前 exact-track inbound 引用的 transport 记录缺失/类型不符，或其 selected pair ID 缺失/空值 |
| `pair-record-unavailable` | transport 有 selected pair ID，但该 ID 的 candidate-pair 记录缺失/类型不符 |
| `pair-not-succeeded` | candidate-pair 记录存在，状态不等于 succeeded |

粗粒度 `pathReason` 继续保持 `pair-unavailable`。细分原因只包含上述枚举，
经 SDK reporter、客户端 observer 和本地诊断 schema 白名单传递；不输出
transport/pair/track ID、候选地址、SDP、账号或原始异常。

现场缺少原始 RTCStats，不能确认实际命中了哪一类，更不能确认浏览器漏项、
ICE 状态迁移、关联关系变化中的哪一种机制。已确认的是控制器会把这一聚合
unknown 立即当作路径不可准入，即使同一 report 仍有新增 packet/sample 进度，
也进入 SFU 恢复并在成功后销毁旧 Peer。这个策略足以放大短暂观测缺项，
尚不能称为真实现场缺项根因已经修复。

## 最小容错边界

首次准入、路径稳定等待、切换前以及暂停 SFU ACK 后的媒体刷新继续要求完整、
可准入的路径。容错只用于已经选中的 P2P 的定期监控：

- 从最近一次完整路径确认起最多 1500 ms；缺项不会刷新该截止时间。
- 必须仍是同一 live track、Peer 正在接收、媒体健康；当前 exact-track 统计
  还要有新 packet 与新 sample、fresh decode window，且报告最多 500 ms 旧。
- 只允许 transport/selected ID 不可观测，或旧 selected pair 的记录缺失。
  若 report 已显式指向另一个 pair ID，立刻恢复 SFU，不沿用旧证据。
- pair 非 succeeded、TURN、已知 ET relay、候选记录缺失、初始 unknown、
  媒体进度停止、过期或不一致证据，都不使用这一容错。
- 当前 observation 的路径仍是 unknown，原样提供给诊断和 UI。内部的上次
  确认只决定短期保留当前音频输入，不合成 direct、selected-pair 或新测量。

默认监控周期为 500 ms；持续缺项在最近一次完整确认 +1500 ms 的检查恢复
SFU。其他配置的回退判定发生于达到截止时间后的首个监控检查，不增加容错
时限。恢复继续采用现有 exact ACK、fresh SFU media 和本地选择交接；SFU
恢复失败时保留尚健康的 Peer 并重试，真正媒体过期后关闭输入。

## 红绿证据

使用 `components/voice/scripts/check-hybrid-path-gap.mjs`。它在内存编译当前
生产 BrowserHybridPeer、ReceiveTrackStats/parser、HybridRouteController；
只替换 RTCPeerConnection 和时钟为离线对象。RTP counters 由独立时间线
增长，读取 stats 不会制造媒体进度。没有启动真实 PeerConnection、采集或网络。

修复前实际运行：

```text
.local/toolchains/node24/node.exe components/voice/scripts/check-hybrid-path-gap.mjs
AssertionError: one missing selected-pair stats sample must retain fresh decoded audio
'sfu' !== 'p2p'
exit 1
```

修复后同一脚本通过；另在内存仅把 `allowPathStatsGap(...)` 调用替换为 false，
确认替换恰好命中一个生产 seam，同一个单样本断言再次拒绝旧行为。
以下行为均经过实际生产组合验证：

- 缺 transport、缺 selected ID、缺同一 pair 记录：仍有 fresh decode 时保留
  同一个 Peer；恢复完整统计后没有 SFU restore 请求或重新创建 Peer。
- 持续 transport/pair 缺项：1000 ms 仍保留音频，1500 ms 时恢复 SFU并关闭
  旧 Peer，既不无限延续也不把 unknown 变成可准入路径。
- 新显式 pair ID 却缺记录、pair checking/failed、TURN、ET relay、候选缺失：
  下次 500 ms 检查即恢复 SFU。
- 首次 unknown 不暂停 SFU；缺项伴随无 packet/sample 增量不能使用容错。
- SFU 新媒体获取失败：状态为 recovering，仍健康的 P2P 输入保留；随后真正
  停止媒体且超过既有健康窗口，输入切为 none，并保留 SFU 重试。
- 三类 detail 枚举、安全字段以及 unknown/fresh_decode 共存均经过检查；
  SDK→客户端 observer→磁盘 schema 的枚举透传通过，非枚举文本被拒绝。

定向检查结果：

```text
check-hybrid-path-gap.mjs: pass; legacy red sensitivity rejected as expected
check-hybrid-media-freshness.mjs: pass; all 3 earlier timing regressions rejected
components/voice/node_modules/typescript/bin/tsc -p components/voice/tsconfig.json --noEmit: pass
components/client/scripts/check-local-diagnostics.mjs: pass
client ESLint src/lib/hybridDiagnostics.ts src/lib/localDiagnostics.ts: pass
git diff --check: pass (其他工作者文件仅有既有换行转换提示)
```

整合前曾执行一次 `tools/check-core-contracts.ps1`，源码检查走到 Types 时失败：
客户端已安装的旧 routing.6 声明没有新 `pairUnavailableReason` 字段，产生两处
TS2339。不能记为全套通过；需要整合后的 SDK build/同步和正式类型检查。
本记录只记这一已发生的来源不一致失败，不用局部绿色覆盖它。

记录时 HEAD 为 `a479acdea71e23a25a2d85a72a185db699743a89`，修复与
检查均针对本地工作树，不表示该 HEAD 已含改动。最终交付身份由整合提交和
独立产物回执确定。

# 语音分发链路审视与纠偏

## 后续决定：12 人、低于 6 Mbps 出口、联机独立

用户补充：本产品同时替代 EasyTier Game，社区虚拟局域网是核心功能；腾讯云
标称出口只有 6 Mbps 且实际更低，目标至少 12 人同一频道。以下决定取代原审视
中的“暂以 6 人验收”和“带宽优化留后”安排；下文保留为修改前的证据快照。

- 保留现有公共 EasyTier 接入、独立社区租约和 Gryt/SFU 分离部署。语音离房、
  失败、恢复、Hybrid dispose 不得释放 ET 社区租约；退出整个应用才做所属资源清理。
  现行受信 bootstrap 是自有腾讯 `cheems-p2p` 公共节点，源码没有第三方公共
  中继池发现/自动接纳；经自有节点转发仍占相同服务器出口。已有入网及管理
  RPC 证明不替代双设备真实中继转发验收，也不因此删除现有公共节点集成。
- 不把全部音频强制走 ET 中继。ET 中继按每个接收者转发单播，不具备自动合并
  同一语音的作用。12 人全讲话、全经中继、64 kbps 时，仅载荷已有
  `12 × 11 × 64000 = 8.448 Mbps`。SFU 全量下行同样有 132 条有向边，
  它的优势是客户端单次上行、现有音频控制和可独立恢复，并非出口变成线性。
- 标准 SFU 兜底改为单声道 16 kbps / 60 ms、VBR、DTX、FEC；获准的 peer
  保持 64 kbps / 20 ms。旧标准设置自动迁移，显式 custom 保留，更低频道上限保留。
  SFU 部署需同时启用 16 kbps 接收上限/60 ms 偏好及两服务 12 人上限。
- 132 条边的音频载荷预算为 2.112 Mbps；按每包额外 60 字节、60 ms 估算，
  再加约 1.056 Mbps，总计约 3.17 Mbps。IPv6、更长 RTP 扩展、RTCP、重传、
  抖动和游戏中继还会占带宽。这是设计预算，不是实测公网带宽或 QoS 保证。
  任意自定义短封包和无上限游戏流量不能继承该预算。
- peer 准入必须同时有新鲜解码、稳定 selected ICE pair、非 TURN 分类和
  host underlay 准入。ET 仅凭本机所选端点、有效 CLI 路由及活动下一跳作
  underlay 观察，不冒充远端成员绑定或完整物理路径认证。
- SFU 回退保留 applied ACK + 新鲜媒体边界；重探测 15/30/60 秒退避并封顶，
  SFU 恢复失败分批重试。认证、房间、track/PC epoch 失效仍立即退役。
  现有 peer 的保留只适用于认证/发布绑定仍有效而恢复 ACK/新媒体暂未到达。
  当前完整 SDK/Bridge 的 SFU PC 断开会退役绑定及 peer；本轮不宣称 SFU
  全服务故障时语音仍不中断。该语音生命周期不会释放社区 ET 联机租约。

历史 [20 席负载回执](../release/acceptance/sfu48-sdk3-isolated-media.json) 继续有效：
4×5 和 2×10，2 个真实 SDK 加 18 个认证 RTP 回放端，48 kbps/20 ms，
0/1/2 个 talker 阶段，通过同房 RTP/SDK PCM。它没有测整条网络字节量，
也不是 20 个完整客户端同频道同时讲话或 Tencent WAN / ET 公共中继验收。
不重复其已通过分支；本轮只补新 codec、选路和 12 人单房转发的变化。

本轮已有 12 个真实 Chromium 编码器、24 个 loopback PC 的标准 16k/60 配置
实测：每路约 17.30–17.47 包/秒、12.43–12.57 kbps 合成噪声载荷，12 路
均有持续接收采样且丢包计数零。它不包含真实麦克风、SFU fanout、WAN 或游戏。
追加的真实 Chromium 路径测试也通过，12 个 selected pair 均由同一 stats 实现
读出非 TURN 的 host/host 分类。SFU 的 12 发布者/132 边合成 RTP 测试另有
独立回执；两者不拼接冒充 12 个完整应用经公网通过。

服务端已应用该配置，两服务健康且公网健康检查为200；现有 ET、端口、网络、
挂载保持不变。见 [部署回执](../release/acceptance/voice-budget-deployment-20261013.json)。

## 修改前审视快照

日期：2026-10-13。源码基点 `09cc9d8884de328e693e40a97b635a8418c9fad1`。
审视覆盖客户端入房、最终麦克风发布、SDK peer/SFU 选择、后端认证与信令、
SFU 转发租约、EasyTier 路径观察、连接详情及退出。
结论来自源码、已安装 SDK、固定验收回执，以及一次线上非秘密配置白名单读取。
本轮没有改变生产配置或执行新的双设备媒体、ET、驱动测试。

## 判断

**基本架构合理，当前选路策略没有完整实现“直连优先、SFU 备份”。**
现在实现的是“SFU 先通话，peer 收到媒体后优先切 peer”；peer 是否经过
TURN 或 EasyTier 中继、质量是否优于 SFU，都没有进入选择条件。
这不是改一个状态文案就能解决的问题，也不需要推倒已有认证和恢复链路。

保留社区与房间两个生命周期、独立 Gryt/SFU/ET 部署、最终受控麦克风轨、
每接收者转发租约、真实 ACK 和新鲜接收媒体验证。纠偏集中在现有 SDK 的
路径观测和选择接口；不新建一套通用诊断平台或 ET 控制面。

## 当前真实链路

```text
社区成员身份恢复 ──→ 自动 EasyTier（与语音房独立）

入房认证 → SFU token → SFU WebRTC → 首段语音
                         ↑
麦克风 → 现有 DSP/静音/PTT/Squad 控制 → 最终发布轨
                         └→ 每个远端成员一个双向 peer PC
                             ↓ 收到媒体 + 精确 SFU pause ACK
                       暂停「该发送者 → 本机」的 SFU 下行
                             ↓ peer 失败
                       SFU resume ACK + 新媒体 → 恢复 SFU
```

peer 复用最终发布轨，不能另开绕过静音/PTT/Squad 的原始麦克风。
每对成员是一条双向 peer 连接，两端独立选择接收输入；不是每个方向再建一套 PC。
peer 生效时，发送者到 SFU 的上行、SFU PC 和轨道仍在，只暂停指定接收者的
RTP 转发。因此它省的是相关 SFU 下行，代价是额外 peer 上行和连接/编码资源；
同一 PCM track 不保证多个 PC 共用一次 Opus 编码。

对应实现：
[客户端认证桥接](../components/client/src/packages/webRTC/src/adapters/HybridVoiceBridge.tsx)、
[最终发布轨和双向 peer](../components/voice/src/webrtc/hybrid/BrowserHybridPeer.ts)、
[选择与恢复](../components/voice/src/webrtc/hybrid/HybridRouteController.ts)、
[后端 pair/forwarding](../components/server/src/socket/handlers/voiceHybrid.ts)、
[实际 RTP 转发](../components/sfu/internal/svc/forwarder.go)。

## 已确认的缺口

| 优先级 | 发现 | 对用户的影响 | 决定 |
|---|---|---|---|
| 高 | peer 准入只校验媒体和 ACK，不检查 selected ICE 候选类型及 ET 路径 | 中继 peer 也可能替代 SFU | 给现有选择器补路径门控，持续监控重选后的路径 |
| 高 | ET 本机入网与 WebRTC selected pair 没有关联 | 已入网不代表语音经过 ET；不能标物理直连 | 分开显示；通过明确的 ET adapter 补充可信关联 |
| 中 | RTT/丢包没有驱动选择，失败后相同 binding 不重新探测 | 慢但仍收包的 peer 不回退；恢复后长期留在 SFU | 加健康窗口、迟滞、冷却和有界重探测 |
| 中 | 发送方向 `sentToRemote` 固定为 null | 对方是否选中/解码我的音频无从展示 | 先精简缺失显示；需要时在现有认证协议补最小接收回执 |
| 中 | ET 2.7 proto 默认 false 被 CLI JSON 省略，解析却变成 null | 连接存活字段被错误当成缺失 | 仅对固定来源按 proto 默认值解释，不放松通用未知来源 |
| 待实测 | 3 秒内 packet/sample 均无增量就判 peer 失效，无静音/DTX 特例 | 某些正常静音行为可能触发永久 SFU 降级 | 专门测长静音/DTX；不是已确认的当前用户故障 |

SDK 默认最多 19 个 peer、并发探测 2 个，只有并发保护，没有动态资源预算。
线上本次读取到 Gryt `VOICE_MAX_USERS=6`、SFU `MAX_PEERS=6`，两端 Hybrid
开关均为 true，SFU client token 与 audio-only 均为 true。因此当前部署应以
6 人目标验收，不能把 SDK 默认 19 当成已验证的 20 人产品能力。
N 人全连接有 N(N−1)/2 对：6 人 15 对；20 人 190 对，每台还保留 SFU 上行。
扩容前再决定 mesh 上限，不在这次审视中修改线上人数限制。

### 路径未知有三种不同原因

1. 自己没有“自己到自己”的远端语音边，路径/RTT 不适用。当前本地 UI 修复
   将其改为“已入网 · 本机”，隐藏自我条目中的发送/接收未知表格。
2. 远端语音可以知道 SDK 选择 peer 还是 SFU，但现有 stats 只取
   selectedPairId、RTT/丢包，没有解析 pair 引用的 local/remote candidate。
3. 即使补齐 ICE 类型，非 TURN 也可能是 ET/VPN 虚拟网卡地址。ET 中继位于
   WebRTC 之下，不会自动表现为 ICE `relay`。远端成员设备与 ET peer 的身份
   绑定、当前选定转发和下一跳证据仍缺失。

`is_closed` 修好只解决 ET 观察中的一个字段，不会凭空补全后两项。
当前生产还固定 `latencyFirst: null`，没有 selectedRoutes/relayRoles，也没有
远端成员到 ET peer 的认证映射。`cost == 1` 或存在直连连接都不能单独证明
当前语音正在用该连接。

实现定位：
[接收 stats](../components/voice/src/webrtc/hybrid/receivePathStats.ts)、
[接收类型与空发送回执](../components/voice/src/webrtc/types/ReceivePath.ts)、
[媒体路径判定](../components/client/src/lib/memberVoiceMediaPath.ts)、
[独立 ET 观察](../components/client/src/lib/memberVoiceLocalNetwork.ts)、
[ET CLI 解析](../components/client/electron/easyTierCliNetwork.ts)、
[ET 投影](../components/client/electron/easyTierStatus.ts)、
[固定 proto](../components/easytier/source/easytier-proto/proto/core_peer.proto)。

## 选定的目标策略

**可靠 SFU 首段语音 + 经验证的直连优先 + SFU 常备恢复。**
“直连”定义为本应用能验证未经过 TURN 或已知 ET 中继的成员媒体路径，
不承诺证明互联网每一个路由器或用户自行安装的未知 VPN 内部路径。

| 当前证据/情况 | 默认媒体决策 | 用户显示 |
|---|---|---|
| 刚入房、仍在探测 | SFU 先通话 | SFU 服务器转发 |
| WebRTC 非 TURN，端点/接口证据可分类，持续收到正确成员媒体，质量达标 | 允许 peer；完成暂停 ACK 后切换 | 可验证直连，详情注明依据 |
| 使用 ET 虚拟地址，可信成员设备绑定和当前 ET 转发均证明直接到该 peer | 允许 peer，持续复核路径 | EasyTier 直连 |
| 任一选中 ICE candidate 为 relay | SFU 健康时保留 SFU | SFU；详情注明 peer 经 TURN |
| ET 当前选择成员或服务器中继 | SFU 健康时优先 SFU | SFU；详情注明 ET 中继 |
| 缺少路径证据 | 不因“peer 已连通”主动替换健康 SFU | SFU／peer 路径待确认 |
| peer 路径变化、持续质量恶化或失效 | 有界恢复 SFU，收到新媒体才标恢复 | 正在恢复 → SFU |
| SFU 不可用，但现存 peer 仍可用 | 保住可用音频，允许明确标注的中继应急路径 | peer 中继／路径待确认 |

中继不必然比 SFU 更慢；不同线路可能相反。但当前没有比较数据，还保留 SFU
上行，所以没有理由无条件优先中继 peer。常规策略选 SFU，更优中继例外必须
以实际质量收益支持。应急保音也不能依赖关闭一条仍可用的 peer 来证明“纯直连”。

质量判断使用正确媒体轨的丢包/解码进度、selected transport RTT、断流和资源
预算。成员 peer RTT 与“本机到 SFU RTT”不是同一条端到端路径，不能直接做
数值大小比较就宣布某条更快。阈值和窗口必须经双设备测试确定。
初始切换、ICE 重选和 ET 变路都走同一判定；未知不冒充直接，静音不冒充断线。

## 最小架构改动

首选改进是加深现有 `HybridRouteController` 的选择能力，而非增加第二套路由器。

- 扩展现有共享 stats sampler，解析精确音频 transport 的 selected pair 及两端
  candidate，输出带 PC/track/selection epoch 的分类；不把 IP、SDP 写入日志。
- 现有 controller 消费媒体健康与路径分类，在一个可测试的决策入口完成准入、
  保持、恢复和重试。UI 使用相同快照，不另开 collector 推测状态。
- ET 作为可选 adapter，承接社区已认证的成员设备绑定与固定 CLI 事实；SDK
  不读取密码、不启动 ET。成员设备绑定需要现有授权层配合，不能由昵称/IP猜测。
- 保留 SFU ACK/lease/track generation 机制。6 人范围先不优化掉常驻 SFU 上行，
  以免为省流量破坏回退；带宽优化留到端到端验收之后。
- 连接详情只展示已接通的测量与有用缺项。发送回执缺失用一条明确说明，
  不再靠成排“未知”伪装诊断能力。回执只证明对方客户端解码，不证明人耳听到。

暂不做：合并腾讯云服务、重新实现媒体编码、另一套权限协议、强制所有语音
先经过 ET、扩大 20 人 mesh、自动安装持久提权服务。

## 保留的恢复机制与证据

服务端的 `release: released` 只表示 pair 已撤销，不表示媒体已经恢复。
当前 Browser 普通及 retired recovery 都另等 SFU applied ACK 与新媒体，
没有发现把 released 直接当成恢复成功的错误。pair 30 秒有效期也会被成功的
forwarding 续租刷新；不是 SDP/ICE 信令结束后必然 30 秒失效。
SFU 暂停最多 10 秒，失联后默认恢复转发是应保留的兜底，不是无声时长保证。

| 固定回执 | 已经证明 | 没有证明 |
|---|---|---|
| [SFU48 / SDK3](../release/acceptance/sfu48-sdk3-isolated-media.json) | 隔离 2/4 SDK、真实编码/RTP/解码/回退、4 SDK 的 6 对/12 有向转发 | 完整应用、WAN、20 个完整 SDK |
| [Provider 接线](../release/acceptance/provider-instance-binding-real-media.json) | 真实 selected peer track、RTP、非零 PCM、SFU ACK、停用恢复 | 双设备听感、ET 底层、完整产品流程 |
| [backend/SFU run3](../release/acceptance/minimal-media-d38ed22d-run3.json) | 真实按边暂停、其他接收者继续收包、恢复及租约到期恢复 | 完整 SDK 自动 WAN 切换 |
| [.3 包](../release/acceptance/member-status-portable-20261013.json) | 固定包静态与隐藏离线启动/退出 | 双设备语音或物理直连 |

已安装 SDK 为 `0.6.2-laokuai.lifecycle.3`；关键选择逻辑与源码核对一致。
对应 vendor TGZ SHA256：
`897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae`。
这次没有把旧隔离通过记录升级为当前整包/WAN 验收，也没有用旧早期失败否定
后续成功。用户已确认 .3 的灰绿闪烁消失，独立于语音路径仍未知。

## 下一轮可验收工作顺序

1. SDK 接通 ICE 分类及选择门控；用固定 relay/non-relay/缺项/ICE 重选输入验证
   不误暂停 SFU，保留现有 auth/track/ACK 反例。
2. 在当前 6 人范围做两台完整客户端测试：不同网络、双向讲话、长静音/PTT、
   peer 失败→SFU、冷却后重探测。对照实际 RTP 与听感，不以菜单标签作为验收。
3. 固定 ET 2.7 默认值修复与可信成员设备/选中路径 adapter；验证 ET 直接与中继
   的对照，ET 断开仍能 SFU，进出房间不启停 ET。
4. 与本机详情/托盘退出修复合并后交付下一测试包；本轮未生成 .4 包。

当前关闭窗口修复仅改变退出反馈：先关闭自有窗口/托盘，再由主进程完成原有
有界 ET 清理和凭据撤销，且等待两个 drain 均结束。真实托盘时延仍待新包测试。

## Retro：为什么已有测试没挡住问题

过去分别证明了媒体事务、权限和字段校验，却没有把真实 Windows 双向管道、
render 时钟先后顺序和用户可见退出延迟放入统一检查入口。
这轮已把这些已完成回归接入现有 `tools/check-core-contracts.ps1` 与 Windows CI：
17 个 Node24 套件 + 1 个真实本机 Named Pipe fixture 全通过，无 UAC/ET/驱动启动。
不再以新增交接文字代替自动检查。选路改动还需前述实际网络反例，不能继续仅
增加“类型里预留证据字段”而没有生产证据来源。

## 外部语义依据

[W3C WebRTC Stats](https://www.w3.org/TR/webrtc-stats/)：selectedCandidatePairId
指向 pair，再由 localCandidateId/remoteCandidateId 找候选；candidateType 属于
候选对象，不属于 pair。`relay` 说明 ICE 中继，非 relay 不描述外部隧道内部。
[EasyTier 官方 P2P 说明](https://easytier.rs/guide/aboutp2p.html)区分直连与 relay；
固定 2.7 的字段语义以本仓库锁定源码为准，不用新版参数替换当前实现。

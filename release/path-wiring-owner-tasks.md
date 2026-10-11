# 最小可靠路径接线：可直接调度的 owner 任务

v3 源码基点是 `31cec3c6fbc8a73f5a8fac0744f04e3022e0fbd9`；私人产品启用链、
SFU48/P2P64 请求和自编 core 静态输入已在 `0c5a194f` 完成代码与纯检查。
SDK3 `78513ba4` 的两/四端 24k loopback 复验已通过；ET native `dbaf0453`
release 编译已通过。保留这些冻结证据，另取新48/64/正式 bootstrap 快照复测。
下面是下一轮独立功能提交的范围，不得改写旧验收输入。
provider 已在后续 `ca8290cf` 候选挂载并建立独立连接 scope、lease、失效和 TTL；
SDK 观察尚未接通；生产连接详情已从 UI owner `1f400bca` 完整补丁整合到
`ef5da42d`，实际数据与 DOM/设计验收仍待完成。候选合同见 `path-provider-contract.md`。
不等待外观确认才开始纯代码接线，不为完整物理路径证明增加网络协议。

## 第一阶段可以完成什么

1. 普通 SFU 同房接收：以 SDK 实际选中的麦克风接收 track、当前认证成员/
   publication 和新鲜解码增量为证据，显示“收到：服务器转发”。Hybrid 默认关闭时
   也必须支持，不得为了显示状态开启 Hybrid、创建新 PC 或查询新的媒体协议。
2. Hybrid 同房接收：显示 SDK 已选 SFU/P2P、切换/恢复/失效及新鲜媒体是否可用。
   P2P 已选且媒体可用时显示“收到：P2P；底层路径待确认”，不能只显示一个全未知
   状态，也不能称已证明物理直连。当前标签模型需区分逻辑媒体选择与底层路径。
3. 指标：只展示实际选中 transport 的 RTT 和精确 audio track 的窗口丢包。
   SFU 共用 PC 的 candidate-pair RTT 明确标为 SFU transport RTT；不是对方端到端 RTT。
   缺失、计数重置、静默无增量或过期时显示未测得，不伪造 0。
4. ET：现有 community phase、原因、自有实例存活和本地虚拟 IP 可以进入独立
   LAN 详情。复用已有只读 peer/route API 后可显示有据的本机路由事实；没有认证
   user↔peer 绑定时，不把某条 ET route 指给房内成员，不把 LAN 等同语音路径。
5. “发给对方”的已解码/已选路径：当前没有符合 UI 合同的认证远端解码回执，
   保留未确认。已有 SFU remote-inbound RTCP 是上行到 SFU 的事实，不是对方收听回执。
   详情可以独立展示已有上行 transport 指标，不能移植成 send-media proof。

## SDK owner：媒体权威只读出口

Owner：现有 SDK 线程 `01a12431-a67f-703b-af9a-6b25fc9260c3`；只写独立 SDK 树。
文件范围：

- `components/voice/src/webrtc/types/Hybrid.ts`
- `components/voice/src/webrtc/types/SFU.ts` 及对应现有 SFU hook 实现
- `components/voice/src/webrtc/hybrid/BrowserHybridVoiceSession.ts`
- `components/voice/src/webrtc/hybrid/BrowserHybridPeer.ts`
- `components/voice/src/webrtc/hybrid/HybridReceivePortAdapter.ts`
- `components/voice/src/webrtc/hybrid/SfuDecodedAudioMonitor.ts`
- 对应 SDK export、纯检查和精确 package/source 交付

复用 `BrowserHybridVoiceSession.getState/onState`、`HybridReceivePort.getSelection`、
已有 decoded monitor 和 PC getStats。当前 route 已有 participant/session/publication、
routeGeneration、selectionRevision、selectedTrackId、selected 与恢复状态；但它没有
观测时间、当前解码增量窗口、对外独立认证 scope 或选中 ICE pair/接收指标。
现有 `HybridPeerMetrics` 仅是累计上行 packet/byte/encode CPU，不能当作 RTT/接收丢包。

交付一个被动只读 snapshot/subscription，覆盖普通 SFU 和 Hybrid 的当前接收选择。
字段至少包含：当前 SDK connection epoch、认证 room/session scope（按真实可得来源
标注）、remote publication、实际 source/track/revision、route generation、可用性/
切换状态、观测时间、解码窗口起止和正增量。可提供时附选中 ICE pair 标识、
transport RTT、精确 track packet loss window。不要返回原始 SDP/candidate/IP/凭据。
普通 SFU 必须能输出自己的实际接收边；不能依赖 Hybrid enabled 才启动 observer。

解码证据现在保存在 monitor/peer 内部；新增的是只读暴露，不是重复采集网络协议。
累计 `decodedFrames` 必须按同一 track/generation 前后窗口求增量；不得将累计值
或 RMS 当作当前解码进度。复用每 PC 的 single-flight stats，并在 track 替换、
auth/room/PC 退休和 closed PC 时使观察失效。Observer 不拥有麦克风、选择或生命周期。

验收：纯 fake-PC 覆盖 SFU-only、P2P 选择、真实选择冲突、恢复后 track/revision、
计数回退/静默、陈旧 stats flight、房间/账号切换、receive-only、闭 PC、订阅退出。
保留 .3 冻结字节，单独交新 commit/package/source/hash；真实媒体验证另由容量 owner。

## ET owner：现有只读信息与明确缺字段

Owner：现有 task-7 ET owner；只写独立 ET 功能树，不能修改正在编译的 dbaf bundle。
主要文件：

- `components/client/electron/easyTierWindowsProcesses.ts`
- `components/client/electron/windowsEasyTierCliRuntime.ts`
- `components/client/electron/easyTierStatus.ts`
- `components/client/electron/easyTierMemberAdapter.ts`
- `components/client/electron/easyTierCommunityManager.ts`
- `components/client/src/lib/easyTierCommunity.ts`（必要的脱敏只读 IPC 合同）

当前生产 CLI session 只 `readNode`，明确返回 `routes:[]/peers:[]/bindings:[]`。
另一份 `windowsEasyTierRuntime.ts` 已定义 `rpc.collectInfo/bindings/observations`
端口，但不代表生产端口已实现。固定 native
`easytier/src/easytier-cli.rs` 已有 `peer list`、`route list`、JSON 输出和
按 instance 选择的 `list_peer/list_route` RPC。复用这些已有只读能力，不加协议。
先核实 JSON 字段没有被表格投影丢失；若现有 CLI 缺原始字段，复用已有 RPC
collect-info 路径，不能凭字段名编造结果。只读取当前自有实例/loopback portal，
固定 argv、超时、single-flight、AbortSignal 和退休保护；原始 stdout 留在 main。

交付 main 内真实 acquiredAt/instance/generation、node、peer、route 的脱敏 snapshot。
必须逐项说明是否真正可得：

- 认证 community user/device↔ET peerId 绑定与期限：目前无生产提供者，不能从昵称/
  虚拟 IP/peer 列表推断；缺此项时只能给本地实例详情，成员状态继续标缺绑定。
- 当前 latency-first 配置、route destination/next hop、selected connection ID、
  连接关闭状态及 tunnel 类型：现有 API 可审查读取，但 route 候选不是实际数据包决策。
- `selectedRoutes`、带测量时间的 RTT 和可信 next-hop role：生产尚未提供。
  acquisition 时间不等于 RTT 测量时间；裸 `latency_us` 不刷新成“刚测得 RTT”。
- 选中 WebRTC pair 与 ET destination 的认证关联和完整逐跳物理转发：尚不可得。
  本轮不补全链路新协议；保持独立 LAN 事实，不生成 full-path/direct proof。

ET owner 同时完成五个固定 companion/core 的分发 notices 清单；本地输入已静态
准备，自编 core 不能冒充官方 core。未运行 TUN，实际激活安全确认是独立步骤。
ET owner 必须回交“已有 API 能读到的字段/不能读到的字段”表和独立纯 CLI/RPC
adapter 测试；不得交一份永远空数组并宣称成员连接详情完成。若 authenticated
binding 需要服务器提供者，由父另派 server/community owner，不能让 ET owner
自签成员映射或把管理员/网络配置要求转嫁给普通用户。

## 客户端整合 owner：scope、provider 与单一数据流

Owner：task-6，已在独立新候选准备 scope/provider/store；接到冻结 SDK/ET 合同后
继续唯一整合。不让两位功能 owner 写同一客户端文件。
文件：`src/packages/webRTC/src/adapters/HybridVoiceBridge.tsx`、
`src/packages/webRTC/src/adapters/ReceiveCorrectionBridge.tsx`、
`src/packages/webRTC/src/components/MemberVoiceMediaPathAdapter.tsx`、
`src/lib/memberVoiceMediaPath.ts`，以及独立的只读 media evidence adapter。

独立当前 scope 来自认证 account/socket/room roster/PC epoch；不能照抄 telemetry scope。
SDK 的 roomGeneration 是 opaque string，现有 UI 模型要求 positive number：保留原 token，
使用绑定其生命周期的本地单调 epoch 映射，不能 parse/hash 成假服务端 generation。
普通 SFU 没有 Hybrid server scope 时，用明确区分的当前认证连接 scope 覆盖本地
SFU 接收，而不是开启 Hybrid 来取字段或假造 serverInstance。receive-only 没有
localPublication 时，采用方向性的接收 scope；不能填占位 publication 来通过验证。

挂载唯一 provider 在现有 ReceiveCorrectionBridge 的 children 上方，覆盖成员
侧栏和 VoiceView。按 roster publication 的唯一绑定匹配，screen/冲突 alias 拒绝。
接 SDK 只读观察，不再用 UI 自建 getStats/RMS 轮询替代 SDK 选择。已有
`useVoiceQualityReporting/VoiceQualitySampler` 是 local SFU 总量/上行质量，不能套给
单个 teammate/P2P。前台 idle 时也推进本地 TTL；房间/账号/socket/PC/track/retirement
立即清空。清理只取消自己的订阅/计时器，不能 disconnect 共享 socket、关闭 ET 或 stop 输入。

完成条件：provider 实际挂载，普通有效 SFU 接收有明确标签；P2P 显示已知逻辑选择，
未知只限缺失的底层/发送证据。过期/跨房/重连/不同 publication 均不借用旧指标。
保留当前所有 manual/PTT/Squad 与 receive correction/cache 行为。

## UI owner：生产连接详情入口

Owner：现有 task-4 UI owner；在独立冻结客户端候选上提交。
范围：`src/packages/socket/src/components/UserContextMenu.tsx`、新增只读
`ConnectionDetailsDialog.tsx`、`MemberVoiceMediaStatus.tsx` 与 EN/ZH 文案。
消费已有 provider/hooks，不写 SDK/ET adapter、协议、权限或 profile。

连接详情可先做只读生产入口：同房精确成员/publication 的接收/发送分别显示
逻辑选择、媒体可用性、切换/恢复状态、明确来源 RTT/丢包及年龄；独立 LAN 栏显示
community phase/缺绑定理由。缺失数据直接说明缺什么。保留昵称菜单、权限动作、
音量 hover/click、PTT/Squad 和键盘/focus/Escape 路径，不开放跨房媒体数据。
此入口的生产源码已在 `ef5da42d` 实现并经纯检查；实际 DOM/辅助技术与完整设计
验收仍待完成。SDK/ET translator 不由 UI owner 创建。

父可按上面四个互不重叠范围调度。每位 owner 单独交 commit/增量/纯检查/字段合同，
task-6 按 SDK→ET→provider→详情顺序固定接线快照后再交测试 owner；不重新部署 landing，
不触碰当前 SDK3/ET 冻结验收输入，不将 pending 字段算作已完成。

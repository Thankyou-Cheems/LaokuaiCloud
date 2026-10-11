# 路径 Provider 候选契约

父已并行派发 SDK、ET、UI；此候选在 `a36adcab` 之后推进，不改写该正式
Hybrid48/64 复测快照、SDK3 package 或 ET dbaf/core 输入。

## 已落地的客户端边界

- `ReceiveCorrectionBridge` 内挂载唯一 `MemberVoiceMediaBridge`，其 Provider 包住
  Hybrid bridge 与既有 children，覆盖侧栏和房间视图。receive cache/registry、
  manual/PTT/Squad、共享 socket、ET 生命周期不由新 store 接管。
- 普通 SFU 使用 `authority: authenticated-connection` 的独立 account/socket/
  room/PC/roster scope。真实 server instance 可缺，本地 publication 可为 null；
  不启动 Hybrid 来获取这些字段，不造占位 publication。该 scope 不接受发送证明。
- room authority 是客户端内部规范化输入，必须与独立当前 roster 的 instance、
  room、local user/session 完全一致。原 SDK opaque room token 原样保存，映射到
  本地单调生命周期 epoch；不 parse/hash token，不称其为服务端数值 generation。
- 账号/房间/host/socket 对象或 id/PC/local publication/SDK room token 改变会退休
  旧 lease。成员 publication/session/source 改变只退休对应绑定；screen alias、
  同 publication/同 user/shared receive source 冲突全部拒绝。receive control 的
  现有 retirement subscription 即时清空；500ms 本地 tick 覆盖 idle 生命周期和 TTL。
- store 不读 getStats/RMS、不创建 PC/媒体、不 stop/dispose 借用输入。
  tick 不更新 proof 时间。selection/track 变更时 `invalidateReceive(lease)` 会
  旋转 lease，使之前捕获的异步回调不能重新填回旧证据。
- `VoicePathDirection.selected` 与 `mediaAvailable` 独立于底层标签。新鲜 SFU
  解码可显示 server-relay；新鲜 peer 解码可显示逻辑 P2P、底层待确认。
  metrics 缺失仍是 null。未接 SDK subscription 时所有 evidence 保持缺失。

## SDK 接口依赖：消费 owner 实际类型，不要求改名

SDK owner 交回以下实际导出签名/字段来源后，task-6 单独写 translator：

1. 普通 SFU 和 Hybrid 的只读 observation/subscription 注册与取消签名，及 SDK
   connection epoch 对应当前 SFU PC 的方法。注册只观察，不取得输入/选择所有权。
2. 每条接收边的 participant/session/publication、真实选中 source/control 或其他
   可与当前 `streamSources[publication].receiveCleanup` 精确匹配的身份、track id、
   route generation、selection revision、selection invalidation/retirement 事件。
3. 普通 SFU 当前认证连接 scope；Hybrid authenticated room scope 的 server instance、
   room、opaque generation token、local identity。SDK epoch 与 PC 不匹配就拒绝，
   不能从 observation 复制 identity 来建立当前 roster scope。
4. availability/transition 的实际定义、观察时间、解码窗口起止和正 frame 增量。
   与客户端时钟同域才用于 TTL；raw RTCStats timestamp 或 remote clock 不能直接当
   本地 observedAt。累计 decodedFrames、RMS、ICE 成功不补成 fresh proof。
5. 可得的实际 selected ICE pair transport RTT、精确 selected audio track 的
   packetsReceived/lost 窗口及其时间。SDK 未提供的字段直接缺失，不再做客户端轮询。

内部 store 的 `AuthenticatedVoiceConnection.roomAuthority` 和
`SelectedVoiceMediaEvidence` 是 integration 规范化类型，**不是宣称已存在的 SDK API**。
translator 捕获 `store.capture(remoteSessionId)`，验证 SDK identity/epoch/selection，
在实际 selection/track 变更前 invalidate，再用新 lease 接收完整新观察。
不消费原始 SDP/candidate/IP/凭据，不发送新的媒体状态协议。

## UI 与 ET owner 的稳定消费边界

UI 继续用 `useMemberVoiceMediaPath(host, user, publication)` 与已有类型导出；
scope 新字段可选，原 authenticated-room fixture 合同兼容。
UI 可以将 `selected === peer && mediaAvailable === true` 展示为“P2P，底层待确认”，
不把 path-pending 误读为逻辑媒体选择完全未知。发送保持未确认，直到有独立认证
远端解码回执；当前本地 SFU RTCP 上行统计不能充当该回执。

ET owner 只交原任务范围的只读真实 peer/route 与 notices；当前 Provider 不引用
其半成品。community 本机 facts 可独立展示；没有认证 user/device↔peer 绑定时
不关联成员，不合成语音物理路径。实际 ET 合同回来后另交 adapter 候选。

## 当前验收范围

纯 VM 使用实际 source，覆盖 ordinary/receive-only、逻辑 P2P、TTL、retirement、
账号/房间/PC/socket/publication、重复 alias、旧异步 lease、opaque token A→B→A、
mounted provider 和只清理自有订阅/计时器。没有实际 PC、网络、capture、ET 或 TUN。
真实 SDK observation subscription、连接详情与新媒体冻结复验仍待 owner 交付。

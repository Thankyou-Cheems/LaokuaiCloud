# .15 双人在线故障调查

调查日期：2026-10-14（北京时间）。用户报告进入语音后虚拟地址/MagicDNS
消失、SFU 听感差、P2P 不稳定。桌面仍运行冻结的 .15；本记录不宣称新修复
已部署或真实双端验收通过。原始日志、运行中 CLI 响应及回放工具只保留在
忽略的 `.local/live15-diagnosis/`，不公开身份、凭据、端点或原始机器日志。

## 已确认的观测层故障

本机实例始终为 generation 1；真实只读 RouteList 返回本机及两条远端路由。
另一成员的 `directly_connected_conns` 空列表被 EasyTier 的 ProtoJSON 省略。
客户端 `rows(undefined)` 拒绝整份响应，随后清空联机观测和地址展示，持续记录
`invalid-owned-network-status`。这证明了观测层故障，不能据此称 ET 核心掉线。

只对固定的 `easytier-2.7.0-owned-route-list` 来源，将省略的 `conns` 和
`directly_connected_conns` 解释为空列表；其他来源、null、错误类型、超限、
身份冲突仍拒绝。凭据观察的第二次解析必须使用同一来源契约，否则第一层
修好后仍会在 issuer 校验前失败。空列表不证明物理直连。

真实双人响应在修改前抛出相同错误，修改后保留本机地址、两条路由和 issuer
观察。新增回归覆盖完整 `readCredentialNetwork` 调用，不止单独 parser。

## P2P 时间线与结论边界

本机日志记录以下事实（只代表该接收方向）：

- 19:13 已取得新鲜 P2P 媒体；首次交接发生 `pair_invalidated`，pause/restore
  请求失败；约一秒后恢复 SFU。旧日志将具体原因压成 `request_failed`，不能
  反推出当时的具体 SFU 拒绝理由。
- 19:22:58 和 19:23:20 均成功选中 P2P，收到 SFU pause ACK，后续有成功续期。
  所选 ICE 为 host/host，观测分类为 non-TURN / not-EasyTier；不能用此声称
  所有媒体走 ET，或已证明完整物理路径。
- 此后仍发生 `pair_invalidated`、`peer_path_changed`、
  `media_stale_before_switch`，以及等待远端 track 的 `operation_timeout`。
  用户确认持续回退且听感差，因此不能把短暂成功算作稳定验收。
- 线上 pair TTL 是 30 秒，lease/signal/forwarding 成功均续期；没有证据支持
  “15 秒 pair 固定寿命造成回退”的猜测。

### 媒体新鲜度冲突

生产 BrowserHybridPeer 可以向 `waitForMedia` 返回 3 秒内的健康缓存，
控制器却要求切换证据最多 500 毫秒。默认路径稳定等待为 1000 毫秒。
直接执行真实方法的纯 JS 回放证实：501/1000/3000 毫秒的旧候选仍被返回，
随后遭切换门拒绝。旧 controller fixture 每次人工刷新 observedAt、默认
关闭稳定等待，掩盖了真实缓存行为。已将切换入口默认限制为 500 毫秒，
稳态健康监测显式保留 3000 毫秒容忍。旧缓存等待实际 RTP 解码增量，
超时继续使用 SFU；不把健康容忍期冒充新的解码证明。

### 独立发现的配对清理故障

真实 Gryt handler 测试复现：远端已离开，当前本地成员仍有权限，释放自身
旧 pair 却因为再次要求远端认证而失败，阻塞 pending release 的后续恢复。
清理应保留本地认证、scope 和 pair 所有权检查，不要求已离开的对方仍在线。
该故障已复现，但尚未证明它就是本次所有 `pair_invalidated` 的原因。

固定协议错误码需贯穿 Gryt、SDK、客户端白名单日志，不能统一压成 `other`。
不得为方便诊断输出服务端任意错误文本、身份、SDP、密钥或音频。

## SFU 音质与配置一致性

实际线上配置：SFU hybrid、client token、audio-only 均开启，麦克风 Opus
限制 16000 bps / 60 ms；客户端标准档也是 16k/60，peer 档为 64k/20。
这是固定保底预算，并不随双人人数升档。SFU 转发 RTP，没有重新编码音频。
现有日志不足以证明低码率是全部听感问题，也没有实际输入/输出响度或
Opus 频带证据；16 kbps 不等于 16 kHz。

另有确定的接线不一致：初次 offer 使用配置，重新协商和移频的两个 handler
却使用固定 48k/20 wrapper。已改为同一配置入口。真实 Pion/WebSocket offer
回归各自先失败后通过，覆盖麦克风参数及非麦克风 SDP 段保持。

在 12 人全讲话、132 条下行边、每包额外 60 字节的粗略假设下：16k/60 为
3.168 Mbps，24k/60 为 4.224 Mbps，32k/60 为 5.280 Mbps；不含额外 IPv6、
RTCP、游戏等开销。24k/60 是可听测的候选，不代表实际不足 6 Mbps 的服务器
已能承受。动态档位还需现有发布者在线降档与失败保底，不能只改人数条件。
本轮尚未更改线上码率或用户音频偏好。

## 上游 EasyTier 核对

基线仍是 v2.7.0 / `8b7f1f0196edb5b580829ed5f135050fb5853478`。

- 用户的 [#2682](https://github.com/EasyTier/EasyTier/issues/2682) 被
  [#2694](https://github.com/EasyTier/EasyTier/pull/2694) 于 10 月 14 日合并关闭，
  merge `d25ccd4c1798cb18976509301c68ea1f795f7637`。当前补丁已禁用全局
  NetworkList 删除，但未包含新的 NIC/reader 停止等待实现。
- [rust-tun #6](https://github.com/EasyTier/rust-tun/pull/6)，commit
  `5ba6be073e5b486b68c12f80fac5cfb50601f024`，是退出生命周期的回补候选。
  不应整包套用 #2694 的编号共享网卡和自动防火墙，破坏现有随机 GUID /
  create_only / 本应用规则所有权边界。
- [#2680](https://github.com/EasyTier/EasyTier/pull/2680)，merge
  `d31396f04c748310cf59781aaee11c3e52226c05`，修复 STUN 地址与实际来源不一致
  时 UDP reverse probe/握手问题，尚未包含；适合独立验证后小范围回补。
- [#2619](https://github.com/EasyTier/EasyTier/pull/2619) 广播 loopback 排除、
  [#2618](https://github.com/EasyTier/EasyTier/pull/2618) secure relay 报文保持，
  以及 #2632/#2599 已在固定基线中，不能重复当作本轮新增修复。
- #2652 为内部 DataPlaneUdpSocket 接收修复、#2663 为 credential CLI 可见性；
  不直接证明 native TUN/WebRTC 故障。用户的 Magisk #1927 仍开放，与本次
  Windows 场景无直接关系。

本轮未替换 EasyTier 二进制。上游修复不会自动修复客户端 ProtoJSON parser。

## 测试干扰与运行边界

本轮 SFU Go 回归在 Windows 临时目录生成 `webrtc.test.exe` 并触发系统防火墙
许可，用户报告允许后仍重复。只读规则查询确认它们指向 `Temp/go-build*`，
不是产品 EXE。已停止这类本机测试，并确认无测试进程残留；此干扰不能当作
产品防火墙故障证据。之后真实 ICE/网络套件须在隔离环境运行，不能在用户
在线通话时反复启动。不得自动删除用户或其他程序的防火墙规则。

只读采集没有重启客户端、Gryt、SFU 或 ET，没有修改账号/配置、TUN、DNS、
路由或产品防火墙。所有“源码修复通过”和“实际双人稳定通过”必须分开记录。

## 源码验证与待交付范围

- ET 完整读取链路 15 项检查、运行时 98 项测试通过；真实私有响应回放通过。
- 核心检查 36 组、Gryt handler 12 项、SDK 12 组检查通过；客户端类型与
  定向 lint 通过。Gryt lint 无错误，仍有 10 条既有 any 警告。
- 新媒体回归在内存中执行生产 Peer 和 controller，覆盖旧缓存等待、仅采样
  增量不冒充新包、默认稳定等待后切换、停包超时保留 SFU；无真实 PC/ICE。
- SFU 原始回归先红后绿，四个 Go 包曾通过，但该运行造成上述测试干扰。
  随后新增测试禁用接口候选和 mDNS；限制后的版本仅编译通过，未重新执行。
- SDK dist 只在忽略目录中用于验证；客户端 vendor、版本锁及发布清单未改。
  后续交付必须重新生成精确 SDK 依赖和包，后端修复亦须部署才会生效。
  当前源码尚不能证明双端持续 P2P、听感或 12 人容量已达标。

# 默认配置复核与社区成员中继

状态：2026-10-13 源码审查。管理员启动版为 .5；成员中继尚未启用，本文不代表真实多设备验收。

## 找回的历史依据

只读核对了旧 dots 工作树的 `LAOKUAI-LATEST-VERSION-CLIENT-HANDOFF-20261011.md`、
`LAOKUAI-EXISTING-CLIENT-MATERIALS-20261011.md`、`VOICE-DEFAULTS-AUDIT.md` 和后续
`hybrid-network-source-1/REPORT.md`。未导入旧私人房间配置、密码、profile 或原始日志。

旧 EasyTier Game 以自动入网、独立网卡、UDP 入口与 TCP 备用为目标；TCP 备用不等于关闭 UDP 打洞。
旧私人房间的 DHCP、固定客户端端口和共享密钥不是现社区成员凭据方案的直接迁移模板。
当前由社区按设备签发短期凭据及虚拟 IP，保持社区与语音房生命周期分离。
不启用全局出口、子网代理和不必要的常驻服务；不恢复旧 Npcap 分发。

历史音频审计是候选表，随后发生过演进，不能全文当作最终配置。
当前 `AUDIO_DEFAULTS` 保留语音激活、自动噪声门、RNNoise、接收音量均衡，发送 AGC 和可选 compressor 关闭，
麦克风 50、输出 100、电竞模式关闭。旧审计里“compressor 开启”的基线已被后续默认关闭替代。
噪声门 1/200ms 是现有手动参数；默认模式已是 automatic，不能把它描述为只有固定能量门。
现有自定义设置不被这次启动修复覆盖。
最新标准网络预算为 SFU 16kbps/60ms、peer 64kbps/20ms、单声道 VBR/DTX/FEC；
历史 24k 或 48k 测试保留原范围，不改写为本版容量证明。

## 两种转发权限不能混淆

固定上游 `8b7f1f0196edb5b580829ed5f135050fb5853478` 的 credential `allow_relay` 控制该成员能否作为其他节点的中继。
false 不阻止该成员借助其他合格节点中继。目前 server/client 的 grant 合同和 issuer readback 都强制 false，
所以普通成员现在没有互助中继资格。必须同时修改凭据签发、校验及轮换，不能只改 TOML。

`relay_network_whitelist = ""` 控制 foreign network 公共转发，不能用它开启同社区互助。
保留空值可以避免把成员电脑变成陌生网络的公共中继。

源码依据：

- `components/easytier/source/easytier-core/src/peers/route/peer_ospf_route.rs`
- `components/easytier/source/easytier-core/src/peers/credential_manager.rs`
- `components/easytier/source/easytier-core/src/peers/whitelist.rs`
- `components/server/src/easytier/communityGrant.ts`
- `components/server/src/easytier/communityCredentialProvider.ts`
- `components/client/electron/communityEtGrant.ts`

## 强化方向

用户随后明确：成员中继作为预研发版本推进，不并入 .5 纯管理员测试包。

固定源码进一步核对结果：`foreign_relay_bps_limit` 只作用于 foreign network；
`instance_recv_bps_limit` 限制每连接的实例接收，不能分离本机游戏与替人转发，也不是转发上传预算。
当前没有同网 forwarded-data 专用限流。连接有 Ping/Pong、默认连接 RTT 选择和失活清理，
但 OSPF 的最少跳数/延迟优先不是按实时中继拥塞择路，不能宣称自动保护游戏带宽。
依据为 core 的 `peers/context.rs`、`peers/conn/peer_conn.rs`、`peers/conn/peer.rs`、
`peers/conn/peer_conn_ping.rs` 和 `peers/peer_center/`。
因此预研发先验证少量合格成员中继，再决定同网转发专用上传预算及路径切换滞后；
不把所有成员无限制打开，也不误用 foreign 限流字段。
TCP bootstrap 不会禁用默认 UDP 打洞，当前没有设置 `disable_udp_hole_punching=true`，无需为此强改服务端入口。

社区成员中继值得纳入，尤其腾讯云实际出口低于 6Mbps。目标是合格成员帮助无法互连的两端，
腾讯云保留发现和兜底；不是每个包广播给所有成员，也不是自动混音或一次上传后无成本扇出。
必须把成员自身游戏/语音流量与替别人转发的容量一起计算。

语音不能永远把所有 ET relay 等同为低质量：健康成员中继可能优于拥塞的腾讯云 SFU。
但现有 route 只证明下一跳，尚没有认证的中继角色及完整路径瓶颈证据；不能把“非服务器名字”认作可信成员，
也不能把一次低 RTT 当作容量证明。未知路径仍保留 SFU。

实施顺序：

1. 保持普通恢复社区即入网、正常自动打洞、语音失败不释放 ET，以及独立自有实例清理。
2. 核对固定版本的同网转发限流与选路能力，再确定成员 relay 准入；foreign relay 的限流不能冒充同网限流。
3. 版本化签发 relay 资格，保留旧 false 客户端兼容及撤销/新会话轮换；绝不扩大为出口或子网代理授权。
4. 选路区分直连、成员中继、服务器中继及未知。语音按连续解码/丢包/时延及容量保护选择，保留 SFU 回退与切换滞后。
5. 三设备受控拓扑验收后，再测 12 人语音与游戏并行。单机模拟、服务端健康或 route 可见不能替代这个验收。

.5 只交付管理员启动与自动恢复修复；它不宣称已经实现成员互助中继、成员中继限流或 12 人公网验收。

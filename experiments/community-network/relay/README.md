# 成员互助中继：独立参考策略

2026-10-13 预研发。这里仅有无网络的 Node 策略模型；当前 .6 测试包、成员
凭据合同、ET 产物及生产服务均未接入或修改。测试不运行 core、TUN、应用、
音频或系统网络操作。不代表真实 QoS、三设备中继、12 人语音或游戏并行验收。

从仓库根目录直接运行（无需安装依赖）：

```powershell
.\.local\toolchains\node24\node.exe --test experiments/community-network/relay/policy.test.mjs
```

也可使用已配置的 `node --test experiments/community-network/relay/policy.test.mjs`。
测试中的 Ed25519 密钥即时生成，身份均为虚构夹具；没有读取 profile 或真实密码。

## 已实现的窄范围

- `issueRelayLease` 只规划版本 1 的同社区转发数据资格。必须通过注入的成员
  认证函数，并有绑定 community/member/device/session 的明确同意；租约最长
  60 秒，且不超过成员会话到期时间。签名由注入的签发边界完成。
- `assessRelayLease` 验签、固定 issuer、四项绑定、权限和严格字段集合；旧版、
  未知版、额外代理权限均拒绝。停用同意、提升 consent epoch、撤销指定 lease
  或换 session 后旧租约失效。未知或超过 5 秒的撤销快照拒绝继续担任中继。
- `assessNetworkQuality` 只判断 ET 网络路径、RTT、丢包、负载和剩余上传容量，
  无需加入语音房或解码音频。语音未运行或故障不会撤销健康的 ET 中继资格。
- `selectRelay` 仅报告最多两个合格候选并选一个；必须同时满足资格和新鲜网络质量。
  未知网络路径、过期/未来观测、过载及容量不足排除。正常改进须跨过
  10 秒驻留和 20% 评分改善门槛；失格中继立即退出，无候选返回 fallback-required。
- `ForwardedEgressBudget` 每个中继实例只有一个全局 token bucket，所有 peer
  共用；本机 data/control 不扣该预算。替人转发数据按字节准入，超额丢弃。
  质量变坏或停更立即清空旧 credit，恢复时不能补领停更期间的上传额度。

所有数字是探索参数，不是产品默认。参考上限 256,000 **bit/s**，保留 256,000
bit/s 的本机余量，最低观测剩余上传 512,000 bit/s，突发 250 ms（最多 8,000
字节）；RTT ≤150 ms、loss ≤3%、load ≤0.7。`spareUploadBps` 表示已经扣除当前
本机业务后的剩余量；它必须来自可信的新鲜观测，不能使用用户填写的线路标称值。
模型默认按 packet 字节记账，尚未覆盖隧道、重传和外层链路开销。

## 固定 ET 源码接线位置（本轮只读）

依据 `components/easytier/provenance.json`：上游 v2.7.0 固定基线
`8b7f1f0196edb5b580829ed5f135050fb5853478`，当前私有源码产物来源
`089b6182c603c8ab60044b673effe0cf614cc28a`，记录 source tree
`25be11e0c9460bce1330cbd7964e4d6561f0bc14`。以下引用对应仓库现有导入源码；
不能把将来的 native 补丁套用旧二进制哈希或旧验收。

| 接线 | 本地源码位置 | 结论 |
| --- | --- | --- |
| credential 资格 | `components/easytier/source/easytier-core/src/peers/credential_manager.rs:31`、`:125` | `allow_relay` 属于 credential grant，不能用客户端 TOML 自行赋予 |
| 拓扑准入 | `components/easytier/source/easytier-core/src/peers/route/peer_ospf_route.rs:2659`、`:3022`、`:4165` | 路由投影/连接行依赖可信 credential 的 `allow_relay`；将来还需绑定版本、租约及撤销，而不是只按 hostname 认成员 |
| 数据预算 | `components/easytier/source/easytier-core/src/peers/peer_manager.rs:3010`、`:3037`、`:3094` | `PeerPacketRouter::handle_packet` 区分非本机目的与本机来源；forwarded-data 分支与 self/control 统计分开，可在实际发送前插入同实例共享预算。须覆盖所有同网转发出口并避免重复记账 |
| foreign 限流 | `components/easytier/source/easytier-core/src/peers/context.rs:1005` | `foreign_forward_limiter(network_name)` 读取 foreign_relay_bps；它不是同社区 forwarded-data 上传预算 |
| 接收限流 | `components/easytier/source/easytier-core/src/peers/conn/peer_conn.rs:1311`、`components/easytier/source/easytier-core/src/peers/context.rs:999` | 每连接接收流使用实例/foreign 接收 limiter；实例 limiter 共享，但作用在接收端，不能区分本机游戏与替人上传 |

当前 `allowRelay=false` 必须继续保持：server 的 `communityGrant.ts:245` 固定签发
false，`:268` 核对 native readback，`communityCredentialProvider.ts:72`、`:103`
拒绝越界策略；client 的 `communityEtGrant.ts:13`、`:104` 也只接受 false。
future relay 版本需要独立协商合同、native 签发/readback、旧版兼容与会话轮换，
不能把本文件的版本 1 当作现有 CommunityGrantV1 可直接接受的字段。
foreign whitelist 空值继续排除陌生网络；不赋予互联网出口或子网代理资格。

## 保留的实现限制

这里没有持久状态、RPC、native 补丁、UI 同意流程、真实选路或媒体回退代码。
`authenticate`/`sign`/`verify` 是显式可信边界；实际部署必须从受认证控制面取得
成员状态、同意、epoch 和撤销快照，并持久化单调 epoch，不能把远端自报布尔值
传进这些边界。测试真正验签及篡改拒绝，但未建立生产 issuer 或密钥管理。

packet kind、peer ID 和本机/转发分类也必须在可信 native 入口产生；不能接受远端
自称 local-data 来绕过预算。预算入口中的 `lease` 是同一时刻 assessRelayLease
的内部结果，不能作为 IPC/网络字段信任。只有 forwarded-data 在实验范围；控制
流量保持现行独立路径，尚需另行研究有界控制面保护。一个实例多 peer 共享额度，
没有实现公平排队；先到者可能占用额度。

预算只避免本参考模型主动限制本机业务，不承诺实际网卡排队或游戏延迟保护。
评分使用局部 RTT/loss/load/容量，未证明完整路径瓶颈或物理直连；尚未建模 loss
窗口、RTT 抖动和多跳容量证明。本实验没有语音媒体准入或音频状态依赖。未来语音
选择还需要独立的 pair/track/epoch 绑定与连续媒体证据，不复用这里的网络合格结果
作为语音已验收证明。时间由调用方
注入，生产需可信时间转换/单调时钟；该模型拒绝明显未来值和预算时钟回退。

下一步若继续研发，应先做 native 数据出口覆盖和资格轮换夹具，然后由用户指定
设备与运行范围做三设备受控拓扑。尚无任何真实网络验收结论。

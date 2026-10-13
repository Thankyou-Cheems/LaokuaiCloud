# 同网成员中继 native 上传预算

2026-10-13，新增源码补丁及隔离 native 候选已构建，未执行产品 core/CLI。
构建未覆盖 .6 或旧候选/旧来源回执；新产物的静态整合证明见下方。
这不宣称已经运行或完成产品/网络验收。
腾讯云公共 ET 节点配置未操作。ET 与语音生命周期独立，预算没有音频依赖。

## 最小接口与接线

TOML **根级**字段：

```toml
# bytes/s；32000 bytes/s = 256000 bit/s，仅为新候选的探索上限
member_relay_bytes_per_sec = 32000
```

- 缺省 `None`：保持旧原行为。旧普通成员的 `allow_relay=false` 合同及路由资格
  继续拒绝互助中继；这个字段不授予资格。
- `0`：同网替人数据即时丢弃并清除预算信用。本机数据、目的为本机的数据及
  控制流量不经过这个桶。`None` **不是撤销**。
- 正值：还必须具备有效的本机短租约；仅写正值 TOML 不会获得转发许可。每个
  native instance 一个桶，所有目的 peer/连接/下一跳共用；初次最多
  250 ms 突发，随后严格按完整 `ZCPacket.buf_len()` 扣字节。包大于突发容量直接
  拒绝，不缩扣。低于 4 bytes/s 的容量为零；速率很低且容量小于 MTU 时数据
  包可能全部丢弃，不能把超低设置当作可用链路。

`config/toml.rs` → `instance/config.rs` → `PeerRuntimeSnapshotInput` →
`TrafficConfig` → `CorePeerContext` → `PeerPacketRouter::handle_packet`。
运行中读取原子 peer snapshot，观测到改变 rate 或从 zero 恢复会丢弃旧信用，不补领
停用时段额度。`CorePeerContext::stop` 永久关闭桶；实例本来就是一次性对象。
没有新增线程、timer、队列、await 或 NIC/系统 QoS 设置。桶锁忙/poison 时立即
拒绝受预算的数据；不会等待，也不会把后续本机/控制包堵在 quota sleep 后面。

新 relay=true profile 必须同时具备新版资格合同、精确的新 native binary hash、
明确的有限预算和对应源码。旧 binary 可能忽略未知 TOML 字段，不能仅因写出
这个字段就认定预算存在。资格轮换/撤销由产品控制面负责；应保留普通 LAN 身份，
并通过下面的热 patch 原子设置 zero/撤销本机租约。桶不验成员身份、服务器签名、
服务器租约或同意，本机短租约只限制受控 RPC 的续期时间。

后续授权增补了真正的热 patch/readback：`InstanceConfigPatch` 的 optional uint64
tag 18 为 `member_relay_bytes_per_sec`，缺省不改、zero 拒绝、正值更新。现有
`apply_config_patch` 先验证并按既有流程持久化，再提交 `CoreRuntimeConfigStore`；
提交后的下一次受预算准入读取新值。已准入/进入旧传输队列的包不由此撤回。
只改磁盘 TOML 不会自动热更新；调用方必须通过新配置 RPC 并核对成功/readback。

`api.manage.NetworkConfig` tag 73 支持 GetConfig readback 和往返；portable
`core_config.TrafficConfig` tag 4 也携带此值，避免新版 protobuf 转换丢失预算。
旧二进制仍可能忽略新字段，故上述 RPC 只能用于核实过新 binary 的对应实例，
不能把旧 peer 或旧管理端的兼容解码当作已经具备预算能力。

新增 `InstanceConfigPatch.member_relay_lease_ms`（tag 19），只接受 0..15000：
zero 撤销，1..15000 提交本机相对时间续约，缺省 **不续约**。这个授权只存在内存，
不写 TOML、不随配置恢复或进程重启恢复。native 用 `Instant` 截止时间逐包拒绝
缺失/过期授权，无需 system clock 同步；main 停止续约不会无限期继续转发。
本轮建议 main 每 5 秒、仅在同意/后端资格和新鲜 ET 观测成立时续 10 秒；普通
LAN 身份租约与该授权分离。GetConfig 的 read-only tag 74 返回剩余毫秒。

预算 zero 或 lease zero 在已匹配运行实例的 RPC 起始阶段即原子关闭本机租约门，
然后才进入持久化 await；失败或取消可能保留旧 rate，但不会保留有效转发授权。
正向续约只在既有配置提交成功后应用，要求正 budget；锁忙/停止会返回明确失败。
剩余 lease 查询锁忙时保守返回 zero。已准入的传输仍不由此从 NIC/旧队列撤回。

专用 CLI 入口要求精确 `--instance-id`，不支持 name-only 或多实例 fanout：

```text
easytier-cli.exe -p 127.0.0.1:<ownedPort> --instance-id <ownedUuid> --output json member-relay status
easytier-cli.exe -p 127.0.0.1:<ownedPort> --instance-id <ownedUuid> --output json member-relay apply --bytes-per-sec 32000 --lease-ms 10000
easytier-cli.exe -p 127.0.0.1:<ownedPort> --instance-id <ownedUuid> --output json member-relay apply --bytes-per-sec 0 --lease-ms 0
```

apply 收到 Patch ACK 后读取并核对 budget 和租约；只输出小 JSON：
`schemaVersion=1`、`capability=member-relay-budget-lease-v1`、`instanceId`、
`bytesPerSec`、`leaseRemainingMs`、`maxLeaseMs=15000`、`applied`，不会输出完整
配置或任何 secret。旧 core 缺少 live tag 74 即报能力缺失。该 CLI 源码会随新
候选构建；本轮没有为了验证命令而实际运行 CLI 或 core。

## 资格撤销和期限的实际缺口

当前固定 ET 的 `allow_relay` 读取位于 `credential_manager.rs` 和
`route/peer_ospf_route.rs` 的 trusted credential/连接行投影；转发者的
`PeerPacketRouter` 未逐包检查 **自身** credential 的 `allow_relay`。
后端同 key upsert false 使新的可信 credential proof/路由资格变化，普通 LAN
凭据可保留，但不能作为已经在转发的节点立刻停止替人数据的证明。

`instance/management.rs` 的 upsert 发出 credential-changed；OSPF 更新
`update_my_peer_info_routine` 在事件/运行配置变更和 1 秒轮询后重新生成 admin
proof，`sync_now` 再向其他节点传播。接收方依赖受验证的路由同步、连接状态和
选路收敛。1 秒只是本机检测节奏，不是 WAN 撤销上界；丢包、失联、旧路径和
已排队包均未在本轮实际测定。本轮不报告“后端撤销 N 秒后全网停止”的结论。

新预算 hot patch zero 能在 **本机 live snapshot** 拒绝新的替人数据而保留本机
LAN/控制路径；产品必须完成并确认这一 RPC，不能只让服务器改 allow_relay。
现有 `disable_relay_data` 也有热 patch，但有 attached 流量豁免、与专用预算范围
不同，不能把它等同于本次严格的全实例同网替人数据额度。

后续已实现上述独立本机短租约，但它不是 native 对服务器签名/epoch 的验证。
main 必须串行操作、检查当前 scope/consent/backend 资格，并拒绝旧请求续约；
native 只接受本机受控 RPC 的有限相对期限。故本轮证明本机无续期后逐包失效，
不证明后端撤销在 N 秒内传播到所有 peer，更不证明撤回已经排队的物理流量。

## 转发出口与统计范围

预算在 `PeerPacketRouter::handle_packet` 的“非本机目的”分支中，foreign packet
dispatch 和既有禁止转发/跳数检查之后、任何 `send_msg_internal` 之前。
`traffic_kind` 将 Data、KCP、QUIC 及其 modified-data 类型归为数据；Ping/Pong、
RPC、relay handshake/ack 保留独立控制路径。用可信 `PeerPacketIngress::Local`
与本机 source ID 的组合识别本机发送；远端伪填本机 source ID 不能获得预算豁免。

| 出口 | 覆盖/豁免 |
| --- | --- |
| 同网 remote→直接 peer | handle_packet 一次准入后才到 send_msg_internal/peer.send_msg |
| 同网 remote→普通或 latency-first relay next hop | 同一次准入覆盖 RelayPeerMap/send_msg 的所有下一跳分支 |
| 同网包经 foreign client 作为下一跳运输 | 逻辑上仍是同网转发，send_msg_internal 前已扣一次 |
| remote→attached peer 或 attached peer→其他 peer | 作为不同 peer 身份的替人数据也计入共享桶；不是本机 NIC 注入流量 |
| 本机 NIC/代理生成与广播 | PeerOutboundPacketRouter 的本机数据出口不经过桶；不抢占替人额度 |
| 目的为本机的 peer 数据、控制包 | 不调用桶；stop 不引入这些流量的新拒绝规则 |
| ForeignNetworkPacket 的公共转发 | run 先 dispatch 到 existing foreign manager；保留原 whitelist/foreign limiter，未把它改为成员预算 |

源码路径（相对 `components/easytier/source/easytier-core/src/`）：
`peers/peer_manager.rs` 的 `run`、`handle_packet`、`send_msg_internal`、
`try_handle_foreign_network_packet`；`peers/relay_peer_map.rs` 的 next-hop send；
`peers/traffic_metrics.rs` 的数据分类；`peers/context.rs` 的实例桶所有权。
所有 **当前正常同网 receive→forward** 出口经过 handle_packet；这不是对未来插件、
其他 host adapter 或任意直接调用 PeerMap.send_msg 的不可绕过证明。可信本机
子系统若把远端流量重新生成成本机包，仍按本机处理。KCP/QUIC 的本地代理、
重传及包装外层开销需独立容量核验，不能把本次静态覆盖扩大到这些隐藏出口。
`traffic_kind` 只将上述已知数据类型归为 Data，其余 u8（包括未知类型）沿用
Control 分类并免扣。控制包未在本桶作有效载荷/频率限额；不能把它视为抗恶意
控制标签伪装、控制洪泛或全部 NIC 上传的上限。

新增现有 StatsManager 可见计数（按 network label）：

- `member_relay_budget_admitted_bytes` / `member_relay_budget_admitted_packets`
- `member_relay_budget_dropped_bytes` / `member_relay_budget_dropped_packets`

admitted 表示准入，后续发送仍可能失败；不是 NIC 上传成功字节。dropped 包含预算
不足、包过大、停止、锁忙/poison；当前未拆分原因。legacy 流量不记入新增预算
计数，既有 forwarded/self/control 计数继续保留。本轮没有新增产品 RPC/界面显示。

## 来源与验证边界

固定上游 v2.7.0 基线 `8b7f1f0196edb5b580829ed5f135050fb5853478`，现行 binary
对应源码 `089b6182c603c8ab60044b673effe0cf614cc28a`；完整来源仍见现有 provenance。
本补丁新增 `peers/relay_budget.rs`，修改 core 内配置、实例 snapshot、context、
router 和 stats，后续增补三个 proto 的 optional 字段及既有配置 patch/readback。
保留 upstream 许可/声明，未替换 payload 或改写旧产物证明。

标准库单模块已使用本机 Rust 1.95 编译并执行 7 项测试，覆盖共享完整字节扣除、
超大包拒绝、分数额度/长 idle 封顶、zero/re-enable/rate change、stop、锁竞争即时
拒绝、本机/控制分类及远端冒称本机 source。最小 core crate check 已实际通过
（Rust 1.95、locked/offline、no-default-features，1m08s，5 条既有未用/死代码
warning）。management feature 下首轮 11 项定向测试也通过，编译 1m53s，执行
0.00s；包含 TOML absent/zero/positive、dump roundtrip、TOML→snapshot 和
context zero/stop。最终短租约/热 patch 版本的 management 定向 lib test 为
17/17，通过时间 0.23s，编译 1m34s：追加本机授权到期、最大期限、zero 撤租约、
新 wire/readback/配置往返和 OS-free 热 patch 夹具的正→zero→正与缺省不变。
夹具不调用 instance.start，不开 transport/TUN/监听器；普通 peer ID、routes、
Running 状态及 disable_relay_data 均保持。

热 patch 初版还保留一次 14 通过/1 失败：无 aes feature 的精简 test build 不支持
夹具默认 aes-gcm。仅将这个不发送媒体/数据的夹具设置为 xor，未改产品加密默认；
后续 17 项通过不改写那次失败。

首轮仅 config-write/no-default-features 的 lib test 编译失败证据保留：原有
`instance/manager.rs` 测试缺 ConfigLoader 导入、`instance/tests.rs` 测试在没有
wrapped-transport feature 时引用 wrapped_transports。未修改这些无关测试，
改为现行产品 profile 已包含的 management feature 后定向测试通过。没有改锁
或换上游，使用了本机已有 protoc；不需要下载依赖或工具。

可重跑的轻量步骤（从仓库根，分条执行）：

```powershell
C:\Users\cheb2\.cargo\bin\rustc.exe +1.95.0 --edition=2024 --test components/easytier/source/easytier-core/src/peers/relay_budget.rs -o .local/member-relay-budget-tests.exe
.\.local\member-relay-budget-tests.exe
```

本机已安装 Rust 1.95.0，满足 workspace `rust-version=1.95`。后续最小 crate
编译检查可在 source 工作目录使用 `cargo +1.95.0 check --locked --offline -p
easytier-core --no-default-features`；会触发 crate 依赖编译，不属本轮单模块检查。
定向 config-write/relay-budget 单元测试须另外用相应 cargo test filter。要交付实际
`easytier-core.exe`，必须使用 **easytier 包的 bin**（不是同名 core library）及
项目既有 Windows 标准静态 CRT/特性产物流程，生成新 source/build/import/许可证
与 hash 证据；不能把最小 cargo check 当作绿色包来源或用旧 provenance 哈希。

已冻结 `.local/member-relay-native-build/source` 的 1272 个源码文件为只读，逐个
原始 byte/SHA256 和 canonical inventory 位于其 `receipts/source-inventory.json`。
独立核对匹配 monorepo native commit `0bd5d32d71b23da3b0ac4fc5af4c7bec079e2353`，
native subtree `135da8495bcdf6c57356b8f223047b49d06fd703`；1118 个工作树文件仅
CRLF/Git LF 表示不同。Cargo.lock 工作树 raw SHA f53a…、Git canonical SHA e3ee…
不同来自行尾，未修改依赖。构建命令/producer receipts 保留在同候选目录，使用
原 17 项 feature、固定 1.95、MSVC、+crt-static、locked/offline、jobs 2 和
BelowNormal；不覆盖旧产物，不把随后其他模块的 commit 当作编译输入。

这些检查没有实际运行 core、TUN、音频或生产。这里实现的是严格准入上限，
没有公平排队、完整路径健康/负载选路、上行估算、物理网卡优先级或本机延迟保证。
外层加密、隧道包装、重传可能增加物理出口字节。真实三设备、游戏/语音并行及
12 人验收仍需独立且具体获准的设备/网络范围；本限制不等于完整 QoS。

## r2：让拓扑公告跟随本机短租约

r1 的原 17-feature、core+CLI、静态 CRT check 已通过（5m32s），其只读源码及
producer receipt 保留；不从 r1 构建交付 EXE。源码复核发现原
`avoid_relay_data_preference` 从 foreign whitelist 对自身 network 的匹配生成，
空 whitelist 会使同网候选也公告避开。r2 仅在 `Some` 预算管理模式下，将
`feature_flags().avoid_relay_data` 定义为 `disable_relay_data`、zero 预算或
本机租约无效/停止中的任一条件成立；有效正预算与短租约允许同网候选公告。
`None` 保留原偏好语义，foreign whitelist 和实际 foreign 转发检查保持原样。

`peers/route/peer_ospf_route.rs` 的 `update_my_peer_info_routine` 每轮调用
`update_my_infos`，继而 `update_my_peer_info` 从 context 重新构造 feature flags；
runtime/event 变化唤醒或 1 秒 fallback 都会再次读实时租约。已有图边成本和凭据
投影会读取这项 avoid 标记。这是本机周期采样与后续拓扑传播，不能保证 WAN
所有旧路径在 1 秒内收敛；逐包原生 gate 在本机租约到期时已经拒绝新转发。

r2 management 定向 lib test 为 19/19（编译 50.65s，执行 0.23s），包含租约
有效/到期、zero、disable、legacy 公告与实时 runtime/context 读取。已有单元
覆盖 stop、控制/本机免扣和热 patch。候选新冻结目录使用
`.local/member-relay-native-build/source-r2`，r1 材料原样保留；真实产物及完整
17-feature 检查结果以 r2 producer receipts 为准。

r2 的相同 17-feature check 已实际通过（61.70s）。当前仓库不存在
`components/easytier/build.ps1`，因此使用隔离 private build script，保留既有
profile 的 flags/features/target，记录完整实际命令；没有假称执行了不存在的脚本。
从冻结 source 目录可复现的主命令如下，运行前设置已有 protoc 的绝对路径，
`RUSTFLAGS=-C target-feature=+crt-static`，并限制 jobs 2、BelowNormal：

```text
cargo +1.95.0 check --locked --offline -j 2 -p easytier --no-default-features --features cli,wireguard,websocket,smoltcp,tun,socks5,kcp,quic,magic-dns,zstd,upnp,icmp-proxy,management,endpoint-discovery,extended-services,linux-netlink,tcp-hole-punch --target x86_64-pc-windows-msvc --bin easytier-core --bin easytier-cli --target-dir <isolated-target>
```

release 将 `check` 换为 `build` 并增加 `--release`，其源码输入与 profile 相同。
仅复制成功构建的两项 EXE 到独立 `output-r2`，不运行 EXE；普通/delay PE imports、
四项 runtime payload 和 source integration 的静态准备由独立检查记录，不能用
编译成功代替运行或网络验收。

r2 release 实际 exit 0，用时 954.49s（15m54s）。逐文件原始字节再次校验确认
1272 个冻结 source 未变，匹配 commit `10b76471abb043709c9dc1fd321e845258976213`、
native subtree `381c14c582c3f05cd0db13a75f9b905c9d17b1bf`；canonical inventory
SHA256 为 `618c32de0ac8d84eb27f6cebca1aab4bd15de5bc2433f4c2fbcb4099894ef70c`。

| 候选文件 | bytes | SHA256 |
| --- | ---: | --- |
| easytier-core.exe | 20247040 | d1634bf0fdfa4b151a836b5ba121c68b1e7da65f62363048628f2f16c13b548a |
| easytier-cli.exe | 6178304 | 1638d7f1aa654255a541b98a6dd5a3466c382aa42f851eeb7f863bad2905ab43 |

producer 原件位于 `.local/member-relay-native-build/receipts-r2/build-20261013-180907.json`，
记录真实 Rust 1.95.0（rustc59807616e/cargo f2d3ce0bd）、protoc36.0、flags、features、
完整命令、source/lock/patch hashes 与 EXE/PDB hashes。实际产生了两个 PDB，独立
保存在 `symbols-r2` 并逐个核对 producer，EXE 只读保存在 `output-r2`；保留
`post-build-preservation.json`，不重写原 producer。`nativeFreezeCommit=null` 表示
producer 未将后来提交伪装成当时自动记录；源码整合证明单独绑定上述精确提交。
两项 `coreExecuted` / `cliExecuted` 仍为 false，静态 import/source 集成核验另记。

独立静态核验已 PASS：全部 1272 freeze raw digests 对应 r2 commit/tree；两个
EXE bytes/SHA 对应原 producer（SHA256
`788dc7f28363981aa6dd63ad13af90ec3ef2c6f605bfe91e87d0bbf14909cad8`）。
normal/delay imports 审计确认 AMD64，无 Packet/wpcap/Npcap imports，无动态
vcruntime/msvcp/ucrtbase/msvcr/VC-LTL/YY DLL，delay imports 为空。其独立、脱敏
回执位于 `components/easytier/receipts/member-network-20261013/` 的 `build.json`、
`static-imports.json`、`runtime-input.json`；static imports receipt SHA256 为
`ec9a798a4d53975955018640bd3493f319d36657b395b3635fac0a93ef9048ce`。
新版 profile 只更新 source/evidence 绑定，原 17 features/flags 的语义不变。
以上仍为静态验证，未执行 core/CLI，不提升真实网络验收状态。

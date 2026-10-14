# 当前开发交接

更新：2026-10-14。唯一开发目录 `D:\Dev\LaokuaiCloud`，当前实验分支 `codex/native-lan-voice`。
桌面已更新为 `1.13.22-laokuai.native.20261014.2`，账号数据和配置逐项校验未变。易记 MagicDNS
已部署并经用户确认，成员中继两端服务端开关已开启，成员移动能力也已启用。
真实多设备转发、移频恢复、游戏和 12 人 WAN 语音仍未验收。

## 当前修复：native.2 联机超时

用户 native.1 实测出现 ET 操作超时。首次日志确认可选 Ping 规则准备占据了
8 秒必需入网时限，核心就绪后仍被取消；真实 manager/runtime 接线已复现红测。
native.2 将该规则准备放到后台，保留晚到句柄清理顺序，未放宽核心验证和时限。
补充固定启动阶段/耗时/原因日志，原生 UI 不再声称 ET 失败不影响语音。
源码 `59e3d1588b91ac04d990e2c652167afc821df6de` 已同步实验分支；31 项生产适配器、
15 项网络、退出顺序、核心源码/类型检查、编译、lint 和隐藏离线 Electron 启动通过。
桌面 153 项程序文件已更新，142 项账号/配置/其他文件未变，旧版 295 文件完整备份
在 `.local/backups/desktop-before-native2-20261014-233052-9c5a2bb2/`。没有启动用户麦克风，
后端保持 native.1 镜像不变。后两次超时缺少阶段明细，真实重启恢复与双机仍待用户确认。
见 [问题记录](docs/NATIVE-LAN-STARTUP2-20261014.md) 与
[native.2 包回执](release/acceptance/native-lan-voice2-package-20261014.json)。
## 首版：整合式原生局域网语音

用户已否定下述独立面板，要求从当前客户端建立分支，保留自动成员发现与频道
管理，音频改走 EasyTier 虚拟 IP。实现和限制见
[原生分支说明](docs/NATIVE-LAN-BRANCH-20261014.md)。用户随后明确批准部署及桌面更新，
现 Gryt 原生模式已开启；桌面 .16 完整备份留在 `.local/backups/`，未启动新版麦克风。
本分支需要 Gryt 原生控制协议开关；不能直接与旧 WebRTC 客户端互通。
默认设备、固定路径 helper、私有频道授权、成员音量及移频接线已实现。
核心检查、客户端编译/类型/lint、服务端 84 项行为检查通过；真实 Electron
隐藏离线启动已通过，未挂载旧 WebRTC provider。原生 helper 134 项自检及
实际 AoO/Opus 离线检查通过，多人输出限幅避免硬削波；真实双机仍待验收。
不要将离线检查当成双机、12 人或 6 Mbps 服务器验收。

整合式候选源码 `a40dfb0a5910b07749c50aee7d56df4146659d48` 已推送上述分支，
版本 `1.13.22-laokuai.native.20261014.1`，绿色 ZIP 159963129 字节、153 文件
解压逐项哈希一致。见 [包回执](release/acceptance/native-lan-voice1-package-20261014.json)。
本地包 `.local/artifacts/native-lan-voice-20261014/`。线上镜像 `40e7c980b2f3`，公网
健康与 `server:info` 原生协议 1 已验证；17 个其他容器及 ET 管理代理未重启。
桌面 153 项程序文件核验通过，137 项账号/配置/其他文件字节未变，旧版 283 文件完整备份。
见 [部署与桌面回执](release/acceptance/native-lan-voice1-deployment-20261014.json) 和
[部署与回滚说明](release/deployment/native-lan-voice/README.md)。双方必须用新版；真实双机仍待用户测试。

## 原生音频实验 1（被后续需求替代，保留证据）

用户已要求先制作原生音频经 EasyTier 虚拟 IP 的实验，验证后再考虑移除 Electron。
新增独立 `experiments/native-audio/`：AoO / Opus / PortAudio C++ helper 和 WinForms
双击面板，既不启动 ET，也不操作现有账户。点击开始才启用音频和 UDP，直接绑定
社区虚拟 IPv4，无 WebRTC / SFU 切换。原桌面 .16、生产服务和配置均未修改。
实际编解码的离线丢包、乱序、时钟漂移、中断恢复、12 节点容量和 6 kHz 探针通过；
helper 129 项纯内存检查、4 项 stdin 启动边界及界面自检通过。真实声卡和 ET 双机
仍待验收，不据此宣布更稳定或移除 Electron。12 路全互联全部经服务器会超出
6 Mbps；容量通过不代表带宽通过。详见 [实验记录](docs/NATIVE-AUDIO-LAB1-20261014.md)。
实验源码固定 `278385779fecd1f10bd434df12763323368c8f54`，ZIP 595468 字节，
10 个文件解压逐项哈希一致，包内 helper / 面板纯自检通过；
精确哈希见 [包回执](release/acceptance/native-audio1-package-20261014.json)。
本地包在 `.local/artifacts/native-audio1-20261014/`，无需 PowerShell 即可双击面板，
未自动启动真实语音，未覆盖桌面。双方保持原应用 ET 在线，退出旧语音频道后再测试。

## .17 本地候选与原生音频评估

最新需求纠正：用户明确取消“SFU 优先首先出声”，强调其已认可的是 EasyTier
网络稳定性，尚未认可 WebRTC 稳定性。后续优先验证音频明确通过 ET 虚拟地址的
单路径方案；不为路径统计短缺拆掉仍在出声的音频。SFU 是否自动回退由后续方案
和验证决定，不再把首声双路交接当硬要求。可评估原生客户端以移除 Electron。
这不是已执行的架构迁移，真实设备/防火墙/ET 测试仍按具体范围运行。

`.17` 修复源码 `fbbbd6ab98f00fdec75a126d2d6c976c805eaa19` 已同步 public main。
绿色 ZIP 已构建并静态校验，但仍沿用旧 SFU 首声策略，因此保留为内部候选，
没有制作/交付双击增量，也没有更新桌面或部署。不要把它视作满足最新方向的版本。

本轮已完成成员节点观测目录、owned TUN 限域 ICMP 规则，以及活跃 P2P
统计短暂缺项容错；SDK routing.7。整合核心、客户端类型/定向 lint、桌面编译、
26 组原生生命周期模拟、7 组 SDK 离线检查及 public surface 检查通过。
后端 API/router/service 74 项和类型、客户端 runtime 101 项通过。
没有修改正在运行的 .16 桌面、账号或配置，没有部署或触发 GitHub CI。
远端节点状态需新版 Gryt；不需要更新 SFU、ET core 或管理代理。
详见 [候选说明](docs/LAN-AND-VOICE17-20261014.md)、
[现场诊断](docs/LIVE16-AUDIO-LAN-DIAGNOSIS-20261014.md) 和
[语音缺项回归](docs/PEER-PATH-GAP17-20261014.md)。双机验收仍待完成。

朋友反向 Ping 本机已确认 4/4 成功；本机主动请求对方超时，确切拦截点仍未
取证。用户要求先不调查 RNNoise，音质差没有被本轮代码检查证实已修复。
用户提出可迁移原生音频并移除 Electron，当前仅完成
[AoO/ET 原生路线研究](docs/NATIVE-AUDIO-OVER-EASYTIER-20261014.md)，没有切换架构。
原版 Gryt 正常语音为 SFU；成员 P2P/SFU 混合属于本项目扩展。

## 朋友使用的双击增量更新器

`.15 → .16` 现有单文件 `唠蒯云-15到16-双击更新.exe`，16044032 B。
源码 `743b5804504994c4bede420c3003c1a30be361b4`，无需安装 PowerShell 或解压软件。
自动查找桌面、快捷方式和附近安装；仅唯一匹配旧版自动更新，多份时明确选择。
账号/配置不参与替换，保留程序备份，失败回滚。真实归档 146 文件对照通过，
13 组隔离引擎/隐藏界面回归通过，正式 EXE 内嵌数据和初始化通过。
本次没有修改桌面或生产服务；.16 应用源码保持不变。
见 [使用与边界](docs/NATIVE-INCREMENTAL-UPDATER-20261014.md) 和
[精确发布回执](release/acceptance/native-incremental16-20261014.json)。

## .16 纠偏包与桌面更新

- 固定源码 `06708268dfda7e5021e145970c913968d190f40c`，SDK routing.6，已推送 public main。
- 修复 ET 省略空列表导致状态丢失、旧配对清理、媒体新鲜度与阶段等待冲突、
  SFU 重协商编码策略；客户端诊断原因复用同一枚举。没有新增重试状态机。
- 桌面 146 项程序文件匹配 .16，131 项原有账号/配置等文件哈希未变，
  277 文件完整备份保留于本地。更新后未启动应用。
- `.15 → .16` 增量 15669079 B；新用户自解压 111755008 B；ZIP 159346785 B。
  精确哈希与源码见 [包回执](release/acceptance/live16-portable-20261014.json) 和
  [桌面回执](release/acceptance/desktop16-incremental-20261014.json)。
- 37 组核心、客户端类型/lint、8 组 SDK 检查通过；增量 17 项及自解压只释放
  文件的验证通过。没有启动真实桌面客户端或本机 Go/ICE 测试。
- 上述是本地记录。源码提交的 GitHub CI 因干净环境缺少 helper 失败，后续
  SDK 步骤被跳过；不能记为 CI 通过，后续测试纠偏单独记录。
- [纠偏归属](docs/VOICE-CORRECTION16-20261014.md) 与
  [慢统计红绿证据](docs/MEDIA-FRESHNESS16-20261014.md)。真实双人持续 P2P、听感
  仍待新版实测。Gryt/SFU 已更新并通过健康检查，ET/代理代次未变；见
  [部署回执](release/acceptance/live16-deployment-20261014.json)。

## 测试与 CI 纠偏

测试/工具提交 `c92aa7b05c2eec059fa52e25e21969d0b054bdd7` 的四个独立 GitHub job 已实际通过。
移除默认旧 broker 检查、分开展示检查，补齐干净环境 helper 构建；修正
读取即产生媒体进度的模拟，生产 Peer/controller 组合拒绝三个旧时限缺陷。
见 [审视记录](docs/TEST-STRATEGY-REVIEW-20261014.md) 与
[精确 CI 回执](release/acceptance/test-ci-correction-20261014.json)。
这是测试与 CI 改动，不改变上述 .16 冻结程序；实际双机验收仍待完成。

用户提醒 GitHub Actions 月额度只有 1000 分钟，剩余额度未知。以本地检查为主，
已取消本轮尚在执行的 `38567714954`，移除普通 push 自动触发整套 CI；
保留 PR 和显式手动触发，不因每次源码同步重复跑整套远端检查。
原生更新器曾在远端测试准备的 WScript 中文目标 setter 失败，现改用
仅测试使用的 Unicode ShellLink 生成夹具，本地通过；没有再次消耗远端额度验证，
不能将该更新器记作 CI 全绿。失败证据和本地验证分别记录在更新器回执。

## .15 在线失败与待交付修复

用户 10 月 14 日双人实测：入语音后地址消失、P2P 短暂成功后反复回退、SFU
听感差，不能视为验收通过。调查和上游 PR 对比见
[在线诊断记录](docs/LIVE15-VOICE-DIAGNOSIS-20261014.md)。真实 ET RouteList 的
ProtoJSON 空列表省略触发本地整图拒绝，已红绿复现；另发现媒体新鲜度契约
冲突、离房后旧 pair 清理问题、SFU 重协商/移频编码策略不一致。修复源码与
诊断改进现已整合到上述 .16 桌面包；本节保留 .15 失败调查，后端状态另记。

本轮 Windows 上的 Go WebRTC 测试触发了 `webrtc.test.exe` 防火墙提示，已
停止并确认进程退出。用户在线测试期间不得再跑真实 ICE/网络 Go 套件；改在
隔离环境执行。不要将测试程序提示当成产品防火墙问题，不删除非本应用规则。

## 前一 .15 精简分发包

- `唠蒯云-1.13.22-laokuai.beta.20261014.15-绿色自解压.exe`：111745661 B，SHA256 `141bcbc3498f7d08d6a9a6ff635c7dbe8c6cfa22264862f48f8a930f2ac1d66f`。
- 应用源码 `b4ab252e26c6938556c168435dc9132b0f56aae0`；自解压源码 `79d0856c843b614e1ef14f0b30787e79d2bc9a96`。
- 自解压EXE比原.14 ZIP小31.3%，只释放到固定的新空目录，无需7z软件。
- 146项应用文件与.15标准ZIP逐项一致，另保留NSIS许可证；拒绝覆盖已有目录及TEMP目标。
- 中文空格路径、重复执行保留模拟配置、TEMP观测和隐藏离线启动通过，未启动用户应用或修改桌面。
- 标准ZIP：159346962 B，SHA256 `70ec7fb029a9e06d0ef9b0ed300a5e829c44e4c31e57bb5be5f78f2b269109de`；运行文件合计383716684 B。
- 见 [精简方案](docs/COMPACT-PACKAGING-20261014.md) 与 [精确回执](release/acceptance/compact15-portable-20261014.json)。

## 桌面 .15 增量更新

- 已从 .14 更新到 .15；增量包 15498862 B，SHA256 bf97df7a4b4b5053766968a5ccfb8c98dfb64d56a16ba6a8cabdc0e2b159f148。
- 146 项程序文件与 .15 标准包逐项一致；128 项原有非程序文件（含账号及配置）哈希未变，完整本地备份已校验。
- 17 项增量更新检查通过；更新后未启动应用，真实双机测试仍待用户执行。
- 见 [桌面更新回执](release/acceptance/desktop15-incremental-20261014.json)。

## 前一桌面.14包与源码

- 文件：`唠蒯云-1.13.22-laokuai.beta.20261014.14-zh-CN-win-x64-green.zip`。
- 应用源码：`d28b2ebca208cee06bc9c5d8ab0afbad90365d4a`，SDK 保持 routing.5。
- 大小：162765292 B；SHA256：
  `c550caadd726751124018560cc2c15f5c68ae41e94d5bf87e4bc0ca95dbda965`。
- `.13 → .14` 增量：`唠蒯云-13-to-14-update.zip`，18829434 B，SHA256：
  `adc90f0fddf31e314329f687213e5a7083e54513430413b803943237a761d4c8`。
  固定基线/目标哈希，只分发变化程序文件；尚非内置在线自动更新。
- 交付目录：`.local/artifacts/autojoin-test-20261013/`。
- 精确来源、许可证及对应源码见 [release/manifest.json](release/manifest.json)
  和 [包回执](release/acceptance/member-ui14-portable-20261014.json)。
  包不内嵌源码归档，SOURCE-OFFER 指向精确应用提交及源码更新清单；
  旧六份对应源码附件保留。

首次通过社区密码或管理员创建的有效免密码普通成员邀请取得身份，之后恢复
社区自动加入 ET，不依赖语音房或额外联机开关。语音优先经媒体验证的 P2P，
失败恢复 SFU；ET 故障不应阻断社区认证和 SFU。应用须以管理员权限启动，
非管理员启动可主动选择正常 UAC 重启，不自动提权、不安装持久服务。
联机偏好保存后下次启动生效；侧栏语音、音频、
联机和常规设置入口及七项白名单偏好导入导出已包含在 .7。

## 当前生产状态与回退

当前 Gryt 与 SFU 均来自 `06708268dfda7e5021e145970c913968d190f40c`；只更新这两份镜像。
Gryt：`sha256:cf83e3e70f5b4a649b3b65268ae9d2e81f39c7cea551a4ab2cc49624d65de23c`；
SFU：`sha256:b4d3097e33f01ba79586fa87fa62f3d2d9ca3593e9c0100d7f943fcb90f0abca`。公网 health 200，环境、端口、挂载、成员/聊天数据、
12 人限制、16 kbps / 60 ms、中继与移频开关保持；ET 容器及管理代理代次未变。
部署与回退使用 `release/deployment/live16-voice-fixes/run-phase.ps1` 的固定 r2
离线 wrapper 入口（精确参数见其 README）。旧镜像与在线数据库备份保留。
以下是仍需保留的此前部署来源，不表示当前镜像仍是旧版。

Gryt 源码 `5eed3757e74f76099a7f2991a6c4c9c38fbe462a`，镜像
`sha256:34cde4c1b3744568269bed640feec49706329da0ec8d1fb85a9feb1c8dea1425`。
易记域名部署见 [回执](release/acceptance/friendly-dns-deployment-20261013.json)：
仅 Gryt 重启；环境、端口、挂载、12人限制及中继开关保持，SFU/ET/代理未变。
回退基线是已支持 V2 的 fe151bbd 镜像，操作器在 `release/deployment/friendly-dns/`。
邀请与 DNS 目录已部署；`LAOKUAI_MEMBER_RELAY_POLICY_V2=1`。
2026-10-14 用户授权后仅开启 `VOICE_ATOMIC_MOVE_ENABLED=true` 并重启 Gryt，
镜像和其他配置不变；匿名 `server:info` 能力确认通过，SFU/ET/管理代理未重启。
见 [成员移动启用回执](release/acceptance/voice-member-move-enabled-20261014.json)。
实际双端移频仍待测试。
管理代理源码 SHA256
`0b1af8c5dcf0c018d0351e002b07e11f5f2a9b46851a22d5d416b1d71dc26591`，
`MEMBER_RELAY_POLICY_VERSION=2`。用户主动同意仍默认关闭，.7 可直接测试，
默认中继额度 32000 bytes/s（256 kbps）。

真实 UID1001 NodeInfo/List 读取通过，启用回执中凭据数及 allowRelay 数均为零；
操作器未替用户创建 true 凭据。公网 health200、未认证目录/relay-status401。
仅 Gryt 和管理代理重启，SFU、ET及其他容器代次、端口、挂载、12人上限和数据
保持。见 [启用回执](release/acceptance/member-relay-enabled-20261013.json)；
[先前 Gryt 更新回执](release/acceptance/community-network-v2-deployment-20261013.json)
中的关闭状态只描述当时部署。

后续 Compose 操作必须保留全部既有 overlays，尤其是：

- `/opt/stacks/gryt/live16-voice-fixes-06708268dfda-r2/activation.overlay.json`。
- `/opt/stacks/gryt/friendly-dns-20261013-r1/activation.overlay.json`。
- `/opt/stacks/gryt/voice-member-move-20261014-r1/activation.overlay.json`。
- `/opt/stacks/gryt/member-relay-v2-20261013-r1/activation.overlay.json`。
- `/opt/stacks/gryt/community-network-v2-20261013-r1/activation.overlay.json`。
- `/opt/stacks/gryt/member-address-directory-20261013-r3/activation.overlay.json`。
- `/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json`。

私有数据库、账本和配置备份在服务器
`/opt/stacks/gryt/member-relay-v2-20261013-r1/`。保留代理 runtime 目录 inode 和
member ledger；不得通过重建目录恢复服务。此前 Gryt-only 部署目录已加
`RELAY-V2-EVER-ENABLED.json`，禁止直接退旧镜像。

关闭中继时保留新版代码：客户端先将本机额度清零，后端 gate 改0，再将代理
gate 改1。在线 scope 提交 disabled consent 或续租并回读同 key 的 false；
离线凭据按既有 TTL 到期。状态查询不会主动降级，关闭 gate 不代表 WAN 立即
停止。退旧镜像前须完成所有 V2/pending/过期存储记录的 V1 转换并验证 issuer
false，详见 [V2 契约与回退前置](components/server/COMMUNITY-RELAY-V2.md)。

## 验证边界与下一步

`.14` 补齐权限校验的成员拖动和频道排序隔离，将响度圆环改为双向条、dB 和
明确状态；退出新增固定阶段计时并隔离清理异常。未改 routing.5 或音频/ET预算。
见 [实现与边界](docs/MEMBER-UI-AND-QUIT-20261014.md)。退出数秒的实机原因尚未
确认，不能宣称修复 Windows 卡顿；下次退出可读新版各阶段日志判断。

36组核心检查、22项实际 Chromium 交互、15组响度语义和9项离线界面检查、
类型/编译/定向 lint、19组包审计及增量17项检查通过。146项最终程序文件和
九条录音哈希核验通过。桌面先完整备份270项文件，再经同一增量更新；
124项用户/未知文件逐项哈希不变，未自动启动。
隐藏离线新配置启动退出0，无残留及自有网络；保留19条既有离线/禁用IPC错误。
实际管理员入口时序通过，无真实UAC/ET/TUN/设备媒体。服务器仅按本轮授权
启用 Gryt 移频开关，其他服务未重启；匿名能力确认不是双端移频验收。
私人备份和原始日志在 `.local/member-ui14-20261014/`，勿公开或删除恢复材料。

以下保留 `.13` 与更早固定版本验证记录。

`.13` 先完成本地 P2P 播放交接，再暂停 SFU；慢 ACK 后刷新当前媒体证据，恢复时
保留仍有效的 peer 至精确 SFU 确认、新媒体及本地交接完成。短序贯淡变不等于
独立编码轨时间对齐，是否主观无感仍待双人听测。ET 接入后立即异步采样，未进
语音房继续轮询；普通采样失败不重启核心，不提前采集麦克风或伪报 P2P。
详见 [实现记录](docs/SFU-FIRST-HANDOFF-20261014.md)。

14组 SDK 检查（含786条控制器断言、离线真实 Chromium/WebAudio）与类型/编译、
36组核心检查、定向 lint、19组包审计、146项最终文件、九条录音哈希通过。
增量17项检查包含真实 `.12 → .13` 全目标还原；桌面经完整263文件备份后已
应用同一增量，117项用户/未知文件哈希不变，146项程序与完整包一致，未启动。
隐藏隔离启动退出0、无残留，9次采样无自有网络，19条既有离线/禁用IPC错误保留。
实际管理员入口检查通过，无真实 UAC/ET/TUN/设备媒体或服务器操作。
恢复备份/原始日志在 `.local/handoff13-20261014/` 及更新回执指定的桌面同级
`.laokuai-update-<GUID>/`，不要提交私人回执。源码已冻结，`.12` 原归档保持不变。

用户随后要求继续排查。`.11` 后续源码修复见
[后续稳定性排查](docs/POST11-STABILITY-AUDIT-20261013.md)：认证失败与重叠更新的
恢复责任、SFU 权限往返的协商记录、SDK 重新启用时的退役恢复、诊断错误枚举。
用户授权后已重建 routing.4 SDK 并集成 `.12`，此前 `.11` 归档保持不变。
重建后8组SDK回归、36组核心检查（含112项ET回归）、类型/编译、19组包审计、
146项最终文件及九条录音哈希核验通过。实际管理员入口时序通过；隐藏离线新
配置启动退出0、残留0，8次采样无自有TCP/UDP，保留19条已知离线/禁用IPC错误。
这些检查未运行真实社区、设备媒体或ET/TUN，不代表真实双人验收。
桌面在应用未运行时完整备份并更新，111项用户文件哈希不变，未自动启动。
服务器及ET原生输入不变；私有回执/备份在 `.local/voice-stability12-20261013/`。

.10 双人实测失败：成员进出伴随 `media-policy-changed` 重连，ET 状态反复变化，
P2P 无声。保留该失败，不以旧模拟测试覆盖。修复和边界见
[语音稳定性修复](docs/VOICE-STABILITY-FIX-20261013.md)。.11 的 routing.3 SDK
保留 SFU PC 处理动态权限，补齐晚到 roster 初始化和同音频源重新绑定恢复；
ET 普通观测失败独立重试，不再重建存活核心。诊断新增安全枚举，含路径、
解码、转发 ACK、ET 生命周期与 HTTP 原因，最多三份各 2 MiB 本地文件。

.11 的36组核心检查、100项ET回归、SDK定向回归、类型/lint、19组包审计、
146项最终文件核验及九条录音哈希通过。实际编译入口 ready 时序通过；真实隐藏
离线新配置启动/退出通过，退出0、无自有残留，7次采样无自有TCP/UDP，仍有
19条既有离线/禁用IPC错误。没有运行真实社区、媒体或ET/TUN，双人验收待进行。
服务器、ET原生二进制及原有音频不变。桌面旧应用未运行，完整备份后替换程序，
111项账号/配置文件逐项哈希不变，未自动启动。私有备份、原始日志、更新回执
保留在 `.local/voice-stability-20261013/`，不公开。

.8 的 31 组核心检查、另 23 项生产运行时契约、类型/lint、152 文件 ZIP 核验和
真实隐藏离线新配置启动/退出通过。退出0、无自有残留，三次采样无自有 TCP/UDP；
保留23条已有离线/禁用IPC错误。原生 core/CLI 与 .7 相同；隐藏包验收未运行
ET/TUN 或设备媒体。另有实际 Windows DNS 规则创建/回读/清理测试，以及
用户正常启动 .8 后的本机真实 DNS 成功。桌面更新备份保留，87个数据文件未变。

下一步用当前包验证首次准入、普通重启后的自动联机、两设备域名/IP与游戏连通、
主动中继同意/额度/关闭收敛，以及实际双设备 P2P→SFU 回退和 12 个完整客户端
WAN 语音。区分 ET 路径、WebRTC 媒体路径与物理直连；未知保持未知。
当前审视入口为 [docs/PROJECT-REVIEW.md](docs/PROJECT-REVIEW.md)，设置说明为
[联机与快捷设置](docs/COMMUNITY-NETWORK-SETTINGS-20261013.md)。

.9 已包含默认手绘奇丽叶主题及原主题切换、九条中文曼波事件播报，以及非管理员
启动对话框中的“以管理员身份重新启动”选项，仍使用正常 UAC。音频在构建前
生成，客户端运行不调用 TTS；测试音频保留在忽略目录，公开源码提供可选声音包
接口，不主张音色的公开分发授权。详见 [功能说明](docs/KIRILIE-VOICE-AND-STARTUP-20261013.md)。

.9 的34组核心检查、类型/lint、152文件ZIP核验、九条音频精确哈希及实际隐藏
离线新配置启动/退出通过。退出0、无自有残留，三次采样无自有TCP/UDP，保留
19条离线CSP/禁用IPC错误。真实主题组件的6项隔离渲染检查通过；这不是完整
在线账号/设备语音验收。真实UAC重启、实际通话播报和多人媒体仍待用户测试。
此次未改生产服务。用户随后要求解压到桌面并保留配置：确认应用已退出后，
完整备份原目录，只替换152项程序文件，93项配置/账号数据文件前后哈希一致。
桌面现为.9，未自动启动；私有更新回执和备份在`.local/kirilie-release-20261013/`。
包回执中的“桌面未更新”描述打包时状态，此次后续桌面更新不修改冻结包身份。

.9 普通双击实际失败：管理员提示在 Electron ready 前调用。旧隔离启动测试
跳过该入口，不能覆盖普通启动。现由 .10 独立 ESM 启动入口修复；保留旧失败，
详见 [修复说明](docs/STARTUP-AND-PRESENTATION-FIX-20261013.md)。实际 Electron
ESM 及编译后入口时序测试、34组核心检查、19组包审计检查、类型/lint和隐藏
整包启动通过；真实 UAC 点击尚待用户测试。曼波未设置的默认音量为75%，已保存
手动值不覆盖；聊天消息区加入淡化插画，输入框保持清晰，9项隔离主题检查通过。

用户确认退出后，清理三次旧报错留下的9个已核实无窗口、无renderer的进程，
完整备份并更新桌面到 .10，152项程序文件核验，105项账号/配置数据哈希不变。
未自动启动。私有更新回执、失败试验及备份保留在 `.local/admin-ready-20261013/`。
此次生产服务、ET原生文件和九条音频均未更改。

开发使用 PowerShell 7、UTF-8 无 BOM；入口 `tools/enter-local-dev.ps1`。入会、
ET或语音接线改动先运行 `tools/check-core-contracts.ps1`，再做对应检查；纯契约
通过不代表网络验收。真实 profile、密码、私钥和原始日志不得进入 Git。
`origin` 为 PUBLIC `https://github.com/Thankyou-Cheems/LaokuaiCloud.git`，每次
push 核对目标及将公开的改动，只推明确分支/标签。源码与产物身份以 manifest
为准，实时工作树状态另查 Git。

本次整理前 HANDOFF 完整原文保存在
[历史归档](docs/history/2026-10-13-takeover/handoff-before-package-cleanup.md)。
旧版本结果、失败证据和一次性许可仅供追溯，不提升当前验收状态或授权新运行。

用户已批准清理旧包：桌面2个旧包和2个旧快捷方式移入回收站，12个旧交付包及
8个旧临时解压目录删除；.7、用户数据、源码恢复材料、许可证与原验收回执保留。
两个旧构建目录各剩一个被当前Codex占用的app.asar，合计93888918B，未强杀进程。
旧回执中的本地交付路径可能已不存在，详见
[清理记录](release/acceptance/local-package-cleanup-20261013.json)。

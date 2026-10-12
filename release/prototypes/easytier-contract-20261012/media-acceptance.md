# 唠蒯：最小隔离媒体验收方案

编制日期：2026-10-12。状态：**方案完成，测试未执行**。本文不证明真实通话、暂停/恢复、弱网回退或退出修复已经通过。

## 1. 目标与已知边界

目标是在 dots 云端、不接触用户电脑和未提交代码、不使用真实麦克风/账户/生产数据的条件下，设计能够证明以下链路的最小验收：合成音频 → 真实 WebRTC 发布 peer → 真实 Go SFU → 真实接收 peer；真实 communitybackend 控制 → SFU 应用暂停/恢复 → 服务端 ACK → 可观察的 RTP 变化；peer 切换、弱网回退和 TERM/INT 资源释放。

以下为任务交接提供的历史事实，本文未独立复跑：

- 独立 communitybackend + Go SFU + EasyTier；backend/SFU 控制失败分支已有 30 个测试通过。
- 真实 RTP 成功路径、服务端暂停/恢复 ACK 尚未验收。
- 既有 SFU 容器为 network=none，仅 loopback，UDP mux=0、ICE candidates=0；此前 7 项检查支持该部署不能原样连接 peer。
- Go 1.25.14 下观察到 PID 1 默认 TERM 后 exit 2、无 panic；用户 PC 上已有未提交退出修复，禁止重建、覆盖或臆测该补丁。

Docker 官方说明 none 网络只创建 loopback；它不是完全禁止本网络命名空间内通信，但也不会给不同容器提供互通网卡。[D1]

**不能把下列情况算作媒体通过：** 控制返回 200、ICE connected、数据通道打开、OnTrack 回调、仅发送方计数增长、纯假包转发、mock ACK、把客户端静音当作 SFU 暂停。需要接收端有效载荷和独立控制证据。

## 2. 两条测试线路，分别出结论

### A. 机制/组件测试，不声称原部署验收

- 可在单进程内使用真实 Pion PeerConnection 与真实 SFU 核心对象；或在同一 network=none 容器内启动多个进程，经 IPv4 loopback 通信。
- 若依赖显式 SetIncludeLoopbackCandidate(true)、注入 Pion transport.Net/vnet 或替换监听器，标记 `test-only-network`；它改变了候选收集/网络实现，不能代表未修改 SFU 的生产网络行为。只在独立 harness/测试构造器中使用，不改产品默认值，不污染发布镜像。[P1]
- 同一进程不是无网络：实际 UDP loopback 仍会新建 socket。若没有获准监听范围，先停在纯状态机/虚拟网络测试；明确其不属于 OS UDP 集成证据。
- 两个各自 network=none 的独立容器的 127.0.0.1 不是同一网络空间。不能靠 SDP 改写为 127.0.0.1 解决。
- 组件层可验证状态机、幂等、竞态、Close、故障注入；只有真实 socket/ICE/DTLS/SRTP 及真实 SFU 路径都存在时，才可称该层的真实 WebRTC/RTP 成功。

### B. 隔离部署集成，推荐作为最小真实媒体门槛

- 为本次验收创建独立 Docker internal bridge；不发布宿主端口、不使用 host 网络、不挂 Docker socket、不接现有网络、不接公网 STUN/TURN，不加载真实 EasyTier 身份。
- 固定同一候选 commit、镜像 digest、产品网络配置及依赖版本。运行原 SFU 二进制、真实 backend、合成 publisher A、receiver B、观察 receiver C；如验证发布者切换，再启动 publisher D。A/D 音频水印不同。
- 与原 none 部署相比，仅测试部署提供了隔离网卡；产品代码、候选筛选、鉴权及转发行为不变。报告应写“指定隔离网络配置下通过”，不能写“原 network=none 配置通过”。
- 通过正常产品配置提供测试 room、身份和 backend↔SFU 地址；仅用临时合成身份，不能绕过生产鉴权以获得集成绿色结果。若产品必须依赖未提供的真实账户，标记集成阻塞，不能改鉴权。
- 若原产品明确过滤全部容器网卡或 mux=0 的真实含义仍不明，先读固定版本配置/代码确定。`mux=0` 不天然等于没有 UDP：端口 0、mux 禁用、未初始化是不同情况。记录实际 bind 地址、socket、候选以及选中 candidate pair，再判断。
- internal bridge 不是绝对隔绝宿主：Docker 文档指出宿主与容器、容器与网关地址仍可能互通。因此不挂敏感内容，不连接宿主服务，不声称等同于完全 air gap。[D2]

### 审批与环境边界

本次只写方案，不执行创建网络、监听服务、容器启动或信号测试。

后续执行时：已有获准隔离环境内的普通测试 socket 可依任务授权执行；**创建/修改 Docker 网络、路由/防火墙、添加 NET_ADMIN、调整 tc/netem、开放或扩大监听面等安全敏感网络变更，逐次确认具体动作及范围**。不能因为有管理员运行或 session 调度授权就省略。优先申请一份明确批次：独立 internal bridge + 指定测试容器内部 TCP/UDP 监听 + 不发布端口 + 精确清理。若平台要求更细确认，遵守平台要求。

进程内 vnet 故障注入不改 OS 网络，可做组件测试；隔离网络中的用户态 UDP 代理需先核对新监听的授权范围。host 模式、真实 VPN/EasyTier 接入、公网 STUN/TURN、外部端口和生产连接不在本方案执行授权内。

## 3. 开始前先固定产品契约

不能凭本文发明 pause/resume 接口。执行者需从候选版本提取并存档：

1. 控制消息实际路径、方法/消息类型、请求 ID、room/peer/track ID、session generation、鉴权和版本字段。
2. pause 是阻止某订阅下行、某发布上行还是整个 room；对 RTP、RTCP、comfort noise/DTX 的预期；ACK 是“收到”还是“已应用”。
3. peer 切换实际含义：订阅源切换、重连替代 peer、direct↔SFU 模式切换分别列项，不混为一个功能。
4. 弱网策略：观测指标、阈值、连续坏样本数量、回退目标、冷却/恢复条件和失败提示；如未实现则标记缺功能，不能给测试加假策略。
5. shutdown 目标时限、返回码、连接 drain 顺序与依赖关闭顺序。

把实际字段映射到下文的逻辑名，保留产品未定义项为 BLOCKED。不能通过放宽断言“定义”实现为正确。

## 4. 合成音频与证据设计

### 最小输入

- 测试专用 48 kHz 音频，A 为 440 Hz 音调叠加确定性节拍，D 为 660 Hz 且不同节拍；幅度保守，不播放到真实扬声器。
- 使用已编码、有效的 Opus 固定 fixture，保存生成方式、时长、SHA-256、帧时长、声道与编码参数。按照协商 codec 及真实节奏发送，建议 20 ms/包；不可将任意 PCM 字节伪装成 Opus。
- Pion 官方 play-from-disk 是将已编码 Ogg/Opus 样本按节奏写入轨道的参考；它不代表 Pion 自动提供 Opus 编解码。示例自带公网 STUN 配置，不能原样运行；测试 harness 不配置公网 ICE server，并持续读取 RTCP 以驱动实际反馈处理。[P2]
- 固定 fixture/随机 seed；seq、timestamp、SSRC 按协商与生命周期处理，别假定 SFU 不重写 RTP header。不同 source 的有效载荷可由 fixture 帧摘要、节拍位置及可选解码频谱确认。

### 分层证据

每条记录至少含：run_id、monotonic timestamp、case_id、room、peer/session generation、logical source/track、事件类型和 request_id（实际支持时）。

- 控制：请求发出、backend 转发、SFU 应用状态、ACK 收到；区分代理 ACK 与最终应用 ACK。
- 传输：ICE 状态、所选 candidate pair、DTLS/SRTP 建立；禁止记录 ICE 密码、token、DTLS 密钥材料。
- 媒体：A 写入有效帧；SFU 入口/指定出口计数；B 读取并核对有效 payload；C 作为不被暂停的对照。源时间戳和接收时间配对，避免缓存假阳性。
- 音频解码：若已有官方浏览器或可信解码路径，离线验证音调/节拍，证明有效音频而非仅 RTP。若缺解码器，结论限制为“有效 fixture 的 RTP 转发”，不声称听感验收。
- 浏览器 getStats 可辅助看 packetsReceived、bytesReceived、packetsLost、jitter、selected pair，以及支持时的 concealedSamples、jitterBufferDelay。字段缺失要记 unknown，不填 0；增量须在同一统计对象生命周期内计算。[W1]
- 模拟浏览器客户端可用 Web Audio 的合成信号而不调用 getUserMedia；纯 Pion peer 成功不能替代实际浏览器兼容性及 UI/音频播放路径测试。

## 5. 执行步骤与通过标准

下述数值是**建议的实验室预算，不是现有产品 SLA**。执行前固定，不能失败后放宽：连接 10 秒；控制 ACK 2 秒；RTP 收敛 500 ms；正常窗口 5 秒；暂停观测 2 秒；恢复后首个新帧 2 秒。弱网/ICE 故障等待采用产品真实阈值加明确余量，不用上面 2 秒取代其超时。

### M0：预检与负控

1. 固定版本/配置/fixture，清点本次资源，确认无真实数据、宿主端口发布或外网依赖。
2. 记录容器网络、PID 树、实际 bind、候选列表、依赖就绪。
3. 原 none 配置的零候选复现只算环境负控。若某路线没候选，立即 BLOCKED，不无限重试，不加测试专用候选后宣告原路线通过。
4. 在独立用例中停止 SFU 或断开 A→SFU：B 必须停止收到新的有效 fixture 帧；恢复后重新建立基线。若仍持续收包，查直连旁路/fixture 回放/计数缓存。

通过：可证实数据必须经 SFU；或明确报告网络阻塞，未继续媒体测试。

### M1：真实媒体基线

1. A 与 SFU 建立真实 WebRTC；B/C 各自与 SFU 建立订阅连接。通过真实 backend 建立 room/control。
2. A 连续发送至少 5 秒固定帧；B/C 核对新帧、节拍和来源。
3. 以 receiver 首个有效新帧开始计稳态窗口，正常隔离网络目标有效帧交付率 ≥99%，无无法解释的持续缺口。对比 SFU 入/出口；重写 seq 时使用实际映射，不强制相同 SSRC。

通过：三段媒体证据闭合、无直连旁路、DTLS/SRTP 正常、至少一个连续窗口成功。单纯 ICE connected 不通过。

### M2：服务端暂停与恢复 ACK

以“暂停 B 对 A 的订阅”为示例；若产品契约是暂停 A 发布，则把对照换为另一发布者 D，不能错误要求 C 持续接收被全局暂停的 A。

1. 正常窗口后，经真实 backend 发送 pause。A 保持同一发送速率，B 客户端不静音、不停止读取、不主动关轨。
2. 收集 ACK 来源与实际应用事件。ACK 若只表示 accepted，仍需独立 applied 证据；两者不能混淆。
3. ACK/应用后给既定 500 ms 在途包余量，随后 2 秒 B 不再收到被暂停 source 的新媒体 payload；STUN、DTLS、RTCP、其他 source 不算泄漏。C 在订阅级暂停时继续收 A。
4. 重复同一 pause 请求，按实际协议验证幂等，不假定“一次网络请求只能收到一次 ACK”；核心是无重复状态副作用。
5. 发 resume；在 ACK 和应用证据后，2 秒内 B 收到 A 的**新**有效帧，并继续 5 秒，不把旧队列/旧缓存当恢复。C 不受影响。
6. 重复 20 个 pause/resume 周期；并测试紧邻 pause→resume，按产品顺序/版本规则处理迟到 ACK，不出现最终 UI/state 与媒体相反。
7. 在另一用例延迟/丢弃返回 ACK：SFU 可以已应用，但客户端必须显示未确认/超时，并通过产品既有幂等重试或状态同步收敛；不能伪造 success。

通过：ACK 语义、server 状态、RTP 三者一致；暂停期间 publisher 持续发；无跨 peer/room 误伤，恢复来源正确。只有控制断言过的结果仍标记“控制通过、媒体未证”。

### M3：peer 切换与竞态

1. A、D 同时提供可区分合成音频，B 从 A 切换到 D；留 C 订阅 A 做对照。
2. 记录实际切换请求、应用点及 generation；收敛后 B 只收到 D 的允许媒体，持续 5 秒。过渡允许重叠多少由产品契约决定，不能事后忽略双路泄漏。
3. 切换过程中发送针对旧 peer 的 pause、延迟旧 ACK；旧操作不能应用于新 generation。没有 generation 字段时验证产品实际等价隔离机制。
4. 断开旧 A 后重新加入相同显示名但新连接，确认不会继承旧权限/暂停状态，除非产品明确规定房间级继承。
5. 另测 B 自身掉线重连：旧订阅清理、无双路转发、重新握手与恢复可观察。
6. 若产品有 direct↔SFU 路径切换，单独执行 M4，不以订阅源切换替代。

通过：目标来源正确、旧事件不污染新连接、无串房、无长期双播、旧 peer 资源回收。

### M4：弱网与回退

先跑干净基线，再施加可重复故障，最后撤掉故障验证恢复。只控制本次测试流，不修改用户网络。

- W0：无故障，作为所有注入轮次前后基线。
- W1：单向延迟 100 ms、抖动 ±30 ms、独立随机丢包 3%，持续 30 秒，固定 seed；先看连续媒体和错误处理，不武断要求这种强度必触发回退。
- W2：仅坏首选媒体路径，备选 SFU/路径保持健康。100% 丢弃被选媒体路径的 UDP，持续超过产品检测+切换预算；信令按产品实际拓扑保持可用。期待达到真实阈值后自动回退，不能由 harness 直接调用“切换成功”。
- W3：仅控制 ACK 丢失/延迟，媒体正常；不得因为 ACK 缺失伪造已确认，也不得制造不必要持续振荡。
- W4：首选与备选都坏：显示可辨认失败/重试状态，不显示已恢复，不泄漏资源；恢复网络后按产品规则重连。
- W5：恢复稳定链路超过产品恢复/冷却周期：按设计保留回退或回切；不强制产品未承诺的自动回切。无来回抖动，媒体来源和会话一致。

组件层可用 Pion vnet 的延迟/丢包注入做确定性验证，[P3] 但必须报告该层注入未覆盖真实 Linux socket/容器部署。隔离集成优先使用产品外部的用户态转发/测试传输层，记录其是否覆盖 SRTP、STUN、DTLS 和 RTCP；若它要求修改 SFU 网络实现，只算机制测试。需要 tc/netem/NET_ADMIN 才能在不改产品下完成的用例，等待具体网络变更确认，不能偷偷替换全局 qdisc。

通过：有真实坏网观测→真实策略触发→目标路径 selected pair/peer/媒体证据→恢复策略证据。不能只检查本地 `mode=SFU`。无真实备选路径就标记回退集成 BLOCKED。EasyTier 跨节点/公网 NAT 稳定性不在此结果内。

## 6. TERM/INT 退出与资源释放回归

### 防止误判

Go 默认 SIGTERM/SIGINT 会导致退出，signal.Notify/NotifyContext 可以改为应用处理；默认退出不能保证应用自己的 drain/Close 路径完成。[G1] 交接中的 Go 1.25.14 PID 1 exit 2、无 panic 是特定观察，不能推导“panic”或“优雅清理成功”。已浏览 Go 1.25.14 的固定标签源码：dieFromSignal 在重新发信号仍未终止时确有 exit(2) 兜底。因此 exit 2 本身不足以指控 panic。[G3] 当前在线源码该兜底已为 exit(128+sig)，并明确提到 PID 1；这更说明不能跨 Go 版本套用退出码预期。[G2] 此处只是源码解释，仍须以固定工具链、实际 PID/包装进程复现。

### 测试矩阵

每个信号分别启动新实例，不在一个已退出容器上接着测试：

- SFU 空闲；有 A/B/C 活跃媒体；正在 pause/resume；正在 peer 切换/加入。
- SFU 作为容器 PID 1（exec form 启动）与普通子进程。若部署本来有 init，再单独验证其实际转发；不要为了变绿更换启动方式。
- TERM、INT、重复信号；另有一个故意卡住的测试负控用来验证 watchdog 能区分超时强杀。

### 具体操作

1. 存档镜像 digest、`go version`/构建信息、argv、PID 树、StopSignal、restart policy、初始 fd/goroutine/peer 数。
2. 启动媒体并达到 M1，控制记录开始；只给本次 SFU 的 PID/container 发送指定信号，禁止按模糊进程名杀进程。
3. 测量 signal sent → shutdown begin → listener close → peer/RTCP/RTP worker 退出 → registry 清空 → backend detach → shutdown complete → process exit。无此观测能力时补测试日志/测试钩子到候选分支须另行由实际开发执行，不能宣称已观测。
4. 先明确 TERM/INT 行为；再用 `docker stop --timeout <已固定预算>` 验证正常部署停止流程。Docker stop 会先送停止信号，超时才 SIGKILL，所以命令最终成功不等于优雅退出。[D3]
5. 取完整 stderr/exit status/停止耗时及 Docker 状态（包括 OOMKilled）；区分 signal、runtime、panic、race、watchdog 强杀。
6. 验证端口可由新的同配置测试实例重新绑定，新实例能重新跑 M1。HTTP listener、UDP mux、WebSocket、PeerConnection、ticker/context、RTCP reader 等分别检查关闭归属。进程内重复创建/关闭时要求 registry 回到基线，goroutine/fd 在固定静置期后无持续增长。
7. 同一进程内 20 次 start/stop 组件回归与容器 5 次启停分别记录。进程终结后 OS 回收 fd 不能证明组件 Close 没泄漏；重启成功也不能代替活进程资源回落。

通过标准：在已固定 shutdown 预算内自行完成，不依赖 SIGKILL；无 panic/race；退出码符合项目明确约定（建议受控关闭为 0，但不是 Go 默认保证）；日志与资源证据闭合，新实例能绑原端口并传真实媒体。纯默认信号退出只算“可终止”，不能算优雅关闭。用户 PC 的未提交修复本次不验也不覆盖，后续拿到安全的候选补丁/commit 后再跑同一矩阵。

## 7. 失败诊断顺序

| 现象 | 首查 | 禁止的假修复 |
|---|---|---|
| 零候选 | 网络 namespace、实际网卡、candidate filter、UDP bind、mux 初始化 | SDP 硬填可达地址后当作原配置通过 |
| ICE 不连 | 双方 candidate 可达、信令候选时序、selected pair、UDP 方向 | 停用 DTLS 校验或 SRTP 保护 |
| ICE 连但无音频 | codec/ptime、方向、AddTrack/协商、SFU 入口和出口、订阅状态 | 只用 OnTrack 或字节总数判成功 |
| ACK 成功仍有新 RTP | ACK 语义、scope、应用状态、source/generation、在途窗口 | 客户端停读/静音掩盖 |
| resume 没媒体 | source 是否仍发送、SFU gate、旧状态覆盖、协商/轨道关闭 | 改成自动重启整个房间后标恢复通过 |
| 切换双播/串流 | generation、旧 worker 清理、订阅映射 | 丢弃旧包但不报告服务端泄漏 |
| 弱网不回退 | 实际阈值、故障是否打到真实路径、备选是否健康 | harness 直接设置“已切换” |
| exit 2 | 固定 Go 版本、PID 1、真正退出进程、stderr/信号/包装层 | 无 panic 证据就报告 panic |
| 退出卡住 | 阻塞 read、context、锁顺序、mux 所有权、WS/RTCP worker | 放宽 timeout 或 SIGKILL 后标优雅成功 |

## 8. 清理与交付证据

- 一开始登记本次精确的 run_id、container IDs、network ID、临时目录和监听端口；失败/超时也执行同一清理路径。
- 先停 fixture 发送；关闭各 PeerConnection/读取循环，再按本次测试目的停止 backend/SFU，等待退出。保存证据后才删除本次资源。
- 删除仅本次临时容器与网络；不执行全局 prune、killall、清用户 volume、重置防火墙或删除现有资源。若清理构成不可恢复删除/安全敏感设置变更，按平台确认要求执行，不把“清理”当作豁免。
- 撤回本次获准注入的 exact rule/qdisc/proxy，核对无残留资源。清理失败单列 blocker，不隐藏。
- 结果产物：manifest（版本/配置/拓扑/授权边界）、fixture 哈希、逐案结果 JSON、控制事件 JSONL、RTP/统计摘要、日志、退出矩阵、清理记录。默认不留 raw token、ICE secret、密钥或真实个人数据。
- 每案结果只能是 PASS / FAIL / BLOCKED / NOT RUN；附层级（机制/隔离部署/浏览器/公网）与证据文件。不可把 30 项控制测试与新媒体项合并成一个模糊“全过”。

最终最小放行条件：M1+M2+M3 在未改产品网络实现的隔离部署通过；M4 对已实现回退能力有真实路径证据；TERM/INT 资源释放矩阵通过；清理完成。**公网 NAT、跨真实节点 EasyTier、实际客户端浏览器/设备、真实网络长期通话仍是独立后续验收门槛。** 若其中任一不具备条件，交付局部证据及精确 blocker，不宣称系统已可上线。

## 9. 已浏览核实的官方来源

以下均在 2026-10-12 浏览读取。main/master 与在线 Go 文档会变化，执行时还需以项目锁定版本核对 API；未从这些资料推断项目私有接口或未提交修复。

- [D1] Docker，None network driver：https://docs.docker.com/engine/network/drivers/none/
- [D2] Docker，docker network create，internal mode：https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal
- [D3] Docker，docker container stop：https://docs.docker.com/reference/cli/docker/container/stop/
- [P1] Pion WebRTC 官方源码，SettingEngine（loopback candidate、UDP mux、SetNet）：https://raw.githubusercontent.com/pion/webrtc/master/settingengine.go
- [P2] Pion WebRTC 官方 play-from-disk 示例：https://raw.githubusercontent.com/pion/webrtc/main/examples/play-from-disk/main.go
- [P3] Pion transport 官方 vnet router 源码：https://raw.githubusercontent.com/pion/transport/master/vnet/router.go
- [W1] W3C，Identifiers for WebRTC's Statistics API：https://www.w3.org/TR/webrtc-stats/
- [G1] Go，os/signal：https://pkg.go.dev/os/signal
- [G2] Go，Unix runtime signal 实现：https://go.dev/src/runtime/signal_unix.go

- [G3] Go 1.25.14 固定版本 Unix runtime signal 源码：https://raw.githubusercontent.com/golang/go/go1.25.14/src/runtime/signal_unix.go

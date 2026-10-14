# 原生音频经 EasyTier 虚拟 IP 的替代路线研究

日期：2026-10-14。范围：Windows Electron 绿色客户端、至少 12 人游戏语音、
腾讯出口标称 6 Mbps 且用户报告实际余量不足、ET 游戏网络独立运行。
本次仅阅读本地源码、官方源码及发布元数据；未编译候选、安装依赖、启动麦克风、
运行 ET/TUN、改防火墙、部署服务或进行 WAN 音频实验。所有原型均为建议，尚未实现。
用户随后补充愿意只保留 Gryt 频道/身份，重做原生局域网语音客户端并移除
Electron；因此下文也评估完整宿主/UI 迁移，不把音频 helper 误作已经去掉 Electron。

补充需求：用户已明确取消“SFU 优先首先出声”，认可的是 EasyTier 的网络稳定性，
并非已验证 WebRTC。后续实验先验证 ET 虚拟地址上的单一音频通路；SFU 是否保留
及自动回退属于后续设计，不再强制实现首声双路交接。下文 SFU 接缝分析是可选
备份的成本说明，并不要求原型同时重建旧混合策略。

## 判断

**值得做一次有明确淘汰标准的原生 UDP/AoO 对照原型，暂不值得直接替换 Gryt/WebRTC。**
其吸引力是：已经通过 ET 形成可达虚拟网络后，音频端点可以直接发送到成员虚拟
IP 与固定 UDP 端口，减少第二套 ICE/SDP/媒体路径择优的复杂度。其代价是把浏览器
负责的设备生命周期、音频线程、媒体统计和部分安全/恢复职责搬到原生层；现有
社区权限、退房撤销、SFU 备份也不会随 AoO 自动获得。

“用成熟引擎”和“网络一定稳定、服务器一定省带宽”是不同命题。SonoBus 的音频
缓冲/重采样代码有实际产品使用背景，但内嵌 AoO 是专用 fork；上游可核实版本仍
标为 alpha。Mumble 的完整语音产品更成熟，不过标准架构是 C/S。当前最有价值的
验证问题是：**在相同 ET 路径、相同单声道码率与相同故障条件下，原生 AoO 是否
显著改善首段音频、持续听感和恢复，同时保持游戏可用。**

来源：
[SonoBus 产品与构建说明](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/README.md)、
[AoO 上游镜像说明](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/README.md)、
[Mumble 项目说明](https://github.com/mumble-voip/mumble/blob/dfbac8d3d9c967003e74b4ffc5610f7d45e8f666/README.md)。

## 固定来源与维护状态

| 对象 | 本次固定版本 | 可核实活动及含义 |
|---|---|---|
| SonoBus | `35f1062dab196b9838a4bb529c4bf6592b7f5987`，GitHub 最新发布 `1.7.2` | 发布及 main 提交均为 2023-12-11；已有 Windows 成品不等于近期主线维护活跃 |
| SonoBus 内嵌 AoO | `essej/aoo` 的 `sono` 分支，`9960da7f277b2e0a4ef2725c33895559b634cab7` | `.gitrepo` 明确来源；该提交 2023-11-27；不是从当前上游动态拉取 |
| AoO 专用 fork 当前分支头 | `a16c3531d119370be2de21998458e0d17c4d346f` | 2025-08-28；有后续 fork 活动，但没有证据表明 SonoBus 1.7.2 已包含它 |
| AoO 上游 GitHub 镜像 | `v2.0-pre4`，`dc2a5be2962ba02d6cebe297f31f2774f34e7bc7` | 2024-10-11，README 明确 alpha 与预发布间破坏性变化；不能称稳定 ABI 的正式版 |
| Mumble | `v1.5.939`，`dfbac8d3d9c967003e74b4ffc5610f7d45e8f666` | 最新 GitHub 发布 2026-10-11，有当前发布活动；仍需对我们的部署/设备实测 |

版本证据：
[SonoBus 发布](https://github.com/sonosaurus/sonobus/releases/tag/1.7.2)、
[SonoBus 固定提交](https://github.com/sonosaurus/sonobus/commit/35f1062dab196b9838a4bb529c4bf6592b7f5987)、
[内嵌 AoO 来源清单](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/deps/aoo/.gitrepo)、
[fork 固定来源提交](https://github.com/essej/aoo/commit/9960da7f277b2e0a4ef2725c33895559b634cab7)、
[fork 后续活动](https://github.com/essej/aoo/commit/a16c3531d119370be2de21998458e0d17c4d346f)、
[镜像预发布标签](https://github.com/Spacechild1/aoo/tree/v2.0-pre4)、
[Mumble 发布](https://github.com/mumble-voip/mumble/releases/tag/v1.5.939)。

上游规范入口指向 `git.iem.at/aoo/aoo`。本次官方 GitLab 返回 403，官网对抓取
返回拦截页，因此只把维护者的 GitHub 镜像作为可核实快照。**2026 年官方 GitLab
最新提交、完整发布活动及其与镜像是否同步，未知。**不能用镜像日期断言整个
AoO 项目停止维护，也不能将今天的网页抓取时间误作源码更新时间。

## WebRTC 对中国用户的实际边界

WebRTC 没有“按国别不可用”的协议性质。其在某次通话是否友好稳定，要分别看
信令服务可达性、STUN/TURN 地址与可达性、两端 NAT/UDP 和实际选择的媒体路径、
跨运营商质量、SFU 出口与端点实现。这是由规范网络模型作出的判断，不是本次
中国多运营商实测结果。原生 UDP 与 ET 也可能遇到 UDP 限制或中继
拥塞；把媒体移入 ET 是把穿透交给 ET，并未消除底层条件。
[固定 WebRTC 规范的连接模型](https://www.w3.org/TR/2025/REC-webrtc-20250313/#introduction)。

本仓源码不能支持“完全没有 Google STUN 配置”的断言：SFU 未设置
`STUN_SERVERS` 时默认 `stun:stun.l.google.com:19302`，`env.example` 也如此；
配置 `ICE_ADVERTISE_IP` 时默认禁用服务端 STUN，显式 `DISABLE_STUN` 可覆盖。
客户端从社区详情 `stun_hosts` 获取列表，默认空；Gryt 服务端按自己的环境
生成该列表。因此代码中的默认地址不证明当前生产正在访问 Google，也不能
仅看 Chromium/WebRTC 是 Google 开发就断言媒体依赖 Google 服务器。本次未
读取生产环境或做网络连通测试，实际生产覆盖和中国可达性保持未知。
本地来源：[SFU 配置](../components/sfu/internal/config/config.go)、
[环境示例](../components/sfu/env.example)、
[社区 STUN 发布](../components/server/src/socket/utils/server.ts)、
[客户端列表来源](../components/client/src/packages/webRTC/src/adapters/VoiceProvider.tsx)、
[SFU 浏览器连接配置](../components/voice/src/webrtc/hooks/sfuConnectFlow.ts)。

所以当前双人失败优先按已有媒体/状态机证据解释，不能未经路径验证归因
“中国不适合 WebRTC”。若 STUN 服务不可达，配置国内/自有可达服务是一项单独
可验证工作；它并不自动修复已知状态机缺陷或不足的腾讯出口。

## SonoBus 的 fork 与上游 AoO 不能混用

SonoBus 把 AoO 源码作为 git-subrepo 纳入 `deps/aoo`，头文件路径为
`lib/aoo/aoo.h`，版本宏为 2.0.0 / prerelease 2，C API 使用 `aoo_source_*`、
`aoo_sink_*`；其中存在 compact-data 协议标志、接收端请求更换 codec、userformat
扩展。SonoBus 自己的处理器直接依赖这些接口。
[内嵌接口](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/deps/aoo/lib/aoo/aoo.h)。

可核实的上游 pre4 已采用 `include/aoo_source.h`、`AooSource_addSink`、
`AooEndpoint`、`AooClientSettings` 等接口；Opus 参数经 `codecControl` 控制，
格式初始化方式也不同。因此借用 SonoBus 音频处理器时必须保持其固定 fork，
或者承担移植；独立开发 helper 可以评估 pre4，但它不是 SonoBus 的即插即用升级。
这里证明的是 API 和集成差异，**没有完成全量 fork 差异审计或跨版本协议互通测试**。
[上游 Source C API](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/include/aoo_source.h)、
[上游 Opus 接口](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/include/codec/aoo_opus.h)、
[上游版本宏](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/include/aoo_defines.h)。

## 虚拟 IP 直发的实际可行性

SonoBus 的 `connectRemotePeer(host, port, ...)` 会创建指定端点并建立 AoO
source/sink；socket 的监听代码使用 `bindToPort`，并非已有“只绑定 ET 接口”的
选项。官方 Direct 页面说明允许输入 IP:UDP 端口，但明确它只经过有限测试、
支持有限，且与群组发现模式互斥。普通用户手动填写 Direct 页不符合本产品目标。
[实际处理器](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/Source/SonobusPluginProcessor.cpp)、
[Direct 官方说明](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/doc/SonoBus%20User%20Guide.md)。

上游示例 `simple_sender` 可以从命令参数得到 HOST/PORT/ID，解析为 socket
address，构造 `AooEndpoint` 并调用 `addSink`，不必先加入公网群组服务器。
源/接收对象通过音频回调处理 PCM，网络线程单独 send/receive。库提供 C 和
C++ API，适合嵌入原生 helper；示例同时表明**音频设备后端仍需由宿主提供**。
[固定示例](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/examples/cpp/simple_sender.cpp)。

pre4 的 `AooClientSettings` 提供外部 UDP socket 及发送回调入口。需要严格约束
源地址/接口时，可以在我们的原生层持有并绑定 ET 虚拟地址的 socket，再按 API
接入；这是一条源码支持的开发路径，**不是本轮完成的 Windows 集成能力**。
仅设定目标虚拟 IP，一般由系统路由决定走 ET；若同时使用公网群组发现、自动
切换其他地址，不能声称全流量限定 ET。应校验虚拟网段、成员身份与当前会话 epoch，
仅接受授权端点；地址变化撤销旧端点；ET 失效交给 SFU，不为语音重启游戏 ET。
[外部 socket 接口](https://github.com/Spacechild1/aoo/blob/dc2a5be2962ba02d6cebe297f31f2774f34e7bc7/include/aoo_types.h)。

ET 虚拟 IP 可达表示内层 UDP 的公网穿透由 ET 承担。ET 本身仍可能走 UDP/TCP
隧道、成员中继或腾讯中继，物理直连与拥塞不能由虚拟 IP 证明。相反，浏览器
标准 `RTCConfiguration` 没有按 Windows 网卡或本地 IP 绑定 PeerConnection
的通用参数；筛选 ICE candidate 不等同于可移植的接口绑定保证。因此原生明确
端点确有简化价值，不能顺便宣称现有所有 Chromium WebRTC 都能强制 ET。
[固定 WebRTC 规范](https://www.w3.org/TR/2025/REC-webrtc-20250313/#rtcconfiguration-dictionary)。

## 音频网络处理已有基础，语音前端仍需补齐

内嵌 AoO 提供可调接收缓冲、乱序/丢失/重传事件、重传次数和间隔、发送冗余、
时间滤波与动态重采样；sink 实际实现包含缺块检查和重采样处理。SonoBus 在应用
层另有 Auto-Increase/Auto-Full/Initial-Auto 缓冲调整、drop 统计及重置期间保护。
这些足以支持有价值的对照，不支持“任何抖动都低延迟无损”的承诺。提高缓冲
换稳定性会增加延迟，重传需要在播放期限前完成；ET 内层 UDP 若再受外层 TCP
队头阻塞，原生 codec 不能消除它。
[内嵌 AoO sink 实现](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/deps/aoo/lib/src/sink.cpp)、
[SonoBus 应用缓冲策略](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/Source/SonobusPluginProcessor.cpp)。

SonoBus 该版本实际预设为 `OPUS_SIGNAL_MUSIC`，application 为
`OPUS_APPLICATION_RESTRICTED_LOWDELAY`，默认格式索引指向 96 kbps/声道。
其 Opus codec 仅配置 complexity/bitrate/signal，未发现 INBAND_FEC、DTX 或
packet-loss-percent 配置；解码调用的 `decode_fec` 参数为 0。因而不能把
“采用 Opus”写成“已启用语音 FEC/DTX”。若原型需要 VOIP/FEC/DTX，应核实选用
API、编码模式、接收恢复路径和实际包，并独立验证，不能只加一个开关。
[固定 Opus codec 实现](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/deps/aoo/lib/src/codec_opus.cpp)、
[Opus 控制参数说明](https://opus-codec.org/docs/opus_api-1.5/group__opus__encoderctls.html)、
[Opus RTP FEC 说明](https://www.rfc-editor.org/rfc/rfc7587#section-3.3)。

SonoBus README 明确没有 AEC 或自动降噪，建议戴耳机，且其数据通信不内置加密。
有 noise gate、EQ、压缩等不等于能消除扬声器回声；AoO 的时钟重采样也不等于
AEC。ET 隧道安全需按本仓固定版本/配置另行核实，音频仍应校验社区成员和房间
权限，不能把“网络里能发包的人”自动当作合法发言者。
[SonoBus 功能边界](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/README.md)。

普通小白语音还需要：设备枚举/拔插/默认设备改变、独占冲突、静音/PTT、VAD、
降噪、增益和限制器、每成员音量与混音、防止 11 路叠加削波、正确的播放参考
信号、睡眠恢复及有界退出。AEC 若要支持外放，必须获得实际送入扬声器的混音
参考，包括原生 peer、SFU 与应用播报，并解决设备与时间对齐；这通常比 UDP
socket 接线更难。原型可先明确耳机限定，但产品是否接受该限制需单独判断。

## Mumble 对照：成熟 C/S 语音，不是现成 P2P

Mumble 正常客户端连接 Mumble server；固定 UDP 协议明确区分 client→server
的 target 和 server→client 的 context/sender_session，并携带 Opus。把 server
部署在腾讯，或让客户端通过 ET 虚拟 IP 连接腾讯上的 server，仍然是服务器
转发；没有减少全房 fan-out。把 server 放在一个成员电脑可把流量转给该成员，
但增加其上传、在线与故障责任，不能称为全互传 P2P。
[固定 Mumble UDP 协议](https://github.com/mumble-voip/mumble/blob/dfbac8d3d9c967003e74b4ffc5610f7d45e8f666/src/MumbleUDP.proto)。

其 AudioInput 已有 Speex AEC/预处理、可选 ReNameNoise 降噪、Opus 编码，
AudioOutputSpeech 有 jitter buffer、解码与重采样。小白游戏语音的音频处理
基线比原样 SonoBus 更贴近场景，但这些代码嵌在完整 Qt 客户端中；抽成 Electron
helper 不是已有官方 drop-in SDK。需要剥离 Global/设置/设备/用户/网络状态等
依赖并保留行为验证。改造为 P2P 还要重做身份、加密、会话和拓扑，不能因为其
音频代码成熟就宣称整个改造版同样成熟。
[AudioInput](https://github.com/mumble-voip/mumble/blob/dfbac8d3d9c967003e74b4ffc5610f7d45e8f666/src/mumble/AudioInput.cpp)、
[AudioOutputSpeech](https://github.com/mumble-voip/mumble/blob/dfbac8d3d9c967003e74b4ffc5610f7d45e8f666/src/mumble/AudioOutputSpeech.cpp)、
[AEC 排错方法](https://github.com/mumble-voip/mumble/blob/dfbac8d3d9c967003e74b4ffc5610f7d45e8f666/docs/dev/AudioInputDebug.md)。

建议把原版 Mumble 当听感/稳定性对照或独立应急语音选项；若目标仍是少占腾讯
出口，优先验证 AoO/明确虚拟端点，而不是承诺尚不存在的“P2P Mumble”。

## 12 人带宽：纯负载下界，不是容量保证

设 n=12、每人同时连续发单声道、每人收到其他 11 人、码率 b。全互传共
`n × (n−1) = 132` 条有向流；每客户端上传/下载各 `11b`，全网负载 `132b`。
传统不混音的 C/S/SFU 服务器，12 人连续同时说话的出口负载也为 `132b`；
客户端向服务器只上传 `b`。以下为十进制 Mbps，未含任何协议/隧道开销：

| 每人音频码率 | 每客户端全互传上/下行各 | 132 条流 / 集中转发出口 |
|---:|---:|---:|
| 16 kbps | 0.176 Mbps | 2.112 Mbps |
| 24 kbps | 0.264 Mbps | 3.168 Mbps |
| 32 kbps | 0.352 Mbps | 4.224 Mbps |
| 48 kbps | 0.528 Mbps | 6.336 Mbps |
| 64 kbps | 0.704 Mbps | 8.448 Mbps |
| SonoBus 默认 96 kbps/声道 | 1.056 Mbps | 12.672 Mbps |

这些是算式，不是实测。双声道相应纯 codec 负载约翻倍。VAD/DTX 和多数时间只有
少数人说话可降低平均值，不能用平均值保证 12 人同时发声的最坏情况。

即使只算最小 IPv4+UDP 28 B，单流 20 ms/包已增加 11.2 kbps，132 流增加
1.4784 Mbps；60 ms/包增加约 0.4928 Mbps。AoO 包头/控制、ET 内外封装与加密、
外层传输、重传/冗余、分片、游戏和信令还在其上。原生 AoO 的真实 packetization
需抓包核实，不能套用当前 SFU 60 ms 就当已成立；IPv6 等路径还有不同开销。
[IPv4 头部规范](https://www.rfc-editor.org/rfc/rfc791#section-3.1)、
[UDP 头部规范](https://www.rfc-editor.org/rfc/rfc768)。

若所有 132 条流都经腾讯 ET 节点单次中继，腾讯出口仍至少 `132b` 加开销；ET
不会将 11 份目的端不同的音频自动合成一份。更多中继跳数还增加路径总
流量。只有实际在家庭/成员间直连，或经其他被授权成员中继的那部分，才会减少
腾讯语音出口。第三方成员中继是在转移上传与 CPU 成本，不能当成免费容量。

少量 SFU 备份也应按实际订阅边数 m 预算：至少 `mb`，加头部和控制；例如在
全互传之外让一个成员始终额外收到另外 11 人的 SFU 流，就加 `11b`。当 ET
不可用导致全房回退，预算立即回到全房服务器转发。若同时保留健康 peer 和
重叠 SFU 发送/接收，切换窗口还会重复占流量。以 6 Mbps 为最低名义边界、实际
余量已不足时，不能承诺 12 人高码率全回退与游戏中继同时稳定；应记录实际可用
出口、设置预算/准入、规定降级行为。集中混音可改变带宽曲线，但会增加服务端
解码混音、用户单独音量/静音和迁移成本，属于另一方案，本轮没有实现。

## 当前 Gryt native.ts 的真实含义

本地检查快照 HEAD：`a479acdea71e23a25a2d85a72a185db699743a89`。
`components/voice/src/platform/native.ts` 导入 `react-native-webrtc` 的
`mediaDevices` 与 `RTCPeerConnection`，通过 `nativePlatform` 提供 React Native
平台适配；麦克风输出是 passthrough，处理依赖 libwebrtc。`src/native.ts`
只是注册这个适配并导出共同 engine。它**不是 Gryt 自研的 C++ UDP/AoO 音频引擎，
也不是 Windows Electron 的原生音频 helper**。默认 `src/index.ts` 注册 web
平台，Electron 的当前接线仍是浏览器 WebRTC。
本地来源：[native 适配](../components/voice/src/platform/native.ts)、
[native 入口](../components/voice/src/native.ts)、
[默认入口](../components/voice/src/index.ts)、
[包依赖/导出](../components/voice/package.json)。

另一个边界：当前 Electron web 平台显式设置 `echoCancellation:false`、
`noiseSuppression:false`、`autoGainControl:false`，通过自己的 RNNoise/门限/音频
处理链工作。因此不能用“换原生将失去当前已启用的浏览器 AEC”作为反对理由；
当前 AEC 并未开启。迁移应对照现有降噪、增益、压缩/限制和收听控制的实际行为。
本地来源：[web 适配](../components/voice/src/platform/web.ts)、
[麦克风处理结构](../components/voice/src/audio/types/Microphone.ts)、
[RNNoise 处理器](../components/voice/src/audio/processors/rnnoiseWorker.ts)。

## 迁移工作与最小可证伪原型

建议原生 helper 子进程先于 Electron native addon：音频线程/UDP 生命周期可以
隔离，崩溃可由现有客户端诊断和恢复；需要固定 IPC schema、token/epoch/成员
撤销、命令白名单、设备与统计事件，以及打包/更新/有界退出。它不要求另装
持久服务，但其 Windows 构建、静态运行库、第三方许可、源码对应声明、杀软和
正常防火墙提示都要独立验证；Electron 的体积也不会因仅替换音频引擎而消失。

若明确要去掉 Electron，最终需要独立原生可执行客户端：选择原生 UI/设备宿主，
迁移登录和安全凭据保存、频道/在线成员显示、WebSocket 控制协议、成员授权与
撤销、ET 子进程监管、设置、快捷键、设备列表、日志、绿色打包和更新。原有 React
组件不能直接搬进 JUCE/Qt；保留 WebView 又会保留相应浏览器运行时成本。最小
界面可以先只做社区登录、频道列表、成员、静音/PTT、设备和状态，控制首期范围。
具体新包体积和依赖体积必须在固定构建产物上量测，本文不估计减包百分比，也
不承诺保留现有全部 UI/聊天能力。

只取 AoO 库与取整套 SonoBus 是不同依赖范围。内嵌 AoO LICENSE 是 BSD 条件，
SonoBus 整体 GPLv3 且依赖 JUCE；原生 helper 需按实际取用范围保留许可证和
源码材料，不能借 AoO 的许可推导复制 SonoBus 处理器可免除其许可要求。
[AoO 固定许可](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/deps/aoo/LICENSE)、
[SonoBus 许可](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/LICENSE)。

保留 SFU 是最有成本的接缝：AoO packet 不是 WebRTC RTP/SRTP，不能直接投进现有
SFU。要么让共同 PCM 麦克风输出同时接原生 encoder 和浏览器 WebRTC track，
要么由原生 helper 实现兼容的 SFU WebRTC 通路。前者要处理 IPC 延迟、重采样、
采集单一所有权及两路播放；后者将重新引入 WebRTC 和原生依赖。并行采集两次
麦克风不是可接受的默认方案。先做 AoO 单路径对照，再决定是否值得支付混合
迁移成本。社区认证保持独立；ET 失败时的语音备份需要明确设计，不能假定原有
SFU 已自动兼容。是否保留自动回退遵循上述最新需求和后续验证。

可证伪原型分三关：第一关纯本地合成信号/内存网络实验可在现有开发范围内推进；
涉及真实麦克风、当前客户端、ET/TUN/防火墙或远端的运行须先明确具体范围。

1. **离线音频与生命周期。** 固定 AoO fork 或 pre4 其中之一、固定 Opus 版本；
   Windows helper 用单声道 48 kHz、16/24/32 kbps、20/40/60 ms 候选分包。
   用录制测试信号与人工丢包/乱序/抖动/时钟偏差验证，记录处理耗时、缓冲、
   underflow、退出/设备切换。若依赖无法干净打包、音频线程阻塞、时钟漂移累积，
   则淘汰。fixture 不代表真实设备或 WAN 验收。
2. **相同两设备、相同 ET 路径的 A/B。** 先取得虚拟 IP 单播可达证据，再分别跑
   当前 .16 WebRTC 与原生 AoO；固定耳机/素材/码率，记录首可听时间、p95 延迟、
   最长断音、丢包/重传、实际 ET 路径和双方字节计数。覆盖稳定直连、授权中继、
   ET 暂时中断/恢复、设备拔插/睡眠。若只是更换路径而非引擎更好，不能算引擎
   胜出；若对照差异小于预先约定门槛，或中断恢复更差，停止扩大迁移。
3. **12 个完整客户端及游戏。** 同时发声与通常轮流说话分开；统计每台上传、
   CPU、混音削波、腾讯实际出口、peer/relay/SFU 订阅边。单独压游戏流量并记录
   延迟/丢包，验证语音不会重启 ET 或抢占导致游戏不稳定。故意全房回退验证预算
   及明确降级行为。若超过实际出口预算、语音持续断音或游戏退化，不能承诺 12 人。

每关都先约定数值门槛与日志字段，记录固定源码/构建/设备/网络条件；没有满足
前一关不进入下一关。优先测 30–60 分钟持续听感和恢复，随后再做更长稳定性。
当前没有任何证据能给原生方案标记“实验通过”“稳定版”或“比现有 .16 更好”。

**唯一建议路线：先做独立原生 AoO/ET 最小实验客户端，只借用 Gryt 的社区身份、
频道与成员控制协议，用明确虚拟 IP 单播传音；通过上述三关后，再决定是否正式
替代 Electron 客户端，并添加预算明确的备份通路。**固定版本、低码率语音参数
和一个最小原生 UI 足够回答该问题，不先移植整套 SonoBus 或重造 P2P Mumble。
原版 Mumble 仅作为成熟 C/S 听感对照。实验阶段 .16 保留可回退；没有 12 个
完整端点证据前，这条路线明确为实验版。本文不改变当前发布就绪状态。

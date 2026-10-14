# SonoBus 与当前 .12 网络及交付审视

日期：2026-10-14。当前源码 HEAD `4f2e77a458852ed98084702928474ee7c92384e3`；
`.12` 应用来源 `942f1a8a2173b43d2b05902aaa7503fe54c4b9aa`。
两者的 `components/client`、`components/voice` 无差异。
本次未修改产品代码、桌面、用户配置或生产服务；未运行真实麦克风、ET/TUN 或公网通话。

## 结论

当前架构能够表达“SFU 首段音频、后台验证 P2P、按成员切入、失败恢复”的产品目标，
但 `.12` 尚不能宣称达到稳定双人、12 人 WAN 或无感切换验收。原先 `.10` 双人失败
不能被模拟通过覆盖，`.12` 也不能沿用旧负载结果宣称全产品通过。
优先解决当前交接窗口与更新成本，不因完整 ZIP 较大就更换语音引擎。
SonoBus/AOO 保留为独立对照候选，不将其成熟音频功能等同于我们的 ET 组合已验证。

## 架构对比

| 维度 | SonoBus | 当前唠蒯云 .12 |
|---|---|---|
| 媒体 | 原生 AOO/Opus 多人互传 | 每对成员 WebRTC peer，加常驻 SFU 连接 |
| 服务端 | 群组连接服务主要用于成员发现，不转发音频 | Gryt 认证/信令，SFU 初始音频及回退，独立 ET 服务 |
| ET | 需验证地址选择和接口约束，不能直接假设组模式只走 ET | ET 常驻游戏网络；语音 ICE 独立选择，ET 为可选底层路径 |
| 初始可听 | 等到成员媒体连接可用 | 先走 SFU，peer 验证期间继续使用 SFU |
| 回退 | 官方资料未给出我们这样的 SFU 接管机制 | 精确转发 ACK、新媒体确认、有界恢复与重试 |
| 产品整合 | 音乐协作取向，当前身份/邀请/ET/权限需接入 | 已有社区身份、邀请、短域名和语音控制 |

SonoBus 官方 README 明确无内置回声消除、自动降噪和数据通信加密；Direct 标签页
官方标注测试/支持有限。正常群组模式是应优先对照的入口，强制走 ET 仍需验证。
官方原始资料：

- https://github.com/sonosaurus/sonobus/blob/main/README.md
- https://github.com/sonosaurus/sonobus/blob/main/doc/SonoBus%20User%20Guide.md

## 当前代码确认的时序与限制

1. `HybridVoiceBridge.tsx` 等当前 SFU PC connected、身份和 roster 就绪后初始化
   Hybrid；它不是让用户等全部 peer 完成才使用 SFU。
2. `HybridRouteController.ts` 默认选 SFU，每机并发探测 2 条，启动间隔至少 250 ms；
   媒体验证之后还要求路径稳定 1000 ms。租约和媒体操作各有 10000 ms 超时，
   不应误读为整个流程固定 10 秒或整房 10 秒完成。
3. peer 路径准入要求非 TURN，加 `not-easytier` 或 `easytier-direct` 底层证据。
   未知或已知 ET 中继不会正常替换健康 SFU。地址已经分配不等于准入已完成。
4. 当前顺序：取得 peer 媒体证据 → 请求停止该成员到本机的 SFU 下行 → 等 applied
   ACK → 重验先前 candidate → 本地切换播放源。服务器已经停转发、客户端尚未
   切换时存在交接窗口；缓存可能掩盖，不能凭源码断言必然产生可听中断。
5. candidate 的 `observedAtMs` 是快照。ACK 之后没有重新获取 candidate，就按
   500 ms 新鲜度验证。可复现：100 ms ACK 切 P2P；750 ms ACK 即使 peer 当前可
   返回新鲜样本，仍以 `media_stale_before_switch` 回 SFU。不是已证实的上次 WAN 根因。
6. `HybridReceiveInput.ts` 用 disconnect/connect 更换输入，没有专门的时间对齐或
   增益过渡。SFU 和 peer 的编码/缓存延迟可能不同，不能承诺无感、不重复音节。
7. `checkPeerPath` 监控路径准入和媒体新鲜度，没有将持续 RTT/丢包质量阈值接入决策。
   “连接且有媒体”不等于比 SFU 更好，现状不是完整的质量择优。
8. SFU 连接和发送上行保留，但选 peer 后相应 SFU 下行被暂停；并非两路音频一直
   热播放。peer 硬断时仍需恢复转发并等新媒体。SFU PC 整体断开也会影响 peer
   生命周期，不能宣称 SFU 全故障时 peer 无依赖。
9. ET 社区生命周期独立。语音不应触发 ET 重启是代码契约；同机资源和服务器
   带宽仍共享，真实多设备联机稳定性待验收。

## 本次隔离验证

本机 Node24 运行以下既有检查，全通过：

- `components/voice/scripts/check-hybrid.mjs`：689 条模拟断言。
- `check-hybrid-integration.mjs`：23 条模拟断言。
- `check-hybrid-session.mjs`：85 条会话模拟断言。
- `check-hybrid-source-ownership.mjs`：输入节点所有权/恢复检查。

另复用该 fixture 与当前编译产物进行 100/750 ms ACK 对照，确认第 5 项。
这些不是浏览器真实媒体、真实 SFU ACK 或 WAN 听感测试。
复跑脚本与输出在忽略目录 `.local/network-review-20261014/`：
`check-routing.ps1`、`probe-handoff.mjs`、`inspect-packages.ps1`、
`inspect-executable-delta.ps1`。未改已有模拟断言或产品实现来取得通过。

## 包体积实测

直接读取 `.11`、`.12` ZIP，逐文件 SHA256 对比，不读取用户 profile。
以下大小均为十进制 MB（1 MB = 1,000,000 B）。

| 项目 | .12 中的压缩字节数 |
|---|---:|
| 完整 ZIP | 161048733 |
| Electron 应用 EXE | 94412015 |
| app.asar | 17659942 |
| EasyTier core + CLI | 11736582 |

146 项程序文件中 140 项完全相同，6 项变化，0 项删除。
变化项：EXE、app.asar、broker EXE/回执、SOURCE-OFFER、THIRD-PARTY-NOTICES。
只打包整个变化文件仍需约 112.27 MB，因此简单的“文件级增量”还不够。
两版 EXE 长度均为 214117376 B，实际只差 61 字节，落在两个 64 KiB 块中。
变化文件压缩字节数扣除完整 EXE 后为 17861037 B。
因此“EXE 二进制补丁 + 其余变化文件”有望约 18 MB，加清单和更新器开销。
这不是已生成或已验收的升级包；未来变更更大或原生运行时升级时不能继承该大小。

建议首次继续交付完整绿色包，后续提供固定来源到固定目标的更新包：
校验基线/目标哈希、仅操作程序白名单、应用退出后暂存验证并替换、失败回滚、
保护 profile/账号/配置、保留必要源码对应声明。发布渠道还需要可信来源验证，
不能把补丁内自带的哈希当作发布者身份认证。

## 建议下一步的验收目标（尚未实现）

- SFU 首段音频不等待 ET 或 peer 准入，加入/重连不因 peer 探测失败而重建 SFU。
- peer 收到新鲜媒体并经过稳定观察后，先准备好本地接收输入；完成可控的本地
  播放交接，再释放多余 SFU 下行。暂停确认失败时恢复动作必须有界并保持可听。
  更新 candidate 不能放松身份、epoch、精确 ACK、撤销和单一播放所有权约束。
- 同时验证两路时间差、重复音节、音量跳变；不能只加交叉淡化就宣称无感。
- 诊断给出入房到首段媒体、peer 首段媒体、切换、最长断音、恢复等时间证据；
  静音/DTX 与真断流分开验证。认证与未知路径继续如实显示。
- 真正双设备跨网络验证后再扩 12 人。旧 20 席记录为 2 SDK + 18 RTP 回放端，
  不等于 20 个完整用户；已有 16k/60 SFU 约 3.17 Mbps 是预算，不是 6 Mbps
  服务器同时承载语音和任意游戏中继的保证。

本次产物是审视结果，不新增测试版，不改变用户和朋友当前正在测的 `.12`。

后续用户已授权实施：见 [`.13` 播放交接与增量更新](SFU-FIRST-HANDOFF-20261014.md)。
以上基线反例和待验收事项作为历史证据保留，不因离线回归通过而升级为 WAN 验收。

# 音频默认组合与可观测性审视

2026-10-13。本轮修复音频设置中自动语音门打开后看不到实际门限/电平的问题，
不调整路由、码率、用户已存偏好或 DSP 增益算法。硬件录音、真人试听、
双设备媒体与游戏负载未运行，不能据此宣称音质或实时性能已验收。

## 默认组合与取舍

新配置保持 `noiseGateMode=automatic`、RNNoise 开、接收端自动平衡开；
发送 AGC/压缩器关，备用 AGC 目标 −20 dBFS；麦克风 50%，总接收 100%。
`useAudioSettings.ts` 的 `getUserValue(key, default)` 保留已保存的 true/false、
手动门限和音量；切回手动模式不重置 `noiseGate` 和 `noiseGateRelease`。

自动门只决定帧何时通过，不能替代 AGC 或压缩器。AGC 改变慢变 RMS 电平；
压缩器缩小峰值/动态范围。现有发送 AGC 是自有 RMS 控制器，非 WebRTC AGC2，
增益范围 0.1..4，目标同时受 −6 dBFS 峰值余量约束，低于 RMS 0.001 不更新。
发送压缩器位于 AGC 后，有 +3 dB 固定 makeup，强度会改变阈值、比率和 knee。
这些均能改变模型看到的电平；默认一起开启会增加噪声提升、动态/音色变化
以及上下游控制器适应负担。因此小白默认只保留必要门控/降噪，统一队友音量
由接收端承担；输入确实过轻时可单独试 AGC，动态确实过大时再试压缩，
无需自动关闭或迁移用户此前明确选择。

麦克风滑杆按线性振幅 0..200%→0..2，50% 是约 −6.02 dB；
100% 是 unity，不是设备硬件增益百分比。浏览器采集请求
`autoGainControl:false`，避免同时请求浏览器 AGC。设备自身 DSP 是否仍启用
不能由该请求证明，需硬件/实际 track settings 检验。

## 实际发送与接收链

本客户端 frame-aligned 发送链：采集→音量→可选 AGC→可选压缩及 makeup→
始终限幅/trim/soft clip→RNNoise 或不降噪的模型 evidence 分析→自动/手动门→
监听 tap→静音/最终 publication boundary→编码。这里 RNNoise 位于末端模型阶段；
不能套用 SDK 非 frame-aligned 的旧“降噪→AGC”描述。

上方“输入”分析器位于音量后、其他 DSP 前。“处理后”分析器在语音门后、
静音前，和麦克风测试监听同一 tap；它不证明 final publication 或远端交付。
自动门的 `rmsDbfs` 是模型返回的实际帧 evidence，门学习底噪、SNR 也使用此值；
它与上方输入采样点不同，不能用手动门 0..100 的 level 反推替代。
手动检测 level 是 −100..−30 dBFS 范围中平滑/裁剪后的传统标度，保持原滑杆配置。

接收端现行链见 `components/voice/docs/receive-longterm.md`：每个已绑定麦克风
自动慢增益→个人音量→快速向下保护/样本限幅→求和→总接收音量→总线限幅。
它使用可靠语音窗口的 −20 dBFS robust RMS 目标，学习范围 −12..+18 dB，
上升/下降 +1.5/−3 dB 每个已接受语音秒；正增益还受噪声预算和当前语音约束。
个人与总音量不反馈至自动测量，调低后不会被补回；未知/屏幕音频不做自动提升。
收端仍不能修复发送端已经削波或失真的信号。发送 AGC/压缩保留高级选择，
避免对每次普通使用叠加另一套常开控制。开关文本与实际运行状态分别显示；
RNNoise 请求开启但处理器尚未可用时不会宣称已经运行。

个人音量保存在 `useSettings.ts` 的 `userVolumes[serverUserId]`，通过既有用户
存储恢复；`useServerState.ts` 换流或设置改变时重施加个人 0..200% 线性增益。
自动平衡从 personal GainNode 之前测量，不回补它；`ReceiveRoute.activate()`
实际接线是 input→leveler→manual→limiter，fallback/recover/off 也不改写 manual
coefficient。新增 `check-receive-recovery.mjs` 回归用个人 .37 / master .42
非默认系数确认此顺序和失效/恢复/关闭/暂停后的保存，节点是假节点，不作
真人听感保证。现行 `check-receive-longterm.mjs` 的真实官方 PCM 回归同时保留。

## 本轮只读观测修复

SDK automatic-gate snapshot 增加实际模型 `rmsDbfs`、开启/保持参考门限。
达到 10 个可信非语音学习帧前门限为 null；中等概率开启需要概率≥0.7、
SNR≥10 dB 和相邻候选帧，门开后概率≥0.6、SNR≥6 dB；概率≥0.95
可直接开门。释放保持期仍可开门。因此界面同时列出两个参考门限、底噪、
当前概率和实际模型输入，不把 floor+offset 称为唯一判定开关。
新增字段仅用于观测，不改音频决定。

PCM 电平使用 `getFloatTimeDomainData` 的 RMS→20log10，不把频谱字节幅度
标成百分比电平/dBFS，不把 >−30 dBFS 全部夹成 −30；过满刻度仍可观察。
未取得设备、track ended/disabled/muted、context 暂停/关闭、处理器加载失败
或 >500ms 没有新 snapshot 时，自动观测返回 unavailable，UI 显示待测。
全零/非有限帧显示 null/—，不伪造 −100 dBFS 底噪、不沿用旧电平。
关闭语音门时处理后可为全零，因此 — 的解释与“无可测信号”一致。
普通输入频谱保持频谱用途，30fps 仅读 UI，音频门控仍由 worklet 负责。

## 官方资料与证据边界

- [Web Audio 官方编辑草案：AnalyserNode time-domain data](https://webaudio.github.io/web-audio-api/#dom-analysernode-getfloattimedomaindata)：返回实际 PCM；频域 API 用于频谱。
- [Web Audio 官方编辑草案：DynamicsCompressorNode](https://webaudio.github.io/web-audio-api/#DynamicsCompressorNode)：压缩通过阈值/ratio 等参数改变动态；不是开关型语音门。
- [W3C Media Capture and Streams：autoGainControl](https://www.w3.org/TR/mediacapture-streams/#dom-mediatrackconstraintset-autogaincontrol)：采集 AGC 是独立的可约束属性，允许关闭避免改变音频。
- [Xiph RNNoise 官方源码](https://github.com/xiph/rnnoise)：RNNoise 是循环神经网络降噪，不能据此等同 RMS 自动增益。

参考资料核对日 2026-10-13。默认组合是结合本项目现有 DSP、接收控制和
历史过热输入问题的工程判断，官方资料不替本项目作音质/真人标签保证。

回归命令：SDK `scripts/check-gate-observation.mjs` 在修复前失败于缺失实际模型
RMS，修复后通过不同采样点、校准期、强语音、全零、无效 evidence；客户端
`scripts/check-audio-observation.mjs` 通过 PCM RMS、过载、全零/非有限输入、
无设备/结束/禁用/静音 track 和 suspended context。其余本轮源码/构建结果
由交付记录列明，纯夹具不启用真实麦克风。

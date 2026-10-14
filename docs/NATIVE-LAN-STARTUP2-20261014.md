# native.1 联机超时：可选 ICMP 准备占用连接时限

用户在 native.1 桌面看到社区已连接、频道已收到，但社区联机显示操作超时。
现场私有日志显示凭据申请成功，三次失败均在 core-start 之后。
首次连接从 15:25:33.099Z 开始，41.100Z 触发 8 秒管理器时限；
可选的 owned TUN ICMP 准备在 41.803Z 才报告成功，随后规则和 core 被清理。
服务端公网健康、原生能力 1 和 ET 管理代理均正常。

`WindowsEasyTierCliRuntime.connect` 在验证核心凭据/节点就绪后仍等待
`prepareOwnedInterface`。ICMP 只是 Ping 支持，却被放进必需入网时限；
慢 Windows 规则准备可让已就绪局域网被管理器取消。这不是 AoO/Opus 媒体故障。

复现使用真实 `EasyTierCommunityManager` 和 `WindowsEasyTierCliRuntime`，
固定已就绪核心、延迟规则准备，执行
`components/client/scripts/check-community-easytier-production.mjs`。
改前断言得到 `operation-timeout`；改后核心在规则准备仍挂起时完成连接，
跨越原时限仍保持连接。退出等待晚到的规则句柄并清理后才释放核心；
可选准备失败和诊断观察者异常均不能破坏已建立的局域网。

native.2 把可选规则准备移出连接等待，使用单独生命周期取消信号并保留
清理归属；不延长或取消入网总时限。增加固定枚举的启动阶段、累计耗时及
CLI 失败类别日志，不记录账号、配置、地址、凭据或原始错误文本。
联机 UI 按音频模式显示依赖关系，原生版不再声称 ET 失败不影响语音。

界限：第一次失败具备完整时序并已由代码路径复现。后两次重试没有阶段
明细，不能据此保证同因；需由新阶段日志及用户再次启动确认。
没有为复现启动真实麦克风、驱动或修改当前网络；离线通过不等于双机通话通过。

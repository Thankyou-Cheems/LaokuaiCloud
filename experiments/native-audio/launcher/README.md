# Windows 原生音频实验面板

这是独立 AoO / EasyTier 音频实验入口，未集成或替换 Electron 客户端。
Windows 自带 .NET Framework 4.x WinForms；运行 EXE 无需安装 PowerShell 7。
构建脚本须用 `pwsh` 7 运行。manifest 为 `asInvoker`。

先打开原唠蒯云完成联机，退出语音频道，戴耳机。本面板只读枚举本机
`10.203.217.0/24` IPv4；不读账号、社区密码或 profile，不管理 EasyTier。
填对方 ET IPv4（最多 11 个，本机加对方最多 12 人），双方共享一次性
64 位十六进制实验密钥。密钥仅保留在内存，经 helper 标准输入传递；不写
配置、命令行或日志。复制密钥会将其放入 Windows 剪贴板，剪贴板历史或
同步由系统设置决定。使用后可手动清空剪贴板。

启动面板不采集音频、不运行 helper、不创建 socket。只有点击「开始音频」
后，才启动同目录 `laokuai-native-audio.exe --stdio`。固定 UDP 39177，
Opus 32 kbps / mono、20 ms 编码块；10 ms 是设备回调块。当前设备用
Windows 默认输入/输出（helper 优先 WASAPI 共享模式），切换系统默认
设备后停止并重新开始。传输通过 ET 虚拟 IP，物理路径由 ET 决定；本面板
不推断物理直连、WebRTC 或 SFU 状态。

首次开始可能出现 Windows 防火墙提示；只针对实验 helper 的提示自行
决定是否允许。面板不自动提权、不添加规则。它只管理自己启动的 helper，
停止/关闭先发送 `mute`，再发送 `stop`，最多等待 3 秒，最后只终止该
Process 对象对应的进程。停止过程在后台执行，窗口等待其完成后关闭。

helper 标准输入是固定 9 行：版本标记、本机 IPv4、端口、逗号分隔的
`IPv4:39177` 对方列表、64hex 密钥、`duplex`、默认输入索引 `-1`、默认
输出索引 `-1`、`start`。后续命令是小写 `mute` / `unmute` / `stop`。
stdout 为 NDJSON；面板只显示白名单计数、电平与枚举状态，不显示原始输出。
收发每秒值来自累计 AoO payload 字节的实际时间差（UDP 封装包数另列）；
设备/API/声道在 helper 的 ready 确认后显示。AoO 丢包和缓冲状态未提供时显示
「未采集」，不能以 UDP 收发推断音频出声。

构建：`pwsh -File experiments/native-audio/build-launcher.ps1 -RunSelfTest`。
默认产物在 `.local/native-audio-build/Release/唠蒯云-原生语音实验.exe`。
`唠蒯云-原生语音实验.exe --self-test` 只跑纯参数/协议解析检查，无 UI、
helper、音频设备或 socket，成功退出码 0，失败退出码 1。
`--render-ui <绝对PNG路径>` 隐藏创建面板并输出布局截图，不启动 helper，
不枚举设备或网络；仅供本地界面检查，不代表真实音频验收。

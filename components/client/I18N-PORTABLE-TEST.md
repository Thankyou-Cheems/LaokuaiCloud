# 老蒯聊汉化测试便携包

此文件只属于本地测试包提交，不进入通用上游 i18n PR。Gryt 的原有版权、
AGPL-3.0-or-later 许可及第三方许可证继续保留。名称是测试发行标识；界面内
仍保留 Gryt 的部分标识。本轮没有私有服务器预设、部署、音频响度功能或身份迁移。

包名：`LaoKuai-Chat-1.13.22-zh-CN-win-x64-slim-portable-test.exe`。
仅 Windows x64，unsigned，slim，无内置 server/SFU/worker，无 presence helper。
保留已有语音与原生捕获代码，但不代表真实通话、设备、PTT 或屏幕捕获已经验收。
系统签名策略可能阻止 unsigned 测试包；本任务没有运行它，也没有修改系统策略。

appId 为 `local.laokuai.chat.i18n-test`。在任何启动日志和身份存储初始化之前，
userData 被设置为便携 EXE 所在目录下的 `laokuai-chat-i18n-test-data`，sessionData
位于其中的 `sessions`。无 portable 包装器时使用解包 EXE 自己的目录。路径不可写
时启动失败，不回退到原版目录。没有读取、复制或迁移原版身份。

自动更新、手动更新下载/安装、旧安装备份清理、原版 `gryt://` 注册、在线登录
外部回调、OS 开机启动和共享 presence socket/helper 在此测试包中禁用。
本地游客身份可供后续测试；在线账户登录应使用原版客户端。源中的一般 OIDC
实现未删除，但本包不注册或发起可能回到原版客户端的登录回调。

默认语言跟随系统，支持英文与简体中文。可在设置 → 外观 → 显示中选择语言。
词典为 506 对键；管理、恢复/配对、安全、私信通话特定弹窗、部分设备设置和
`@gryt/ui` 内部文案等仍有英文，完整缺口见 `I18N-DEVELOPMENT.md`。

相应 client 源码、固定 UI 研究版本、实际 npm UI source-map 源码补充、Yarn
锁文件、依赖清单、原生 C++ 源码、许可证和构建证据与 EXE 同目录交付。
实际 UI npm 内容有一份 MemberCardEditor 源码不同于研究 pin，补充包保留发布内容，
没有把研究 pin 冒充为该 npm 包全部文件的确切源码。

构建使用 `scripts/build-i18n-portable.ps1`。已有 Node/Yarn 和 Visual Studio C++
工具链是前提；脚本仅后台 CLI 构建，打包进程限制两核、低优先级，无 publish。
`scripts/check-i18n-test-package.mjs` 通过 mock 与静态检查验证隔离，不加载 Electron。
不得为了当前验收启动 EXE、媒体采集、原生输入钩子或导入真实 profile。

AI assistance: Codex. Native helper source is unchanged from the pinned Gryt client.

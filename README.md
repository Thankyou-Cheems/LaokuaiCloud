# 唠蒯云

把 Gryt Chat 多人语音和 EasyTier 2.7 社区联机整合成简单的 Windows 体验。

目标：首次添加 `voice.ruikang.wang` 输入一次社区密码，保存成员身份；以后
恢复社区即自动联机。语音优先 P2P，异常恢复 SFU。腾讯云 ET 与 Gryt/SFU
分开部署，ET 故障不阻断社区认证和 SFU 语音。

当前测试版由主进程统一恢复成员身份和自动联机；首次本机授权随社区恢复
自动出现，不依赖语音房或额外开关。Windows 权限通过按需 UAC 小组件取得，
聊天窗口保持普通权限。同一次运行中的重连复用权限，退出后停止自己的实例。
不安装后台服务，因此每次启动联机仍可能出现一次 Windows 系统确认。

自动入网的纯行为测试、应用类型检查和编译已通过；新的真实 UAC/TUN、
双设备完整客户端与语音回退验收尚未完成，不把旧受控试验算作新版本通过。
2026-10-13 便携测试包已构建并通过静态及隐藏离线启动检查，精确证据见
[测试包回执](release/acceptance/autojoin-portable-20261013.json)。

- 开发入口：[HANDOFF.md](HANDOFF.md)
- 当前审视、证据和优先级：[项目审视](docs/PROJECT-REVIEW.md)
- 精确来源和冻结产物：[release/manifest.json](release/manifest.json)
- 组件：`components/client`、`voice`、`server`、`sfu`、`easytier`、`landing`
- PowerShell 7 本地环境：`. ./tools/enter-local-dev.ps1`
- 根目录轻量检查：`./tools/check-core-contracts.ps1`
- 轻量绿色包构建：`./tools/build-portable.ps1`（需要已核验的原生/许可材料）
- 源码分开托管说明：[SOURCE-ACCESS.md](docs/SOURCE-ACCESS.md)

用户已批准将本仓库本身公开；分支历史已移除 Npcap，GitHub 仍保留旧 SHA
可达的 DLL 对象，故当前保持私有。六份对应源码附件已放在同仓库 Release；
公开访问尚未完成，详见 [历史清理记录](docs/history/2026-10-13-public-cleanup/README.md)。
测试包只携带许可证、必要声明和源码取得说明，完整源码不随包携带。
历史交接在 `docs/history/`。

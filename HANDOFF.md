# 当前开发交接

更新：2026-10-13。唯一开发目录 `D:\Dev\LaokuaiCloud`，分支 `main`。
最新可交付及桌面绿色测试包为 `1.13.22-laokuai.beta.20261013.12`；易记 MagicDNS
已部署，用户确认短域名显示，本机直接解析和 Windows 系统解析均匹配虚拟 IP。
生产成员中继两端开关已开启；真实多设备转发、游戏和 12 人 WAN 语音仍未验收。

## 当前包与源码

- 文件：`唠蒯云-1.13.22-laokuai.beta.20261013.12-zh-CN-win-x64-green.zip`。
- 应用源码：`942f1a8a2173b43d2b05902aaa7503fe54c4b9aa`。
- 大小：161048733 B；SHA256：
  `4a0ce3c89abd41da1bfc257df0e1c70b90a872b3a9f399e92ae840da41280640`。
- 交付目录：`.local/artifacts/autojoin-test-20261013/`。
- 精确版本、来源、许可证及对应源码以 [release/manifest.json](release/manifest.json)
  和 [包回执](release/acceptance/voice-stability12-portable-20261013.json) 为准。
  包不内嵌源码归档，SOURCE-OFFER 指向精确应用提交及 1263 项源码更新清单；
  旧六份对应源码附件保留。

首次通过社区密码或管理员创建的有效免密码普通成员邀请取得身份，之后恢复
社区自动加入 ET，不依赖语音房或额外联机开关。语音优先经媒体验证的 P2P，
失败恢复 SFU；ET 故障不应阻断社区认证和 SFU。应用须以管理员权限启动，
非管理员启动可主动选择正常 UAC 重启，不自动提权、不安装持久服务。
联机偏好保存后下次启动生效；侧栏语音、音频、
联机和常规设置入口及七项白名单偏好导入导出已包含在 .7。

## 当前生产状态与回退

Gryt 源码 `5eed3757e74f76099a7f2991a6c4c9c38fbe462a`，镜像
`sha256:34cde4c1b3744568269bed640feec49706329da0ec8d1fb85a9feb1c8dea1425`。
易记域名部署见 [回执](release/acceptance/friendly-dns-deployment-20261013.json)：
仅 Gryt 重启；环境、端口、挂载、12人限制及中继开关保持，SFU/ET/代理未变。
回退基线是已支持 V2 的 fe151bbd 镜像，操作器在 `release/deployment/friendly-dns/`。
邀请与 DNS 目录已部署；`LAOKUAI_MEMBER_RELAY_POLICY_V2=1`。
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

- `/opt/stacks/gryt/friendly-dns-20261013-r1/activation.overlay.json`。
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

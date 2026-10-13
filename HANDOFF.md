# 当前开发交接

更新：2026-10-13。唯一开发目录 `D:\Dev\LaokuaiCloud`，分支 `main`。
当前绿色测试包为 `1.13.22-laokuai.beta.20261013.7`；邀请、MagicDNS 与实验性
成员中继源码已接线，生产成员中继两端开关已获批准开启。真实多设备转发、
系统 DNS、游戏和 12 人 WAN 语音仍未验收。

## 当前包与源码

- 文件：`唠蒯云-1.13.22-laokuai.beta.20261013.7-zh-CN-win-x64-green.zip`。
- 应用源码：`c76a75dd20389b059294435922abb806b68b33e4`。
- 大小：159058859 B；SHA256：
  `6093ba84620947e63be2a4aaac1b0e9065f8ebd8808a895be435c220786a8d61`。
- 交付目录：`.local/artifacts/autojoin-test-20261013/`。
- 精确版本、来源、许可证及对应源码以 [release/manifest.json](release/manifest.json)
  和 [包回执](release/acceptance/community-network-v2-portable-20261013.json) 为准。
  包不内嵌源码归档，SOURCE-OFFER 指向精确应用提交及 1263 项源码更新清单；
  旧六份对应源码附件保留。

首次通过社区密码或管理员创建的有效免密码普通成员邀请取得身份，之后恢复
社区自动加入 ET，不依赖语音房或额外联机开关。语音优先经媒体验证的 P2P，
失败恢复 SFU；ET 故障不应阻断社区认证和 SFU。应用须以管理员权限启动，
不自动提权、不安装持久服务。联机偏好保存后下次启动生效；侧栏语音、音频、
联机和常规设置入口及七项白名单偏好导入导出已包含在 .7。

## 当前生产状态与回退

Gryt 源码 `10b76471abb043709c9dc1fd321e845258976213`，镜像
`sha256:fe151bbd8361bc492d74c9349610aad1e25c382fe11d850f49d7674fd242f590`。
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

.7 的 31 组核心检查、另 23 项生产运行时契约、类型/lint、152 文件 ZIP 核验和
真实隐藏离线新配置启动/退出通过。退出0、无自有残留，三次采样无自有 TCP/UDP；
保留23条已有离线/禁用IPC错误。新原生 core/CLI 已编译；本轮包验收未运行
ET/TUN、NRPT或设备媒体。后端健康与只读 issuer 验证不等于产品链路验收。

下一步用 .7 验证首次准入、普通重启后的自动联机、两设备域名/IP与游戏连通、
主动中继同意/额度/关闭收敛，以及实际双设备 P2P→SFU 回退和 12 个完整客户端
WAN 语音。区分 ET 路径、WebRTC 媒体路径与物理直连；未知保持未知。
当前审视入口为 [docs/PROJECT-REVIEW.md](docs/PROJECT-REVIEW.md)，设置说明为
[联机与快捷设置](docs/COMMUNITY-NETWORK-SETTINGS-20261013.md)。

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

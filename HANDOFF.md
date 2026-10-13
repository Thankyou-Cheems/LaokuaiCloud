# 当前开发交接

更新：2026-10-13，用户要求恢复本地审视、纠偏、架构改进与历史清理。
唯一开发入口 `D:\Dev\LaokuaiCloud`；分支 `main`。
最新用户目标：本应用还替代 EasyTier Game；腾讯云标称 6 Mbps、实际更低，
至少 12 人单频道语音，语音故障不能退出社区虚拟局域网。已授权并行实施、
源码同步与新绿色测试包。当前 .4 源码整合中，未交付前不要把它写成 WAN 通过。
决定和历史 20 席/公共 ET 证据边界见 `docs/VOICE-DISTRIBUTION-REVIEW-20261013.md`
顶部最新决定；旧 4×5/2×10 是 2 SDK + 18 RTP 回放端，保留其成功结果。
服务端增量已部署：SFU 源 35bcd5d3、image585f0a76；server 镜像保持9ddd8f97，
仅 VOICE_MAX_USERS=12。SFU MAX_PEERS=12，麦克风接收配置16 kbps/60 ms。
两服务 healthy、外部 /health=200、ports/network/mounts 对比不变，未重启 ET。
见 `release/acceptance/voice-budget-deployment-20261013.json`。后续 Compose 必须
保留 `/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json`；回滚材料
同目录保留，完整私有 Compose 快照只在服务器，不导出。
审视原基点 `7ba93a038bd37f0c99f13fdfd6c608ca9bec750c`；因移除 Npcap 历史已
重写，映射见 `docs/history/2026-10-13-public-cleanup/commit-map.txt`。实时状态
用 `git status` 和 `git log -1` 查看。清理后的 main 已推送为远端唯一分支。

## 目标与缺口

首次社区密码取得普通成员身份；之后恢复社区自动 ET，不等进语音房、不重复
密码、不另找开关。语音沿用 P2P 优先/SFU 恢复；腾讯云 ET 与 Gryt/SFU
独立部署，保留 dots 已部署成果。

本轮已新增主进程 CommunityEnrollment，合并 membership/auth/授权/lease 顺序；
renderer 只提交成员快照。按需 UAC helper 固定载荷、发行者和受限配置；
普通 UI 不提权，同次应用运行重连复用 helper，无持久服务。Enrollment 13 个
和 grant/runtime 52 个行为检查通过，含退出后重新认证、退避重连及拒绝授权后
不重复弹窗；十组核心契约、类型、定向 lint 和应用编译通过。新真实 UAC/TUN/
双设备待验。
用户随后明确授权代设共享密码，已按服务端 scrypt 格式保存并验证；明文未落盘、
未进入仓库。用户又要求不保留原成员准入，已撤销全部旧准入和登录凭据，
保留管理员归属供后续管理。此前“共享密码未设置”记录仅为历史状态。

当前审视和验收顺序见 `docs/PROJECT-REVIEW.md`。下一项验收是测试包的真实
社区自动联机及两设备语音。新增持久提权服务仍须就安装、IPC、
退出和卸载范围单独批准；不扩展新的 ET 控制面。

## 环境和证据

- PowerShell 7、UTF-8 无 BOM；`.local/toolchains/node24` 和 `yarn-classic`。
- `tools/enter-local-dev.ps1` 仅准备当前终端，不启动应用。
- `tools/check-core-contracts.ps1` 跑已有纯契约和定向类型检查，不运行
  Electron/core/TUN/设备媒体，不代表自动入网验收。
- `.local/materials/` 保存对应源码/运行时来源；`.local/artifacts/friend-beta/`
  保存冻结 98 MB 包及证据。真实 profile、密码、token 不作为开发输入。
- 已有隔离 SDK 媒体/回退、后端 RTP、隐藏离线 bootstrap 证据。普通启动
  自动 ET、真实双设备/WAN/物理语音直连仍未验收，详见审视表。

现包 `唠蒯云-1.13.22-laokuai.beta.20261012.1-zh-CN-win-x64-portable.exe`：
97,846,494 B，SHA256 `43a630df55d965048632f9bd13b3febeb357419f3d9ea49b28ca5f4330b98ade`。
源 `2526db90`、编译基点 `a5c557be`。保留旧包；新版本为
`1.13.22-laokuai.beta.20261013.1` 已完成，源
`800ec22e484d2fef2b23493492b75862d9ed62f0`，129,281,373 B（约 123 MiB），
SHA256 `d6669238f04439f316e586cdfb7492698f1edd1e0fdf05546b67505da5c20737`。
交付于 `.local/artifacts/autojoin-test-20261013/`，含测试说明和哈希。
精确便携包解出 146 文件通过静态核对，未含 Npcap 或完整对应源码归档；真实
隐藏离线新配置启动/DOM/退出通过，八次自有端口采样为零、退出残留零。
保留 23 条控制台错误：20 条离线 CSP/fetch 拦截、3 条已有禁用 IPC Promise。
这不接受真实 UAC/TUN/双设备媒体；明细在
`release/acceptance/autojoin-portable-20261013.json`。
不关闭用户当前客户端。
原运行绝对路径和详细来源见 `docs/history/2026-10-13-takeover/HANDOFF.md`。

## Git 与清理

origin 为 `https://github.com/Thankyou-Cheems/LaokuaiCloud.git`，现为 PUBLIC。
用户在 2026-10-13 明确批准删除旧 GitHub 仓库并同名重建，解决旧 SHA 可取回
已删除 Packet.dll 的残留。旧 ID `R_kgDOVEfFVQ`，新 ID `R_kgDOVG00Lg`。
清理后的 main 已推送并设为默认；源码标签和六份附件已重新上传同名仓库。
附件大小/SHA256 与原材料匹配；没有上传应用二进制。旧支持请求草稿不再需要
提交，未发送。重建前 Git/metadata 备份在
`.local/review-20261013/github-recreation/`；旧的两个恢复 bundle 仍保留。
`cb209bd` 的 8 文件已等价合入，不重复 cherry-pick。

本轮完整 bundle 校验后移除 D 盘 4 条历史分支，仅保留当前开发分支；移除
C 盘 3 个无修改且无忽略文件的 feature worktree。恢复 bundle、原 refs、
操作回执在 `.local/review-20261013/`。C 盘旧主仓库及带构建材料的恢复树保留。
更广迁移有 3 组不完整历史和 56 个有修改的目录，未纳入删除；见 `.local/migration/`。

用户已恢复开发、打包、push 与现有 LaokuaiCloud 本身公开。公开前核查完整
历史及源码获取材料；生产部署与持久服务安装不在本轮操作中。原交接/AGENTS 原文
完整保存在 `docs/history/2026-10-13-takeover/`，旧一次性许可不复用。

用户允许联机/UAC 后仍出现异常，本轮定位到服务端管理代理：systemd 保留运行
目录和 socket，旧程序遇到任何已有 socket 都拒绝启动。成员 session 成功，
acquire 返回 503，实际只读 issuer RPC 返回 rpc-unavailable。Linux 临时 socket
重启夹具稳定复现。现行代理源码位于 `components/server/ops/community-et-management/`，
增加独占锁、仅回收已拒绝连接的同属主 socket、保留目录 inode/续期账本及有界重启。
已部署，8 项回归、真实代理重启/RPC、实际凭据签发→客户端校验/配置→撤销均通过。
客户端完整协调器 503→自动恢复回归通过，无产品源码修改，无需换包。
见 `release/acceptance/community-management-recovery-20261013.json`。用户重新打开、
手动重试均仍失败，无新的 UAC 提示；服务端修复不等于整条自动入网已修好。

继续定位到 Windows helper 的双向命名管道：同步 client handle 在等待命令的
ReadLine 期间堵住 STARTED/STOPPED/FINISHED 回传。真实 Windows 无提权夹具
复现旧同步模式失败；实际生产 pipe 工厂改为 Asynchronous 后，启动状态、
停止 ACK、三次复用均通过。没有改变 UAC、ACL、PID 检查或固定 ET 载荷。
回归入口 `components/client/scripts/check-community-broker-pipe.ps1`，不运行
ET/驱动、不请求 UAC。新版 20261013.2 已交付到同一测试目录，源 6eca1772，
129,281,381 B，SHA256 `7c9893bfa441a65c682a332c0978b791abf9c0977956bcff2143143a2040912a`。
十组契约、应用编译、146 文件解包校验及真实隐藏离线启动/退出通过；23 条已知
离线/禁用 IPC 控制台错误保留，三次自有端口采样为零且退出无残留。
见 `release/acceptance/broker-repair-portable-20261013.json`；真实 UAC/TUN 仍待新版验证，
双设备语音未验收。用户询问免提示入网：当前绿色方案每次应用启动首次入网
需正常 UAC，同次运行复用；持久服务方案尚未获批，不能安装。

用户测试 .2 后社区显示已连接，成员自身状态却灰绿闪烁。只读确认相同自有
core 持续运行，10 次限定实例 route RPC 经生产解析均成功且 peer/IP 不变，
对应 /24 虚拟 IPv4 在系统中为 Preferred；只有本机/服务器路径，未验收双设备。
闪烁源于 renderer 用上一秒缓存时钟拒绝新样本为“未来”。现改为每次 render
读取本地时间，固定间隔仅触发过期重绘；不以样本时间推进时钟、不放松校验。
旧 hook 在首次新样本渲染回归中失败，新 hook 通过未来时间、连续更新与停更
过期检查。见 `release/acceptance/member-status-clock-20261013.json`。
局域网发现是独立 mDNS；本机成员路径/RTT 不适用，未知不等于断线。
新版 20261013.3 已交付到相同测试目录，源 dd16e768，129,286,828 B，
SHA256 `9e39a02a70ca68ed47b98bdc7aa7d264ad24082ff8298ab50e9f0d98322a28bd`。
146 文件静态解包及隐藏离线启动/退出通过，仍保留 23 条离线/禁用 IPC 错误，
三次自有端口采样为零、退出残留零。详见
`release/acceptance/member-status-portable-20261013.json`；实际 UI 闪烁消除待用户
换包确认，不将 .2 的本机入网观察扩展成 .3 或双设备媒体验收。
旧包与用户当前配置/运行实例保留。

用户现已确认 .3 不再闪烁；新问题是本机条目错误展示远端未知字段，以及托盘
退出时窗口等待几秒（桌面正常）。本地已修复本机详情和立即关闭自有 UI、后台
等待两个有界 cleanup drain；真实新包托盘时延待测。记录在
`release/acceptance/self-details-and-quit-20261013.json`，尚未生成 .4 包。

用户随后要求重新审视完整语音分发。当前结论和下一轮顺序见
`docs/VOICE-DISTRIBUTION-REVIEW-20261013.md`。实际 vendor SDK 与源码关键
选择逻辑一致：收到 peer 媒体就可切换，未门控 TURN/ET 中继，也未按质量重选；
ET 入网与媒体选中 ICE 没有关联。SFU ACK/租约恢复正确成果和旧真实隔离媒体
证据保留，完整双设备 WAN 未验收。线上只读白名单确认 Hybrid 开启且当前 6
人限制，未改变生产配置。18 项统一检查全通过（含 Windows 无提权 pipe fixture）；
优先完成路径分类与选择，再决定下一包范围，不把 UI 文案修复当作选路已修好。

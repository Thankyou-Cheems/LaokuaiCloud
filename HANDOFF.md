# 当前开发交接

更新：2026-10-13，用户要求恢复本地审视、纠偏、架构改进与历史清理。
唯一开发入口 `D:\Dev\LaokuaiCloud`；分支 `main`。
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
ET/驱动、不请求 UAC。新版 20261013.2 正在打包；真实 UAC/TUN 仍待新版验证，
双设备语音未验收。用户询问免提示入网：当前绿色方案每次应用启动首次入网
需正常 UAC，同次运行复用；持久服务方案尚未获批，不能安装。

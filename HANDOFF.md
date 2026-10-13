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
此前只读记录（非本轮实时查询）显示旧 profile 授权过期、后端
共享密码未设置。密码须由主人在真实安全 UI 配置，不能写入仓库。

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

origin 为 `https://github.com/Thankyou-Cheems/LaokuaiCloud.git`；最近交接记录
为 PRIVATE，本轮已重新确认；main 已推送并设为默认。尚未切换可见性：GitHub
仍能通过旧提交 SHA 返回已从历史清除的 Packet.dll，详见公开清理记录。
原仓库 ID `R_kgDOVEfFVQ` 保持不变。六份源码附件已上传同仓库的
`source-materials-20261013` Release，GitHub 返回的大小/SHA256 全部匹配。
现有 tag 指向清理后的提交；没有上传应用二进制。支持请求草稿在
`.local/review-20261013/github-cleanup-request.md`，尚未对外发送。
`cb209bd` 的 8 文件已等价合入，不重复 cherry-pick。

本轮完整 bundle 校验后移除 D 盘 4 条历史分支，仅保留当前开发分支；移除
C 盘 3 个无修改且无忽略文件的 feature worktree。恢复 bundle、原 refs、
操作回执在 `.local/review-20261013/`。C 盘旧主仓库及带构建材料的恢复树保留。
更广迁移有 3 组不完整历史和 56 个有修改的目录，未纳入删除；见 `.local/migration/`。

用户已恢复开发、打包、push 与现有 LaokuaiCloud 本身公开。公开前核查完整
历史及源码获取材料；生产部署与持久服务安装不在本轮操作中。原交接/AGENTS 原文
完整保存在 `docs/history/2026-10-13-takeover/`，旧一次性许可不复用。

# 当前开发交接

2026-10-13 新版固定目录绿色包 .7 已完成，精确应用源码
`c76a75dd20389b059294435922abb806b68b33e4`，159058859 B，SHA256
`6093ba84620947e63be2a4aaac1b0e9065f8ebd8808a895be435c220786a8d61`。
交付目录 `.local/artifacts/autojoin-test-20261013/`；31组核心检查、另23项生产
运行时契约、类型/lint、152文件ZIP核验和真实隐藏离线新配置启动退出通过。
退出0、无自有残留，三次采样无自有TCP/UDP；保留23条已有离线/禁用IPC错误。
侧栏联机/语音/音频设置、七项偏好导入导出、限时限次可撤销免密码邀请、
MagicDNS已接线；移除赞助入口，保留Gryt作者及许可证。
新原生源10b76471/tree381c14c5已编译，core d1634bf0/CLI1638d7f1，未运行ET/TUN。
成员中继客户端和原生短租约/预算已实现，默认关闭，线上后端与代理开关仍关闭。
邀请/DNS后端部署见下条，不能把本次后端更新当作成员中继启用授权。
真实系统DNS、防火墙、双设备游戏/中继和12完整客户端WAN语音仍待测试。
SOURCE-OFFER指向本仓库精确应用提交及1263首选源码更新清单，旧六份源码附件
保留，源码不随绿色包携带。回执 `release/acceptance/community-network-v2-portable-20261013.json`。
旧包/失败证据不改写；下方“开发中/需新核心”描述保留为过程记录。

2026-10-13 本轮用户明确批准“现在更新 Gryt 后端”：已部署源码10b76471，
Gryt image fe151bbd，健康及公网health200；未认证directory/relay-status均401。
新增邀请和MagicDNS目录源已上线，成员中继两端开关仍关闭。仅替换server镜像，
成员/聊天/配置/端口/挂载/12人上限保留，SFU、ET和管理代理未重启或改动。
后续Compose须保留 `/opt/stacks/gryt/community-network-v2-20261013-r1/activation.overlay.json`
及此前全部overlay。旧镜像保留可回滚，私有现场配置仅在服务器。
见 `release/acceptance/community-network-v2-deployment-20261013.json`。

2026-10-13 最新用户恢复正式整合，明确“直接推翻打新包”，新增侧栏语音、音频、
联机和设置快捷入口，并移除唠蒯云赞助页面（上游作者/许可证保留）。本轮邀请
支持管理员限时、限次、撤销的免密码普通成员准入；旧邀请不自动升级。
MagicDNS 已从离线模型进入认证目录、主进程解析器、Windows 后缀规则和成员复制
的源码接线。联机设置可导入/导出七项白名单偏好，保存后重启生效，不导出身份、
密码、设备密钥、真实 IP 或本机路径。成员中继正在实现独立资格、限额、短本机
租约及热撤回；需新核心，不以旧 core 冒称支持。当前工作树为开发中状态，构建/
部署状态以本轮最终回执为准；下方“.6 不动/只做实验”是上一阶段历史要求。
客户端尚未修改系统 DNS/当前用户配置、未启动 ET/TUN；旧产物保留。后端随后
经用户明确批准已更新，以上方回执为准。

2026-10-13 后续用户要求先测 .6，MagicDNS/成员互助中继独立预研发。
离线模型位于 `experiments/community-network/`，生产没有引用；不得默认开启或
合入当前测试包。参照基点65432f4f，详见该目录README与只读隔离检查脚本。
17 DNS＋15 relay共32项通过；成员中继不依赖音频解码或加入语音房。生产目录
相对基点无变动，原交付路径当前已无 .6 ZIP，本轮没有重建/搬动或复核其字节。
用户随后明确要求重置 voice.ruikang.wang 历史/成员，并确认指定账号成为新的
社区所有者、移除原所有者。已完成服务器私有备份、离线事务清空及权限迁移：
重置瞬间用户1、owner角色1、消息0、旧刷新令牌/MLS/ET分配和租约记录0；
真实issuer撤销1条旧成员凭据并回读，其他凭据保留。保留4频道、社区设置和共享
密码；移除用户上传资料，旧数据仅保留服务器私有回滚备份。server原容器/镜像
347936c2停止后启动，健康；公网health200，SFU/ET均未重启。目标owner与零其他
成员、零消息已独立回读。操作材料仅在 `.local/community-reset-20261013/`，
原始数据/账号映射未导入仓库；服务器备份 `/opt/stacks/gryt/community-reset-20261013/`。
此重置不改变 .6 包、DNS、成员中继或密码准入策略。用户询问免密码邀请：
已说明当前版不支持绕过密码，候选为可撤销/有期限/限次数的普通成员邀请，尚未实施。

2026-10-13 最新：固定目录 ZIP 绿色测试包 .6 已交付，源
`49f774b64f2535336f8a8e0f8ee3a50decd704a5`，159015382 B，SHA256
`77614061c4ab8566f61e541f6b4fefd9127fc75a85f3fd30ed6cbe540f2c7ef7`。
目录 `.local/artifacts/autojoin-test-20261013/`。管理员启动通过现有 helper COM
幂等准备本体/实际 ET cache core 两项程序规则；托盘清理先 drain，再只删账本+
随机归属标记+完整属性吻合的规则，保留系统提示旧规则与第三方规则，不安装服务。
唠蒯云取消 Gryt mDNS 发现入口与扫描，保留游戏 ET；成员行可点击复制认证虚拟 IP，
同账号多设备逐个显示；仅分配的地址不冒称已入网。MagicDNS/成员互助中继未开启。
SDK routing.2 新增实际自动门观测，默认自动门/RNNoise/接收平衡开，发送AGC/压缩关，
保留用户偏好；个人音量在均衡后，不被补回，仍有峰值限幅。详情见本轮两份 docs。
25组核心、runtime58、成员16、后端50、编译、152文件精确ZIP、隐藏离线新配置
启动退出通过，仍保留23条既有离线/禁用IPC错误。未真实改防火墙/录音/运行ET/TUN，
真实管理员弹窗抑制、双设备IP复制/游戏及12完整客户端仍待用户测试。
见 `release/acceptance/green-package-portable-20261013.json`，旧 .5 包保持原样。

用户明确批准后端目录立即更新：现 Gryt image347936c2（源同49f774b6），健康，
公开health200/未认证directory401；环境、端口、挂载不变，SFU未重启、ET未触碰。
前两次严格比较误将环境/挂载排序当漂移，均自动回滚，失败和私有证据保留；
修正后-r3完成。后续Compose必须保留
`/opt/stacks/gryt/member-address-directory-20261013-r3/activation.overlay.json` 及既有
`sfu-12-fallback-16k60/activation.overlay.json`。原始r3 activated回执的runtimeStarted
继承了build false字段，实际新容器healthy；后续生成器已改，不改写原始记录。
见 `release/acceptance/member-address-directory-deployment-20261013.json`。

2026-10-13 后续：用户报告 .4 无 UAC 且联机失败，随后明确改为整个 Windows 应用必须管理员启动。
新 .5 源码在任何 profile/主窗口启动前只读检查当前 token；普通权限提示右键管理员运行并退出，
不自动提权。生产 ET 改走直接自有子进程，不再构造按需 UAC broker；helper 仅用于 `--check`。
首次已保存成员自动准备固定社区策略，保留 issuer/ACL 校验与独立 ET 生命周期。
临时状态读取失败进入自动恢复；本轮 24 组核心检查、构建、146文件精确包校验、隐藏离线新配置启动/退出通过。
纯管理员 .5 已交付 `.local/artifacts/autojoin-test-20261013/`，源 `0f46b26f307303b3ab0520f4a78f7044d9550eba`，
129291070 B，SHA256 `f654ed2c3c3012c45df99138d9887d75ecfe4665d442bcc86d139f80623d1ddb`。
见 `release/acceptance/admin-startup-portable-20261013.json`。真实包内 helper 普通 token 被源级门禁正确拒绝，
隐藏启动仍保留23条既有离线/禁用IPC错误；本轮无真实管理员应用入网、ET/TUN或设备媒体运行。
用户先测此包；成员中继明确单列预研发，未进入 .5，服务端和 .4 语音/带宽参数均未变。
.4 的现场成员 session、资产和保存策略探针通过，但原完整失败原因尚未得到端到端复现，不能改写为已验收。
用户同时要求结合 dots 既有默认选项强化去中心中继；已找回旧默认审计并核对当前配置。
见 `docs/NETWORK-DEFAULTS-AND-MEMBER-RELAY-20261013.md`：当前成员 allowRelay=false，尚无互助中继；
foreign relay whitelist 与同网凭据中继权限不同。后续中继设计不冒充本 .5 已启用功能。

更新：2026-10-13，用户要求恢复本地审视、纠偏、架构改进与历史清理。
唯一开发入口 `D:\Dev\LaokuaiCloud`；分支 `main`。
最新用户目标：本应用还替代 EasyTier Game；腾讯云标称 6 Mbps、实际更低，
至少 12 人单频道语音，语音故障不能退出社区虚拟局域网。已授权并行实施、
源码同步与新绿色测试包。最新 .4 已构建交付到
`.local/artifacts/autojoin-test-20261013/`，源 `56aed78e004d137ac606e5e7d3bbc220ee5d87bc`，
129,285,343 B，SHA256 `065935af6294b37f15509e8e6110c6c6964b158394a7602cfd49aca98846088b`。
见 `release/acceptance/voice-routing-portable-20261013.json`：22 项核心检查、编译、
146 文件精确解包及真实隐藏离线新配置启动/退出通过，仍保留23条已有离线/
禁用 IPC 控制台错误，三次自有端口采样零、退出残留零。旧包与用户 profile 保留。
这不等于双设备 WAN、12 个完整客户端、真实托盘时延或游戏共存通过。
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
`release/acceptance/self-details-and-quit-20261013.json`；该源级修复现已包含在顶部 .4 包中。

用户随后要求重新审视完整语音分发。修改前快照及最新决定见
`docs/VOICE-DISTRIBUTION-REVIEW-20261013.md`。审视当时 vendor SDK 与源码关键
选择逻辑一致：收到 peer 媒体就可切换，未门控 TURN/ET 中继，也未按质量重选；
ET 入网与媒体选中 ICE 没有关联。SFU ACK/租约恢复正确成果和旧真实隔离媒体
证据保留，完整双设备 WAN 未验收。最初只读白名单确认 Hybrid 开启和6人限制。
后续已实施路径准入、持续退避、pair 信令序号修复、真实接收路径 UI、ET 2.7
默认字段修复及12人低带宽配置，详见顶部当前结果；不把 UI 文案当作实测物理路径。

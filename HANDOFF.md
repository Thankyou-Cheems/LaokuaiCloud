# 唠蒯云本地开发接管

更新时间：2026-10-13。用户要求停止自动开发、打包和公开，先交回本地开发。本文件是当前接管说明；较早 release 文档是历史检查点，不应覆盖这里的最新已知问题。

## 唯一接管入口

目录：`D:\Dev\LaokuaiCloud`

分支：`integration/lifecycle3-20261012`

origin：`https://github.com/Thankyou-Cheems/LaokuaiCloud.git`

迁移前已保存接管检查点：`47b3a974e442725fdb88c039e044aa06aa62c171`。文档所在提交即本次最终接管 HEAD，可用 `git log -1 --format=%H` 获取，避免在提交内写自引用 SHA。

2026-10-13 已成功执行 `git fetch origin`，没有 pull/merge/reset/clean/force push。远端状态：

- 默认分支 `origin/release/integration-20261011`：`3a6c794fe6e904ad195fafcd70a8a51d65632b60`。
- 另一远端分支 `origin/fix/dots-experience-20261012`：`cb209bd24fd47f2d0ff6841e5032c118678c441f`。
- 本次 D 盘交接提交前，本地比默认远端领先 44 提交、落后 0；提交本次迁移说明后领先 45。当前集成分支尚无对应远端分支/upstream。
- 对 fix 分支，提交图为本地独有 44、远端独有 1（本次迁移提交后 45/1）。该远端唯一提交的全部 8 个修改文件，本轮逐一验证 Git blob 与本地已整合的 `1574d1bcfcf9225ff4a2b9cb82429378c5c30ffd` 完全相同。保留两个历史，不重复 cherry-pick；之后本地还有已完成修复。

这意味着：本地已经取得当前远端状态，并包含更新的完成成果；不是已经把本地全部推上 GitHub。不要重新 clone 旧默认分支后误以为它是本版最新源码。

## 工作树与组件

本轮开始与提交前，5 个注册 worktree 均无 tracked/untracked 修改。接管只新增本文和根 AGENTS 的接管说明，随后提交；没有用户未提交改动被丢弃。

| 保留的 worktree | 分支 / HEAD | 当前用途 |
|---|---|---|
| D:/Dev/LaokuaiCloud | integration/lifecycle3-20261012 / 见 git log -1 | 唯一继续开发入口，独立 .git |
| task-6/laokuai-cloud-lifecycle3-integration | integration/lifecycle3-20261012 / 47b3a974 | C 盘恢复副本，已交回 D 盘，不继续开发 |
| task-6/laokuai-cloud-integration | release/integration-20261011 / 3a6c794f | 旧基线 |
| task-6/server-et-provider-work | feature/server-et-real-provider-20261012 / 4d557cb0 | 保留 owner 历史；产品接线已在集成分支后续提交处理 |
| 2026-10-12/task-4/contract-worktree | feature/easytier-pure-contract-20261012 / ab1246dc | 已整合为 20006cf1 的原交付 |
| 2026-10-12/task-4/server-adapter-worktree | feature/easytier-server-adapters-20261012 / 52f81677 | 已整合为 4d106304 等后续接线的原交付 |

这 5 个工作树没有需要另捞取的未提交必需成果。已完成 UI、pack、Voice、Server、SFU、EasyTier 成果按组件边界位于 `components/`，由 `release/manifest.json` 固定；无需把旧 task-2/task-3 或原始交付 ZIP 再覆盖过来。旧工作树/分支/归档都保留，不删除。`release/COMMUNITY-REAL-WIRING-HANDOFF.md` 和 `release/CONTRACT-SFU-CHECKPOINT.md` 记录组件合入对应关系。

外部冻结构建材料/产物有意没有导入 Git；有效材料现位于本根 `.local/`，原 C 盘历史交付目录保留为恢复副本。D 盘客户端 node_modules 已从本次冻结依赖复制并实体化：34,338 文件，923,548,773 B，外部 junction/symlink=0；Node24、Yarn Classic 位于 .local/toolchains。保持 Yarn 锁和 vendor 精确包。本次没有运行 dev、安装脚本或重建；服务端的独立开发依赖仍按自己的锁准备，不能将复制客户端依赖冒称全部组件新安装通过。

## 当前真实产品状态：自动入网尚未完成

用户目标是：首次添加 `voice.ruikang.wang` 时输入社区共享密码；成功后保存成员身份；以后启动、恢复社区即自动接入 EasyTier，不等加入语音房间，不反复输密码、不手动切联机开关。正常 UAC 必须明确主动引导，不可绕过。新增持久提权服务必须另行确认。

当前原 98 MB 包**没有达到该目标**：首次路径仍是“待本人授权/要求管理员关闭并重启，然后手动点击开启联机”。已有自动 membership/auth reconcile 不能替代首次授权和权限链。

本轮只读诊断（02:04–02:05 UTC）：

- 实际客户端 PID 17272，正确 ASAR，TokenElevation=0，非提升进程；由原 98 MB portable 启动，原管理员 profile 参数保留。
- 该 profile 的本机 activation 为旧 schema 2，expiresAtUnixMs=1，已过期。未改成永久授权，未读取凭据文件。
- 当前没有客户端拥有的 EasyTier core 子进程。本次已有社区 socket/语音 room grant 成功记录；普通社区/语音认证与本机 ET 授权是不同阶段。
- 后端只读查询：joinPolicy=password，lanOpen=false，passwordConfigured=false，ownerConfigured=true；共享密码仍尚未设置。没有读取/输出密码 hash/token/用户标识。该事实阻止新朋友密码入会，不应误称为现有管理员本机问题的唯一原因。
- 公共 ET 后端审批有效且 expires=null；本机过期测试策略与后端策略不是同一结构。

关键源码：

1. `components/client/src/components/communityLanSession.tsx`：membership/auth 自动同步；首次 native approve 只挂在 onToggle。enabled 默认 on，用户 off 偏好保留。
2. `components/client/electron/publicCommunityProvisioning.ts`：检查管理员权限后显示原生批准对话框；批准才写 schema 3、expires=null。
3. `components/client/electron/communityEtTrustedConfiguration.ts`：schema 2 过期拒绝；schema 3 持久策略也必须逐项校验。
4. `components/client/electron/communityEtGrantRuntime.ts`：先读 target policy，再验证会话/取得 bootstrap/grant，不能跳过房间/社区鉴权。
5. `components/client/electron/windowsEasyTierCliRuntime.ts` 与 `easyTierWindowsProcesses.ts`：每次启动 core 都验证当前进程管理员权限。当前无提权代理/持久服务。

一次 schema 3 批准后，在同一 profile、联机启用、认证成功、**本次进程仍具管理员权限**时已有自动连接路径；并不等于以后普通双击便能自动创建 TUN。

下一步先在本地开发环境明确状态机和首次引导，复现并验证具体缺陷。不能通过删 permission gate、默认批准或把旧测试授权强改永久来“修好”。如果选择独立按需提升 helper，每次会话仍可能出现 UAC；若要求一次安装后日常普通 UI 自动入网，则需要受限本机服务/IPC 的设计与额外安装授权。不要擅自安装服务、改防火墙、路由或私人 CheemsTier。

## 已有验证与未验收范围

已有冻结证据包括：精确依赖安装/类型及定向纯检查、Web/desktop/portable 构建；隐藏离线 bootstrap/DOM；独立生产 UI 组件 fixture；服务器/SFU 协议与实际 Opus 媒体/恢复测试；用户确认语音房间切换；一次约 328 秒受控单设备 ET/TUN 连接及清理。

这些证据各有原始范围，不应扩写：受控单设备 ET 通过不等于普通启动自动入网通过。当前实际首次密码入会、无额外手动开关的日常自动 ET、双设备 P2P、真实物理语音直连、朋友另一台机器/游戏/设备完整矩阵均未完成验收。不要把 fake-port/纯模拟的通过写为真实 native 或网络通过。

本次接管没有跑大测试，没有关闭/重启用户当前客户端，没有触发 UAC。只做 Git 状态/对象对比、产物 SHA 与只读状态核实。

## 当前可测试 EXE

绝对路径：

`C:\Users\cheb2\Documents\Codex\2026-10-11\task-6\distribution-beta-a5c557be\friend-distribution\唠蒯云-1.13.22-laokuai.beta.20261012.1-zh-CN-win-x64-portable.exe`

- 97,846,494 B；SHA256 `43a630df55d965048632f9bd13b3febeb357419f3d9ea49b28ca5f4330b98ade`。
- 对应源 `2526db9081567da13f246be801a3b4662cb38102`，实际编译代码基点 a5c557be；后续为封装/证据说明。
- 实际最终 ASAR：`715cc61c90199e3c213bc997499ff9b15e63a7363ec5294c3d015d8ec813374e`。
- 桌面“唠蒯云新版测试（20261012·原管理员）”目标已核实仍是上述 EXE，原管理员 profile 参数保留。此名称不是已具管理员提升权限的保证。本轮未改快捷方式。
- 320 MB 候选只增加内嵌对应源码，应用运行内容相同；按用户要求，候选及专用 staging 已送 Windows 回收站，不迁入新开发目录。不需要为了本次交接重打包。

## GitHub/源码公开状态

用户最新公开意图是 **LaokuaiCloud 自身**，不要污染 `gryt-client-i18n`。随后用户要求先本地接管，公开执行暂停。

2026-10-13 本轮最终查询 GitHub：`Thankyou-Cheems/LaokuaiCloud` 仍 **PRIVATE**。本轮没有 push、新建 release、上传源码或更改可见性；i18n 无写入。不能把私库根链接说成公众已经可下载本版对应源码。

公开前远端两分支全历史及拟推送 HEAD 已做模式扫描/归档展开检查（远端1676 commits、10939 blobs，新增43 commits/370 blobs）；没有命中标准私钥/GitHub token/AWS key 模式，发现的测试字面量/研究边界仍需人工分类，素材元数据和历史研究发布边界尚未完全审完。**不是已通过公开审查**。没有发现即将公开也不能跳过最后审查；发现敏感历史时不得先公开，历史重写/凭据轮换另行确认。

扫描及本次脱敏诊断保留在 `.local/migration/review-notes/`；`CURRENT-AUTOJOIN-DIAGNOSIS.md` 有更详细源码依据。它们只在本地，不应自动加入 Git 或公开。体积/许可证核实在 `.local/migration/review-notes/SIZE-SOURCE-REPORT.md`，其中旧 i18n 发布提案已被用户明确取消。


## D 盘整理结果与保全边界

这是独立 checkout，`.git` 为本目录实体目录，objects/alternates 不存在，Git 不依赖旧 C 盘 worktree。5 条原本地分支全部保留，origin 已设回真正 GitHub；从旧本地克隆产生的临时 remote 已移除。D 盘仅一个活动仓库；旧组件历史以忽略目录中的 bundle/恢复 ZIP 保存，未创建嵌套活动仓库。

- `components/`、`release/`、版本锁与既有源码历史：正常 Git 跟踪。
- `.local/materials/corresponding-source/`：本版 8 份精确源码/构建归档、管理代理源码与来源清单，逐文件 SHA 校验；第三方原始许可保留。
- `.local/materials/runtime-source-access/`：固定 Electron/Chromium/FFmpeg 源码与补丁取得说明。
- `.local/artifacts/friend-beta/`：有效 98 MB EXE 副本及冻结证据。用户当前运行的 C 盘 EXE 与快捷方式目标不变。
- `.local/toolchains/`：固定 Node24 和 Yarn Classic；`components/client/node_modules` 是实体副本。`tools/enter-local-dev.ps1` 只配置本终端路径并进入 client，不启动应用/监听或提权。
- `.local/legacy-source/`：7 个已知开发任务的松散脚本、文档、patch 等保留归档，排除重复构建树、缓存、profile、原始日志和废弃 320 MB staging。
- `.local/migration/`：完整盘点、Git refs、工作区补丁/未跟踪源码恢复包、材料 SHA 与清理清单。均被根 .gitignore 排除，禁止误当公开 source release。

更广盘点覆盖 124 个 Git 工作目录（含历史 fixture/第三方恢复 checkout），归并为 88 组 object store；85 组成功 bundle，3 组旧仓库未能生成完整 bundle（现存对象/工作源码已另存，未改原历史），已另外保存现存 Git 对象及对应工作源码快照，原件保留。不把这 3 组说成完整可恢复的上游历史。56 个历史工作目录有修改，已保留 tracked/staged patch 和可保留的未跟踪源码，不将旧试验内容覆盖到当前整合分支；必要的最新产品成果仍以本分支为准。明细在 REPOSITORIES.json、HISTORY-BUNDLES.json、WORKING-RECOVERY.json。

C 盘旧开发树作为恢复副本保留，停止继续开发；没有用 reset/clean/永久删除来腾位置。用户当前运行路径/真实管理员 profile 继续原位置；因此本次“迁移”是切换唯一开发入口并保全有效材料，不是把所有旧目录连同运行资料强行剪切。三个旧历史不完整的原件也未删除。后续若确认清理恢复副本，可依据迁移清单单独回收，不应再次将它们当开发入口。

可恢复清理仅针对用户明确指定的 320 MB 内嵌源码候选及其专用 staging；执行结果见 `.local/migration/CLEANUP.json`。若回收站操作不可用，保留原处并记录；不能永久删除。原始唯一源码/必要许可材料和 98 MB EXE 不在删除范围。

活动 client Vite/打包配置使用组件相对路径，无须把历史证据中的 C 盘路径批量替换。历史 OWNED-TUN-TRIAL 授权脚本仍是旧试验记录，不能改路径后复用为新的实际权限授权。新开发路径从本仓库 `$PSScriptRoot` 推导，不依赖旧 task 目录。

## 可直接复制给本地开发助手的提示词

> 接管本地唠蒯云开发，工作目录为 D:\Dev\LaokuaiCloud，分支 integration/lifecycle3-20261012。先读根 HANDOFF.md、AGENTS.md 和相关组件说明，核对 git status、HEAD、origin；保留所有现有成果，不 reset/clean，不重复应用远端 cb209bd（8 文件已等价整合）。本地源码比远端默认分支新，勿用旧远端覆盖。
>
> 本轮优先接管自动入网问题：目标是首次添加 voice.ruikang.wang 输入社区密码后成为持久成员，后续启动恢复社区即自动 EasyTier，不依赖语音房间，不重复密码、不要求手动切联机开关。现包仍需管理员启动和额外本机授权，没有完成目标；当前只读证据是非提升进程、旧 schema 2 授权已过期、后端共享密码尚未配置。先本地开发复现和检查状态机，再给最小修复及 dev 验证，区分纯测试与真实 native/网络验收。正常 UAC 要主动、明确引导，绝不绕过；新增持久提权服务须先提出具体安装/IPC/卸载范围并单独确认。不要代填/读取密码、token，不把旧受控328秒单设备试验当成日常自动入网通过，双设备P2P仍未验。
>
> 不打包、不公开、不 push，先完成本地开发接管；不要关闭或重启正在使用的客户端，也不要操作真实 profile、生产、私人 CheemsTier 或网络安全配置。用户之后若明确恢复公开任务，目的地只能是 LaokuaiCloud 自身，不写 i18n，先完成全部将公开历史/材料审查。交付具体代码差异、验证结果和未解决项，不把模拟结果冒称实测。

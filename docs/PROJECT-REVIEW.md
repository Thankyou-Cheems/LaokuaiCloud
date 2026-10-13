# 唠蒯云：按用户路径重新审视

日期：2026-10-13。审视源码基点 `7ba93a03`，依据本地源码、交接和固定版本
测试记录；本轮未实时查询腾讯云、用户 profile 或运行 native。本文件维护当前
结论，`release/manifest.json` 继续保存精确来源和历史产物，二者用途不同。

后续开发：用户授权恢复开发、构建测试包及公开现有仓库。已新增主进程统一
入网编排和按需 UAC 的单次应用会话组件，renderer 仅提交成员快照。新 13 项
行为检查与权限未就绪不申请凭据的检查通过；完整应用类型检查与编译通过。
真实 UAC/TUN、普通重启和双设备语音仍需新版本实测。以下问题清单保留审视
基点的发现；Windows 方案已选择绿色包按需 UAC，不安装持久服务。

公开历史扫描覆盖 1721 个可达提交和当前两个远端分支。发现 6 个 Npcap
Packet DLL/LIB，用户已批准清理相关历史。未发现真实凭据或原始 Microsoft
静态库；公开前仍需完成清理、固定源码链接和匿名下载校验。

## 结论

项目已有可复用的成员认证、设备凭据、ET 进程管理和语音回退成果；主要缺口
集中在用户生命周期的串联与 Windows 日常运行权限。继续叠加试验脚本、
打包检查点或新的 grant 抽象，不能代替首次入会和普通重启的验收。

目标是“一个客户端体验、独立后端职责”。腾讯云 EasyTier、公网管理代理、
Gryt 后端和 SFU 保持分开部署。客户端把两条生命周期连接到正确事件：

1. 添加社区 → 密码验证 → 保存普通成员身份 → 恢复成员认证。
2. 成员认证成立 → 本机运行条件/授权 → 加入 ET → 短 TTL 续租；离开社区、
   退出应用或撤销成员身份时清理。加入或离开语音房不决定 ET 生命周期。
3. 加入语音房 → SFU 先提供可用语音 → P2P 有新鲜解码证据及真实转发 ACK
   后切换 → 路径失效恢复 SFU。P2P 优先是稳定后的优先选择，不必拖延首段声音。

“社区密码一次”指正常保存身份、重启和续期不重复询问。登出、凭据丢失、成员
撤销不能自动绕过重新认证。社区密码、成员身份、设备凭据、本机系统权限是
四个不同概念，不能用同一永久密码或一个布尔开关代替。

## 按严重度排列的发现

### 1. 首次入会没有触发完整的自动联机路径

`components/client/src/packages/settings/src/hooks/useServerJoin.ts` 入会成功后
保存 token 和社区；`src/components/communityLanSession.tsx` 自动同步成员和认证，
但首次 `approveCommunity` 只在 `onToggle` 路径执行。
`electron/publicCommunityProvisioning.ts` 才检查权限和写持久本机批准。

结果：默认 `enabled=true` 只是偏好，并没有完成本机准备。用户仍得找“开启
联机”，与核心目标矛盾。现有授权函数的六个 mock 场景没有覆盖这个调用入口。

### 2. 普通启动没有可用的权限执行路径

`electron/windowsEasyTierCliRuntime.ts` 每次 connect 都检查当前 Windows
管理员身份；保存 schema 3 本机批准不能提升下次普通启动的进程。
`publicCommunityProvisioning.ts` 当前只是要求关闭并管理员重启。

此外 `communityEtGrantRuntime.ts` 在物理 runtime 权限检查前申请 grant 并写
私有配置。已有批准但本次未提权时，会先产生不必要的凭据/清理操作再失败。
应在现有 Windows runtime 内提前验证可运行条件，权限拒绝时零 acquire、零
配置写入，同时保留真正启动前的检查以防状态变化。无需为一个实现再造通用框架。

完整日常体验必须选择 Windows 运行方式：按需提升 helper 每次会话仍可能有
UAC；一次安装的受限服务才可能支持之后普通 UI 自动入网。后者涉及持久系统
变更，安装还需具体批准。本轮没有实现或安装服务，也不建议让整个聊天 UI 长期提权。

### 3. 生命周期顺序暴露给多个调用方

`communityLanSession.tsx` 用两个独立 effect 分别同步成员和认证；
`easyTierCommunityIpc.ts` 通过认证变化回调促使 manager 再 reconcile。
成员先到时可先连接失败，后到认证再补偿。这里是顺序和恢复风险，未声称每次
必然失败；当前代码有补偿。自动授权仍没有接入这条补偿路径。

建议把这些编排集中到一个社区入网 module，隐藏顺序、去重、取消和撤销细节。
现有 grant/provider、Windows runtime、IPC adapter 保留实际职责。删除测试
（deletion test）：只删转发包装不能消除状态机；真正需要集中的是散落的调用
顺序。缩小调用方需理解的 interface，提高 depth、locality 和 leverage；
测试在成员事件与状态结果的 seam 验证完整行为，而不逐个模拟内部函数。
具体 interface 留到选定候选后设计，避免先堆新层。

### 4. 语音 P2P 已有实现，但“走 ET 物理直连”没有被证明

`HybridVoiceBridge.tsx` 继承当前 SFU PC 的 ICE 配置；
`BrowserHybridPeer.ts` 创建 WebRTC PC。该路径没有指定 ET 接口或强制 ET
候选。ET 可能成为可用底层之一，源码不能保证 ICE 最终选择它。
`BrowserHybridVoiceSession.ts` 明确保留 `physicalDirectVerified: false`。

因此目前应分别报告“ET 已入网”“WebRTC 选中 P2P/SFU”“物理路径未知”。
不要把 ET 中转再称为 SFU，也不要因为 ET 成功就修改语音显示为直连。
保留当前真实解码证据、pause/resume ACK、失败恢复以及 PTT/Squad 保护链。
先用双设备验证现有 ICE 行为；没有网络证据前不重写传输或绑死 ET。

### 5. 工程环境把阶段记录当作常驻规则，已有检查失联

- 原根 AGENTS 混入大量过时 owner、禁止开发和一次性试验记录；README、
  release README、SDK 历史说明也包含已被后续成果取代的“尚未接线/构建”说法。
- CI 只存在于 `components/*/.github/workflows/`，根 `.github/workflows/`
  原先不存在；这些嵌套工作流不会作为本仓库的 Actions 入口。没有配置本仓库
  `core.hooksPath`；未审计用户全局或外部自动化，不能据此否定它们的存在。
- 重新运行已有类型检查，确认其仍匹配旧 `easyTierProduction.runtime` 字符串，
  且手写 socket 类型已遗漏真实 import/host。之前通过不代表当前仍有效。

已落实：常驻指令瘦身、原文按字节归档、统一开发入口；新增根检查脚本与根 CI，
复用已有七组契约/行为检查和一组类型检查。旧字符串判断改成对真实构造参数的
16 组合验证，renderer 直接使用项目真实类型配置，删除过时手写类型桩及临时文件。
这些是源码护栏，不是完整用户旅程测试，也尚未在 GitHub 执行。

## 已有证据能说明什么

| 用户能力 | 已有证据 | 当前结论与缺口 |
|---|---|---|
| 社区密码/普通成员 | `release/acceptance/friend-beta-2526db90/SUMMARY.json`：11 join、4 admin、8 scrypt 检查 | 处理链已有验证；后端记录 passwordConfigured=false，非本轮实时状态；真实首次朋友入会待验 |
| 本机持久批准 | 同上：6 mock consent 场景 | 授权函数可写 schema 3；未覆盖入会自动触发和下次普通进程权限 |
| ET/TUN 运行 | 原 HANDOFF 记录约 328 秒受控单设备连接与清理；其他旧 payload 也有单次试验 | 历史受控证据，不接受普通双击或双设备；不拼接不同 payload/审批范围 |
| 音质和 P2P/SFU 回退 | `sfu48-sdk3-isolated-media.json`：固定 be06217 的真实 SDK/PCM、SFU48/P2P64、cap16 | 实现有依据；隔离测试不等于当前完整客户端/WAN/真实设备 |
| 实际接收 Provider | `provider-instance-binding-real-media.json`：c3a72472，真实 selected PCM、ACK、退出清理 | 该生产 seam 已过；不扩大为完整 App 或 ET 物理路径 |
| 腾讯云部署基础 | friend beta SUMMARY 记录独立 proxy/后端部署，SFU、公网 core 未重启 | 采用记录，未本轮实时确认；不重新部署 |
| 后端 SFU 协议与 RTP | `minimal-media-d38ed22d-run3.json`：真实 RTP、pause/resume、租约恢复、TERM | 真实后端 fixture，不是完整 SDK 自动切换/设备/WAN |
| 可启动测试包 | friend beta package smoke：精确包、离线隐藏 DOM、退出残留零 | bootstrap 通过，非新用户入会或音频设备体验通过 |

本轮检查结果：前三组 node:test 共 99+24+49 项通过；ET manager 36 项、
consent 6 场景、隔离 14 场景、hybrid bootstrap VM 通过；真实 renderer 和
定向 main no-emit 类型、16 组合运行时隔离验证通过，修改的 JS 定向 lint 通过。
这些数值以本轮本地输出为准；任何真实 native/媒体验收仍保持未完成。

## 下一步按产品行为验收

1. **先统一社区入网生命周期**：首次密码成功、保存身份恢复、token 更新、
   社区删除/退出/撤销，均进入同一编排；房间切换不启停 ET。拒绝本机授权后
   不反复弹窗，给出准确状态及可主动重试入口，普通用户不用寻找开关。
2. **明确 Windows 运行方案**：具体说明按需 UAC 或持久受限服务的体验、
   安装/升级/卸载和 IPC 约束。先做可审阅设计，系统安装是单独动作。
3. **两台完整客户端验收**：首次密码入会；普通退出重启不问密码；无需进房
   已入 ET；三人语音或至少两机实际采集/播放；人为使 P2P 不可用后仍有 SFU
   声音；退出房间 ET 仍在，退出社区/应用则释放自有资源。记录版本与实际
   选择的路径，区分真实设备和合成媒体。网络扰动/启动按具体批准范围执行。
4. 完整路径通过后再考虑新包、容量和发布；避免再次用包哈希数量代替产品完成度。

## 本轮清理范围

已经移除 D 盘三条 feature 和一条旧 release 本地分支，只留当前开发分支；
C 盘三个 feature 工作树在确认 tracked/untracked/ignored 均为空后移除。
完整 `before-cleanup.bundle` 已通过 `git bundle verify`，记录完整历史及原 refs。
回执在 `.local/review-20261013/cleanup.json`，恢复示例：

```powershell
git fetch .local/review-20261013/before-cleanup.bundle refs/heads/feature/easytier-pure-contract-20261012:refs/heads/recovered-contract
```

保留 C 盘旧主仓库和包含构建材料的恢复工作树；更广迁移中有修改/历史不完整的
原件未删。保留原始许可证、源包、测试失败和冻结产物；未重写 Git 历史、未删远端
分支。归档的五份说明与修改前文件逐字节一致，旧任务分工不再是活动入口。

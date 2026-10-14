# 测试与 CI 纠偏审视

日期：2026-10-14。本记录解释测试的实际执行范围与已落实的删改，不能提升
.16 包、旧源码标签或生产语音的验收状态。真实双设备听感、ET 路径及 WAN
容量仍须对应版本的实测。

## 旧通过为什么挡不住故障

根脚本曾把 37 个入口混在一个总数中：安全解析、时钟与生命周期单元、源码
字符串/AST 判断、Fake React/Session 回放、类型检查、主题图标及 CLR helper
fixture 都累计为同一种“核心检查”。脚本末行虽写明不代表产品验收，累计数
仍无法说明哪些生产路径实际执行。

已有根 CI 含四个 SDK 检查，并非完全没有 SDK CI。但
[run 38559004682](https://github.com/Thankyou-Cheems/LaokuaiCloud/actions/runs/38559004682)
在源码 `06708268dfda7e5021e145970c913968d190f40c` 上失败：
`check-windows-firewall-rules.mjs:103` 启动
`build/community-lan-helper/laokuai-community-broker.exe --firewall-self-test`
时得到 `ENOENT`。干净 runner 没有本地构建产物，workflow 未安排构建前置。
后面的 SDK build/check step 全部 **skipped**。本地通过不覆盖这个远端失败；
后续 CI 修好，也不能追溯称旧 .16 源码的该次 CI 为绿。

媒体模型的具体盲点是 `check-hybrid.mjs` 的 Peer 替身：每次请求都返回
`observedAtMs=clock.now()`，且默认路径稳定等待为 0。它没有真实 BrowserPeer
的统计采样、缓存与等待行为，无法暴露“3 秒健康缓存被 500 ms 切换验证拒绝”
或采样周期与超时同长的问题。当前生产 Peer/controller 组合回放已经记录于
[媒体新鲜度说明](MEDIA-FRESHNESS16-20261014.md)，但旧模拟通过不构成反证。

其他缺口也有明确位置：原 CI 未跑 Gryt 的旧 pair 释放真实 handler，未跑 SFU
普通重协商与 staged offer 的真实出站 SDP 策略。初次 offer 或独立参数函数
通过，不能代表所有重新协商入口都保持 16 kbps/60 ms。

`check-hybrid-product-bootstrap.mjs` 和 `check-hybrid-readiness.mjs` 会执行生产
桥接函数，但 React、Session 和 SFU 仍是替身；保留它们的局部价值，归为
源码/VM 契约，不称完整接线或实际媒体集成。`includes`/正则判断可以发现
一处接线消失，不能证明异常顺序、资源所有权或网络协议结果。混合脚本不能
因为包含几条函数回放就整体升级证据层级。

## 实际删改

1. 删除根检查对 `easyTierElevationBroker.test.mjs` 的调用。当前生产路径
   `createWindowsEasyTierProduction` 采用直接子进程；broker 只剩 type import
   和可选构造参数，未发现生产实例化。保留历史文件，直接路径检查继续断言
   不构造该 broker；没有删除权限、IPC 信任、凭据或退出所有权约束。
2. 从默认核心入口移出五组展示检查：播报、主题、连接详情展示、图标与 i18n。
   它们有各自价值，仍可单独运行，CI 也单列执行；不再计入联机/媒体证明。
3. 根入口分成 `SourceContracts`、`Types`、`Presentation`、`WindowsFixtures`。
   默认 `Core` 运行源码/有界 VM 契约、类型和平台适用的 Windows fixture。
   每类独立报告范围，取消“总计 N 核心检查通过”的末行。非 Windows 上明确
   报告 Windows fixture 未运行。
4. Windows CI 在任何 helper self-test 前构建当前 CLR helper。构建入口只
   允许隔离 GitHub Windows runner，避免覆盖本地冻结 helper。没有为消除
   `ENOENT` 而跳过该防火墙契约。
5. CI 拆成四个无 `needs` 的独立 job。Windows helper 缺失或展示失败，不再
   让 Voice、Gryt 和 SFU 的关键回归整体被跳过。
6. Voice CI 保留正常 `npm run build`，测当前实际 dist；生产 Peer/controller
   源码 VM 组合另报范围。不用新增源码导入重映射器替代正常构建。
   删除旧模拟中“读取即更新时间戳/包数”的副作用：Peer 帧由虚拟时钟推进，
   Session 与认证恢复中的 SFU 帧显式到达。用同一场景重新引入旧缓存、探测
   超时、切换超时三种行为，均应被拒绝，防止回归用例只会在新代码上报绿。
7. Gryt CI 直接执行真实 JWT/测试数据库 handler，覆盖离开/认证失效后的 pair
   清理、当前所有权/房间代次及 SFU ACK 拒绝。
8. SFU CI 在独立 Linux runner 的受限 Docker 容器执行六包，覆盖房间、track、
   signaling、WebRTC 及配置。依赖下载与测试分阶段：测试 `network=none`、
   `GOPROXY=off`，源码和模块缓存只读；`/tmp` 显式允许执行 Go 测试产物。
   本地桌面入口拒绝执行此 Go/ICE 检查。

## 怎样解读结果

| 类别 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 源码/VM 契约 | 指定局部函数、输入边界及受控异步顺序 | 完整 Electron/React/SDK 生命周期与真实网络 |
| 类型/语法 | 指定代码的编译契约 | 运行顺序、媒体或协议行为 |
| 展示模型/SSR | 指定呈现与安全降级 | 实际 DOM 布局、可用性、网络路径 |
| Windows CLR/IPC fixture | 当前 helper 的合成对象、测试 pipe 与退出边界 | 真实 UAC、驱动、系统 DNS/防火墙安装 |
| Peer/controller 组合 | 生产方法在受控 RTP、时钟、浏览器边界下的缓存/切换 | 真实浏览器编码、DTX、设备与 WAN 传输 |
| Gryt handler | 真实 JWT、测试数据库与授权/清理方法 | 实际 SFU 转发和完整客户端 |
| 隔离 SFU 六包 | 容器内 SDP 策略、控制和有界 loopback 传输 | 用户桌面、真实跨设备路径及 12 人容量 |
| 对应版本双设备实测 | 该设备、网络、版本的产品行为 | 其他设备、网络或后续源码版本 |

一次断言或入口数不作为完成度。每次故障应先保存旧失败，构造能在旧行为
失败的回放，再验证修复；优先用真实相邻生产方法，替身留在外部系统边界。
凡是模型主动刷新时间戳、跳过等待或用恒定成功代替资源生命周期，应在结论
中明确写出，不能把它们的绿归纳为真实路径可用。

## 可运行入口与本轮验证

从仓库根目录使用 PowerShell 7：

```powershell
./tools/check-core-contracts.ps1 -List -Group All
./tools/check-core-contracts.ps1
./tools/check-core-contracts.ps1 -Group Presentation
./tools/check-core-contracts.ps1 -Group All
./tools/check-production-routing.ps1 -Component Voice
./tools/check-production-routing.ps1 -Component Gryt
```

依赖安装不藏在检查脚本内。Voice 入口先正常 build，再运行其聚合回归；Gryt
入口仅运行指定 Node 测试，不启动服务器。Windows CI helper 构建和 SFU CI
容器入口有 host/CI 限制，本地不要伪造环境绕过。

本轮根 `-Group All` 四类本地检查通过；Gryt handler 12 项通过。没有在用户
Windows 桌面执行 Go/ICE、ET、完整应用或实际媒体。YAML 解析与 PowerShell
入口语法检查只验证配置，不能算远端 CI 成功。

首次远端 CI 已在提交 `23332c8b7232f7e7f6608cf1b4b09f2157282e05` 触发：
[run 38563031275](https://github.com/Thankyou-Cheems/LaokuaiCloud/actions/runs/38563031275)。
最终结果为 Windows、Voice、SFU job success，Gryt job failure，整个 run failure。
Gryt 失败在安装依赖：CI 初稿使用了
`npm ci`，但该组件只有 `yarn.lock`，因此得到 `EUSAGE`；真实 handler 回归
尚未执行，并非 handler 的行为测试失败。这是本轮 CI 修改引入的前置错误。
修复采用已有 Yarn 1.22.22 的 frozen-lockfile/ignore-scripts 安装，不生成或
替换锁文件。不能用本地 handler 通过替代其后续远端执行结果。

改进后的独立 job 已使 Voice 回归得以执行，没有再次被前面的 Windows 检查
整体跳过；同时也暴露出依赖安装前置需要按组件实际锁文件验证。

修复提交 `c92aa7b05c2eec059fa52e25e21969d0b054bdd7` 的[完整 CI](https://github.com/Thankyou-Cheems/LaokuaiCloud/actions/runs/38563359957) 已完成：
Windows、Voice、Gryt、SFU 四个 job 全部 success。逐步骤结果见
[本轮 CI 回执](../release/acceptance/test-ci-correction-20261014.json)。旧 run 的
failure/skipped 保持原结论，不追溯改成通过。这证明上述检查实际运行，仍不
证明真实双机听感、穿透、游戏共存或容量已验收。

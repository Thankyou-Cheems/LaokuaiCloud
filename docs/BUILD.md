# Windows 构建入口

以测试包 `legal/SOURCE-OFFER.json` 中的 `sourceCommit` 为准检出本仓库。
使用 Windows 10/11 x64、PowerShell 7、Node 24、Yarn Classic 1.22、Visual
Studio 2022 C++ 工具及 Windows SDK。保留组件目录和锁文件。不要将历史
Npcap Packet.dll/lib 或私人 profile 复制进构建目录。

## 对应源码材料

校验 `release/source-materials/public-assets.json` 的六个附件。源码下载地址
写在包的 SOURCE-OFFER.json 中；当前仓库尚未公开，链接需要仓库权限。

- EasyTier-Corresponding-Source.zip：现代 Windows core/CLI 的 1262 文件
  源码及锁定的 crate/git 依赖；不是包含旧预编译资产的 1277 文件恢复归档。
- EasyTier-Build-Tools.zip：还原与构建工具。再覆盖 EasyTier-Build-Tools-Fix.zip
  的同名 helper，按 `tools/RECIPIENT-REBUILD-AND-RELEASE-PLAN.md` 构建。
  修复版 helper 已完成一次离线修改库后重新编译/链接验证。
- UI-Preferred-Source.zip、RNNoise-Preferred-Source.zip 与
  Native-Hook-Corresponding-Source.zip：构建输入的可编辑源码/模型及说明。
- 未改动上游的固定版本和源码位置在清单的 `upstreamSources`。

## 客户端

在 `components/client` 用 `yarn install --frozen-lockfile` 安装锁定依赖。
Voice SDK 的本仓库 `vendor` tarball 是锁定依赖的一部分。应用源码在
`src` 和 `electron`；Voice/服务端/SFU 各自源码在相邻组件目录。

`tools/build-portable.ps1 -Stage Compile -NodePath <node.exe绝对路径>` 会
编译小型权限 helper，运行 TypeScript 与 Vite。该 helper 使用系统 .NET
Framework 4.x 的 x64 C# 编译器，源码位于
`components/client/native/community-lan-broker/Program.cs`。

完整打包还需要原生 capture helper、Squad helper、现代 ET 四文件运行时与
许可材料。各自构建入口在 client 的 `scripts/build-helper.mjs`、
`native/squad-scope/build.bat` 和上述 ET 工具包。原生输入及既有精确产物的
哈希见 client 的 `release/easytier-native-input-inventory.json` 和打包脚本；
Squad 的 `build-receipt.json` 必须与源文件、编译输出匹配。

将六个源码附件放在 `components/client/build/recipient-source/`；它们只供
核对来源，不复制进安装包。`tools/build-portable.ps1 -Stage Package` 会写入
精确提交的 SOURCE-OFFER、检查原生文件与声明，再生成 unsigned portable。
完整入口 `-Stage All` 先编译再打包。输出在
`components/client/release-laokuai-beta-20261013/`。
打包中间文件位于新的系统临时目录，避免 Codex 映射工作区 EXE/ASAR 导致写入
失败；最终 portable 才复制回上述目录。WinCodeSign 工具先校验 SHA512，再只
提取 Windows 文件，无需为无关 macOS 符号链接提高构建权限。

修改原生源码会改变产物哈希，应同时更新对应构建回执和产品清单，不应绕过
旧产物检查或把新 EXE 冒充旧冻结版本。应用测试可用根目录
`tools/check-core-contracts.ps1`；这些纯检查不能证明真实设备或网络可用。

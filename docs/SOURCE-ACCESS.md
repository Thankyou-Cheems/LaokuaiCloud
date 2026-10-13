# 源码位置与测试包

源码仓库是 `https://github.com/Thankyou-Cheems/LaokuaiCloud`，现已公开。
用户于 2026-10-13 明确批准删除 GitHub 旧仓库并同名重建，用清理后的代码和
历史重新推送。仓库地址保持一致，GitHub 仓库 ID 已改变；i18n fork 未修改。

公开前发现旧历史含有未使用的 Npcap Packet.dll/Packet.lib，用户已另行批准
只为移除这些文件而清理提交历史。恢复备份留在本机；清理会改变受影响提交的
ID，不改变其余源文件。测试包和源码说明使用清理后的提交。
当前远端分支只保留 `main`，另有清理后的源码材料标签。原私有仓库的旧 SHA
残留通过删除重建解决；本地原历史及清理后历史的 bundle 均保留，不上传旧恢复
引用。历史包中“当前私有”的文字反映构建时状态，实时状态以本页和 GitHub 为准。

源码不必全部保存在同一个仓库。发行材料需要明确对应测试包的确切源码：

- 本项目修改过的客户端、Voice、后端、SFU 和 EasyTier 补丁，保留在本仓库
  并使用完整 commit 标识。构建脚本、依赖锁和补丁应用顺序一并提供。
- 未修改的公开上游，可以引用确切 commit/tag 的源码及校验值。引用主页、
  `main` 或“最新版”不能说明本包实际使用哪一版。
- 仓库以外的修改版 UI、模型或原生库源码，需要另有实际可下载的完整来源；
  本地路径、私有链接和只有编译产物的下载不能替代它们。
- 包中保留原始许可证、版权署名、必要声明和 `SOURCE-OFFER.json`。
  完整源码与恢复依赖的大归档不随绿色包携带。

分开托管不免除提供完整对应源码的责任。引用第三方服务器时仍须保证可获得，
必要时提供镜像；具体按各组件许可证处理。GNU 的相关说明见
[源码与二进制分开托管](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites)。

公开检查涵盖将公开的整个 Git 历史，不仅当前目录。原始用户 profile、密码、
令牌和机器日志不得随源码或包分发。旧的源码包/测试证据保留其原有版本含义，
不能给新应用编译结果套用旧源码 commit。

源码附件清单及哈希在 `release/source-materials/public-assets.json`；构建入口见
[BUILD.md](BUILD.md)。同仓库的 `source-materials-20261013` Release
提供六份对应源码/构建工具附件。附件不包含用户 profile 或 Npcap 分发二进制。

## 新版原生联机源码的更新入口

包含成员中继预算与短租约的新版 core/CLI 继续使用上述六份附件，不替换旧 ZIP、
旧构建回执或旧失败记录。新版修改的首选源码由包内 SOURCE-OFFER.json 指向的
精确本仓库提交提供；原生冻结提交、原生子树标识、逐文件哈希和更新清单另由
`nativeSourceUpdate` 字段给出。原生子树标识指
`components/easytier/source` 在该单体仓库提交中的 Git tree，不沿用旧独立原生
仓库的 tree 标识。

旧 `verify-recipient-build-input.cjs` 和固定构建 helper 仅接受旧版 1262 文件的
哈希，不能直接用于新版代码。新版入口是本仓库的
`release/source-materials/apply-native-source-update.cjs` 与
`release/source-materials/build-updated-recipient-native.ps1`，使用同目录
`member-network-20261013/source-update-manifest.json`。更新清单保留原依赖锁和
15 个预编译资产的排除范围；新版为 1263 个首选源码文件。新工具逐一核对旧源码、
完整文件集及新提交的源码哈希，保留更新前备份，不修改旧源码附件或原恢复回执。

完整步骤如下，目录变量分别指源码材料、全新恢复目录和精确仓库源码快照根目录：

1. 按 SOURCE-OFFER.json 核对六个附件的大小和 SHA256。解开
   EasyTier-Corresponding-Source.zip 与 EasyTier-Build-Tools.zip，再覆盖
   EasyTier-Build-Tools-Fix.zip 中的同名 helper。保留这些原附件及工具。
2. 使用旧工具先恢复原材料，生成隔离的依赖目录。选择全新目录，不复用此前
   编译目标或修改库探针：

   ```powershell
   node "$Materials/tools/restore-screened-recipient-source.cjs" $Materials $Restored
   ```

3. 获取 SOURCE-OFFER.json 的 `sourceArchive`，或检出其完整 `sourceCommit`。
   从该快照运行新版源码更新入口；快照内的更新清单必须与 offer 中的路径及
   哈希对应。此步只更新源码，不下载依赖、不运行编译器或原生程序：

   ```powershell
   $UpdateManifest = Join-Path $Snapshot 'release/source-materials/member-network-20261013/source-update-manifest.json'
   node "$Snapshot/release/source-materials/apply-native-source-update.cjs" $Restored $Snapshot $UpdateManifest
   node "$Snapshot/release/source-materials/apply-native-source-update.cjs" $Restored --check $UpdateManifest
   ```

4. 在合法安装的 VS2022 x64／Windows SDK 环境中，准备 Rust 1.95.0、CMake
   和固定 protoc36，再运行新版 helper。它保持同一 17 项 feature、离线锁定
   依赖和标准静态 CRT，构建 core 与 CLI；不启动产物：

   ```powershell
   pwsh -NoProfile -File "$Snapshot/release/source-materials/build-updated-recipient-native.ps1" `
     -RestoredDirectory $Restored -SourceUpdateManifest $UpdateManifest `
     -ProtocExecutable $ProtocExecutable
   ```

源码更新验证与原生编译是两项独立证据。源码更新的夹具验证不等于新的外部
接收者已经完成离线重建，也不保证字节完全相同。修改版要进入自建应用，还须按
本仓库构建脚本更新对应的 manifest、profile、core/CLI 哈希和 loader 固定标识，
然后重新编译应用；不能将新 EXE 冒充旧冻结产物。真实 ET/TUN、驱动、双设备
联机及媒体验收仍按各自精确版本记录。

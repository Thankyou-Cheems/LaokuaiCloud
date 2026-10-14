# 绿色包固定基线增量更新

这是退出客户端后运行的一次性离线更新工具。需要 Windows 和 PowerShell 7；
不安装服务，不启动或结束客户端，不操作 ET/TUN、驱动、防火墙或生产服务。
初次安装仍使用完整绿色 ZIP；增量包只适用于清单指定的完整程序基线。
更新失败或基线程序被修改时，保留用户数据，使用原完整包与备份进行恢复。

## 构建

先验证来源 ZIP 的可信发布记录。工具读取两份干净绿色 ZIP，分别计算 ZIP 和
每项程序文件 SHA256，生成固定来源到固定目标的升级包与 `.receipt.json`。
版本参数用于说明来源和目标；程序基线由完整文件长度和哈希确认。

```powershell
pwsh -NoProfile -File D:/Dev/LaokuaiCloud/tools/new-incremental-update.ps1 `
  -BaseZip 'D:/path/to/唠蒯云-1.13.22-laokuai.beta.20261013.12-zh-CN-win-x64-green.zip' `
  -TargetZip 'D:/path/to/唠蒯云-1.13.22-laokuai.beta.20261014.13-zh-CN-win-x64-green.zip' `
  -OutputZip 'D:/path/to/唠蒯云-12-to-13-update.zip' `
  -BaseVersion '1.13.22-laokuai.beta.20261013.12' `
  -TargetVersion '1.13.22-laokuai.beta.20261014.13'
```

只有 `tools/incremental-program-paths.json` 中的 146 个固定程序路径可以出现在
基线、目标和修改清单中。此白名单从 SHA256 为
`4a0ce3c89abd41da1bfc257df0e1c70b90a872b3a9f399e92ae840da41280640` 的
`.12` 完整绿色包提取。新增程序路径需要审视源码并更新工具白名单，不能由下载
的清单自行扩大权限。已知路径可以显式增删；新增路径已有文件时拒绝覆盖。
profile、账户、凭据、其他未知文件不会被枚举、复制、清理或覆盖。

对长度相同、至少 1 MiB 的 EXE/DLL，构建器比较全部 64 KiB 块。更改块合计小于
文件一半时，只压缩更改块；否则压缩整文件。每个补丁块固定对齐、严格递增、
不越界；最后一块允许不足 64 KiB。app.asar 使用整文件压缩。清单同时含原完整
ZIP 和目标完整 ZIP 哈希，升级包不是目标 ZIP 的逐字节再打包。

## 应用

1. 从可信发布途径获得升级包和独立公布的升级包 SHA256，并校验更新器来源。
   **包内哈希用于完整性校验，不是发布者签名。** 同包提供的 receipt 不能独立
   证明发布者身份；目前没有实现签名、在线自动下载或自动升级服务。
2. 完全退出唠蒯云。更新器发现安装目录内的运行进程、或无法读取路径的同名
   程序/助手时会拒绝更新，不自动结束进程。
3. 从仓库运行以下命令；也可以把可信升级 ZIP 解压到独立目录后，双击
   `updater/apply-incremental-update.cmd`，依次输入原升级 ZIP 路径、现有安装
   目录、独立获得的 SHA256。解压目录应与安装目录分开。

```powershell
pwsh -NoProfile -File D:/Dev/LaokuaiCloud/tools/apply-incremental-update.ps1 `
  -UpdateZip 'D:/path/to/唠蒯云-12-to-13-update.zip' `
  -InstallDirectory 'C:/path/to/唠蒯云' `
  -ExpectedPackageSha256 '<可信发布途径公布的64位小写SHA256>'
```

更新器持有升级 ZIP 的只读句柄，拒绝写入/删除，并验证外部指定哈希。它拒绝
路径穿越、绝对路径、备用数据流、Windows 保留名称、尾随点/空格、重复大小写
路径、文件/目录冲突、未知归档条目，以及超出数量或展开大小限制的包。
文件与祖先目录的符号链接、junction 和未知 reparse tag 均拒绝。OneDrive 的
明确 Cloud family tag (`tag & 0xFFFF0FFF == 0x9000001A`) 允许正常读取/水合；
不把云文件当作路径重定向，不允许其他 tag。

更新器先验证**全部基线程序**，暂存**全部目标程序**并验证每项长度与 SHA256，
然后再检查客户端已退出，逐项把原更改文件移动到备份，再替换暂存文件。
未变化程序保持在原位置。完成后重新核验全部安装目标，输出目标文件数、
报告路径和备份路径，用户自行正常启动客户端。它需要能容纳完整暂存目标和
更改文件备份的额外磁盘空间；只读或被文件锁定的安装目录会失败并尝试回滚。

报告、journal、原更改文件备份和暂存材料保留在安装目录**同级**新建的
`.laokuai-update-<随机GUID>/`。这些是本地恢复材料，可能含私人路径，不应
加入 Git 或公开发布。成功报告的 `status` 为 `complete`，并逐项列出目标程序
哈希；日常异常会反向恢复已更改程序并校验恢复哈希，报告 `rolled-back`。
若回滚失败，报告 `rollback-failed` 并保留备份供人工恢复。意外断电/终止不是
可承诺的原子全目录事务；此时用 journal 和 backup 或更新前完整备份恢复，
不要直接再次启动混合版本。确认正常后，可由用户按报告的具体目录清理恢复
材料；工具不会自动删除历史备份或用户文件。

## 回归与边界

```powershell
pwsh -NoProfile -File D:/Dev/LaokuaiCloud/tools/tests/check-incremental-update.ps1 `
  -OutputDirectory 'D:/Dev/LaokuaiCloud/.local/incremental-test-fresh'
```

可附加 `-RealBaseZip '<完整基线ZIP>' -RealTargetZip '<完整目标ZIP>'`，对真实归档
进行临时目录更新。目录必须新建，测试进程只是临时复制的 Node 延时 fixture；
测试代码结束自己创建的 fixture，不启动或停止用户客户端。

覆盖正确块补丁和全目标、已知增删、profile/未知文件保留、错误基线、外部包
校验失败、载荷篡改、替换后注入故障回滚、路径穿越/绝对路径/重复路径、越权
profile 清单、未知文件新增冲突、Cloud tag 判定、真实 junction 拒绝及运行中
拒绝。历史 `.11 → .12` 真实 ZIP 已完成 146 项目标校验；约 17.32 MB 的实测
只说明那两个固定归档的增量，不代表任意版本大小，也不提升真实双设备语音、
ET/TUN 或 12 人 WAN 验收状态。

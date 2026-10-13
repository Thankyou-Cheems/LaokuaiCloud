# 源码位置与测试包

现有仓库是 `https://github.com/Thankyou-Cheems/LaokuaiCloud`。公开此仓库指
改变其可见性，不另建仓库、不替换工作区，也不修改 i18n fork。
实际公开状态以 GitHub 为准；当前正在准备与检查。

公开前发现旧历史含有未使用的 Npcap Packet.dll/Packet.lib，用户已另行批准
只为移除这些文件而清理提交历史。恢复备份留在本机；清理会改变受影响提交的
ID，不改变其余源文件。测试包和源码说明使用清理后的提交。
当前远端分支只剩 `main`。GitHub 仍通过旧 SHA 保留已删除 Packet.dll 的对象；
该服务器端残留尚未清除，因此目前仓库仍为私有，不能声称公众已可取得源码。

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
[BUILD.md](BUILD.md)。仓库公开后，同仓库的 `source-materials-20261013` Release
提供六份对应源码/构建工具附件。附件不包含用户 profile 或 Npcap 分发二进制。

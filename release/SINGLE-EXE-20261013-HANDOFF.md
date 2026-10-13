# 唠蒯云朋友测试单EXE交接

最终文件：`C:\Users\cheb2\Documents\Codex\2026-10-11\task-6\distribution-beta-a5c557be\single-exe-20261013\单文件交付\唠蒯云-1.13.22-laokuai.beta.20261012.1-win-x64-朋友测试-单文件.exe`

大小：320318727字节（约305.48MiB）。SHA256：`99d0784bac155ec3a9fcc9a2dc477118a89c2eea567f8fd09813a1f8d2055388`。

只需给朋友这一个EXE，不需要发送原分发ZIP，也不需要旁边的源码/运行目录。单文件交付目录只含这一个文件。它是NSIS portable，自解包运行；运行中会生成临时文件，并在EXE旁建立laokuai-chat-data/sessions，请使用有写权限的固定目录。不是“运行时永不产生文件”。原97,846,494B包与全部旧ZIP保留，未删除。

Electron40.6.1、28个固定运行依赖（含native hook）、Voice、Squad helper、音频/屏幕伴随helper及EasyTier2.7私有现代静态core/CLI、Wintun/WinDivert载荷都在内部。固定产品ET走prepareProductBundled，不依靠外部ZIP或动态下载官方旧Packet版本。静态核对无新VC/Npcap依赖；N-API的node.exe延迟导入由Electron宿主提供，不要求另装Node。Windows10/11 x64系统DLL、适用的媒体能力/系统策略仍是环境前提；N/KN等变体未独立验收。语音普通权限可用，联机TUN仍需同一Windows用户管理员权限及本机授权；不自动改网络安全设置。

许可证/版权：原始AGPL、LGPL/GPL、MIT/BSD、Electron/Chromium和Windows/Wintun分立条款已保留。不能把“内置许可证”当作免交付对应源码。原包的修改后应用/Voice/ET源码外置且没有已经核实的公开源码地址，所以本次只重做必要资源封装，把八份既有对应源码及构建/重新链接工具内嵌，无需另发下载链接或强迫朋友下载整个ZIP。用标准7-Zip打开EXE，进入$PLUGINSDIR/app-64.7z，再进入resources/legal/corresponding-source即可取得；不需要密码/密钥，也不用运行产品取得源码。原许可证在resources/legal，Electron/Chromiumnotice在载荷根。7-Zip只用于看/改源码，不是运行前提。发送EXE时附一句这个查看位置即可，不剥除这些材料。

原样Electron/Chromium含FFmpeg LGPL2.1+：已真实匿名取得Electron v40.6.1官方DEPS与patches/config.json、Chromium144.0.7559.220 DEPS，核实FFmpeg固定commit e18f48eba6b367ac68b9c477ae6cbe224e36b031、LGPL文件及Electron该版本的补丁索引/原文件。固定原样运行时源码取得说明、DEPS与补丁证据在内嵌UNMODIFIED-RUNTIME-SOURCE-ACCESS.md及相邻UPSTREAM文件；不用浮动上游首页代替对应版本，也不声称本项目私有源码已经公开。已有改过的Client/Voice/Server/SFU/EasyTier等首选源码在内嵌八份档案里。此安排针对本次文件交付，不等于自动建立线上服务的AGPL网络源码接口；远端使用者的源码取得安排需持续保留。没有发布源码或上传公共平台。

运行ASAR保持`715cc61c90199e3c213bc997499ff9b15e63a7363ec5294c3d015d8ec813374e`，与旧最终包逐字节一致；全部原运行/原生资源不变，新增只是对应源码与说明。166个实际载荷文件与win-unpacked对应，八份源码SHA校验通过。未执行Vite/tsc/原生编译或重复完整测试矩阵。保留配置相对路径初失败，以及第一轮wrapper监测字典序列化未封存的证据，不将它们当作通过。

实际必要验证：从仅有本EXE的新目录启动的是portable wrapper本身，不是只运行win-unpacked；它正常自解包和转发隐藏离线空资料参数。真实中文DOM root1、两个preload object、16个成功端点采样均零/无前台激活，无show/focus/load/preload/crash失败，exit0/residual0。采样不等同连续网络抓包或完整OS防火墙证明。CSP/禁用IPC日志按验收模式保留，未做真实账号/麦克风/ET重跑。

用户最新确认语音房间切换和单设备ET实链路通过。本包仍为朋友测试版；双设备P2P、其他真实电脑、设备/游戏/容量完整矩阵未验收，物理语音直连不冒称已证明。社区密码未代设、未提交；未改生产安全/网络设置或私人CheemsTier。

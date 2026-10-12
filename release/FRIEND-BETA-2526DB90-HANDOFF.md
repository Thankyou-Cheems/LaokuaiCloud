# 唠蒯云朋友测试分发交接

已完成不含秘密的 Windows 10/11 x64 绿色测试分发 ZIP；请分享整个 ZIP，源码/许可跟随 EXE，不只发送 EXE。没有公开发布、上传或 push。

- 版本：1.13.22-laokuai.beta.20261012.1
- 最终源码：2526db9081567da13f246be801a3b4662cb38102；首编源码 a5c557be693520ade66dd896150327252716e561。后续仅许可遍历与包装目录收集修正，Client/src、Electron、Voice、Server 的 Git 树完全相同。
- ZIP：唠蒯云-1.13.22-laokuai.beta.20261012.1-win-x64-朋友测试.zip，331548094 B；SHA256 `0a3cdd87a2eb869f11ae1fc3d27e25b9b060c02e8a7cd67059770facb8aa2102`。
- EXE：唠蒯云-1.13.22-laokuai.beta.20261012.1-zh-CN-win-x64-portable.exe，97846494 B；SHA256 `43a630df55d965048632f9bd13b3febeb357419f3d9ea49b28ca5f4330b98ade`。
- ASAR：`715cc61c90199e3c213bc997499ff9b15e63a7363ec5294c3d015d8ec813374e`；146 实际载荷文件与 win-unpacked 全字节相同，28 个冻结运行依赖闭包/N-API addon 字节校验通过。
- SDK：vendor/gryt-voice-0.6.2-laokuai.lifecycle.3.tgz；SHA256 `897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae`。现代原生源089b6182/core f716a113/CLI1ad46380 和两个签名伴随文件保持原字节，没有原生重编译。

正常源码/许可门禁通过，未使用旧 INTERNAL wrapper。611 份原始 JS 依赖 notice、原生504包/324文本与补充出处保留。六份主要对应源码/工具加两份 N-API/libuiohook 与官方 WinDivert2.2.2 源码均随 ZIP 提供；公共管理代理源码也提供。原生对应源码先前独立修改库重新编译/链接结果被复用，没有重复大构建。本轮 N-API/驱动源码仅导出，未新编译或运行。

客户端/服务器类型、定向客户端 lint、实际加入 handler11 场景、密码管理 handler4 场景、scrypt8检查、native consent6模拟和持续代理19纯检查通过。唯一有效精确包隐藏离线空资料 bootstrap：真实中文DOM root1/preload两个object，13成功端点采样均零、ownedForeground=false，六个同EXE进程，隐藏截图、无show/focus/load/preload/crash失败事件，自行exit0且residual0。CSP/禁用IPC日志按验收模式预期保留，不称控制台全无错误。检查运行的是精确解包载荷，未执行 NSIS wrapper。

后台已更新为 1.10.58-laokuai.beta.a5c557be，镜像 `sha256:9ddd8f97831436c5b4cae46b04e4c0a9b9afb34961aab5ce4c7d0a9fc80dfc81`，bundle `0d6073e2113194d94ea0f399eeb395ce425fd267b8e84ce686b8d3ac5885e74c`；复用原镜像全部依赖，不重新取得依赖。原 owner/JWT/token_version/成员保留，只使新成员进入密码准入。UID1001/socket0600 的固定公共管理代理允许独立普通成员凭据持续自动续期，每次TTL300秒；没有额外开放窗口、期限或20设备配额，/24有253个自然可用客户地址。SFU/公共核心未重启，私人ET、端口、防火墙未改。

**密码尚未由本人设置，新成员准入未开通。** 未代设、读取、复制、记录或嵌入实际密码。管理员本人使用既有owner身份，在社区设置的两个遮蔽输入框输入并点击保存；新成员通过密码仅取得普通成员身份。现有成员/owner仍可使用社区。朋友每人使用自己的账号/设备身份，联机以同一Windows用户的管理员权限启动并手动确认本机授权。

已保留必要失败/中间检查点：目录命名不符合安全门禁的拒绝启动（code2、未初始化应用/profile、无残留）；notice生成漏读junction；打包器漏收集junction传递依赖；准备脚本将server zod误当client依赖的断言。最终不复用失败证据为通过，修正只涉及本任务包装准备和notice遍历。旧a5/B checkpoint/source ZIP/profile记录留在独立目录，原包与来源历史未删除。

双设备真实密码加入/ET连续续期、通话、设备/听感、游戏/容量与物理直连仍未验收。项目ready=false/finalPackage=null继续表示完整公开版本未验收；friendTestDistribution单独记录用户授权的可分发测试包。

分发根：`C:\Users\cheb2\Documents\Codex\2026-10-11\task-6\distribution-beta-a5c557be`。精确收据在 DISTRIBUTION-RECEIPT.json、PACKAGE-FINAL-AUDIT.json、PACKAGE-SMOKE-SUMMARY.json、DEPLOY-INSTALL.json。真实UI取证与本地日志仅在本任务专用目录，不在客户ZIP或Git中。

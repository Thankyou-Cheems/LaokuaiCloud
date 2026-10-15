# 原生语音入房被误判为后端未启用

2026-10-15，用户确认 native.2 已能自动加入 EasyTier，但点选频道出现
“此社区后端尚未启用原生 ET 语音，请更新后端后重试”。

## 原因与修复

线上 `server:info` 已宣告原生协议 1，但 `sendServerDetails()` 发送的
`server:details.server_info` 缺少原生能力字段。桌面 `NativeVoiceProvider`
实际读取后者，因而在发起原生入房请求之前拒绝。这不是 ET 不通或音频设备失败。

后端两条消息现在共用同一能力构造函数，包括原生开关、协议版本、成员移动和
纯音频标志。原生开启时即使不配置 SFU，`voice_enabled` 也为真；普通成员仍须
通过现有入会认证才能取得详情。无需更新 native.2 桌面程序。

## 本次测试如何覆盖此前遗漏

此前公网探针只验证 `server:info`，客户端测试则手写了已经开启的
`server_info`，两者都绕过了真实出错边界。健康检查和原生能力广播通过，不能
证明登录后能够入房。

新增 `serverVoiceCapabilities.test.ts` 使用全新临时 SQLite、普通成员及真实
`sendInfo` / `sendServerDetails`。修复前 7 项中 6 项失败；产出的真实详情
再交给实际客户端 provider，复现与截图相同的异常。修复后 7 项全部通过，
同样由真实构造函数产出的详情通过 provider 生命周期检查。

可设置 `LAOKUAI_NATIVE_CAPABILITY_FIXTURE` 令后端测试输出私有的合成详情，
再运行 `components/client/scripts/check-native-lan-provider.mjs --server-details <文件>`。
合成数据、红绿日志保存在 `.local/native-capability-fix/`，不含真实账号凭据。

这验证的是登录后能力传递与入房控制逻辑；IPC/socket 仍为测试替身，没有使用
真实声卡，也不构成双机可听见声音、持续通话或 12 人容量验收。

## 部署范围

沿用现有仅 Gryt 部署流程；允许更新已开启原生模式的实例。每次冻结新提交、
备份数据库、保留旧镜像和原 Compose 文件，回滚到该次更新前的模式。
仅替换 Gryt 镜像，保持成员、聊天、挂载、端口、12 人限制及中继开关。
SFU、EasyTier 与管理代理不重启，桌面账号和配置不写入。

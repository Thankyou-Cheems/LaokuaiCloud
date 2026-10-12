# 后端版本基底核查（2026-10-12）

结论：暂不因 `1.10.58 → 1.0.76-laokuai.hybrid.85ec3b9c` 的数值差异重建候选。已检查的数据库结构和迁移状态没有降级证据，旧 join 协议在候选实际处理器的隔离回归中通过。仍暂停生产部署，先解决精确候选镜像启动失败，再验实际认证、控制面和回滚；这份核查不是部署批准。

## 版本与来源

- 生产配置及进程的 `SERVER_VERSION=1.10.58`。镜像 `sha256:b6f4bf5db57493a06307e1cfaefd1c92d6c90ccc26e46c9ba05a8fab53d093e8`，bundle SHA256 `1350981826a74691d94942ea46f7ebbea862efee79ae810adc2a87e17b01f5f9`。
- 生产镜像标签为 `local/gryt-server:voice-mode-6ea9930`，没有可核验的 revision label/RepoDigest。候选已有两份 voice 说明都声明基于生产 `6ea9930765a6aed92cc4e5d9f5cce6e8a0a1e45c`。这是相互印证的来源线索，不是完整 Git 祖先关系证明。
- 候选 `package.json` 是 `1.0.76`；Dockerfile 将构建 ARG `VERSION` 注入 `SERVER_VERSION`，默认 ARG 又是 `1.0.0`。因此运行显示版本、包版本和 Git 版本不能等同。候选源 commit `85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d`，server tree `96db8312488c4f399904192f3a932232cf6130ad`；本次没有改变组件源码。
- 候选 OCI image ID `sha256:e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba`；Docker tar SHA256 `9dde30f81c4daf6cffa0e5d63a98b37951b55e55f5d19fda76fda17bda944453`，classic tar config ID `sha256:e8747cede11f23df31cb9c190362a63dcf2873c12d7162926934a67e32372367`。导入后的身份必须按实际格式核对，不能只看 tag。
- 当前集成库缺少该旧 Git 对象；两个相关 owner Git 查询被拒绝读取，未绕过。准确生产 Git 基点仍未证实。不能声称整个生产 bundle 与候选逐字节相同或完全继承。

## 数据库与迁移

生产只读 SQLite 事务取得表/列、索引和外键元数据，以及三个已知迁移标记；没有读取用户数据行、密钥或导出数据库。生产 Node 22.23.3 / SQLite 3.51.3 / user_version 0。

候选实际 initSqlite 在独立临时合成数据库中生成 42 张表，与生产的 42 张表元数据没有差异：列名/类型/notnull/PK/default 是否存在、索引名/unique/origin/partial、外键元数据一致。两边 `permission_schema_version=10`，`channel_rank_gates_migrated` 和 `access_token_reissue_gryt1239` 均存在。未比较默认表达式、部分索引谓词、trigger 语义或实际数据；不能扩大成所有 DDL 与数据语义完全相同。

合成已有社区重复初始化通过：server_config、users、roles、role_definitions、refresh_tokens 保留；owner、既有 SFU key、tokenVersion=7、刷新令牌和已配置显示/可发现设置保留，已存在迁移标记没有再触发 token bump。唯一观察到的标准化为 `avatar_thumb_px: null → 128`，第三次初始化达到固定点。测试使用 Node 24.10.0 / SQLite 3.50.4，并非 Linux 候选 bundle 的启动验收。临时随机测试 JWT 仅用于合成数据，没有生产凭据生成或变更。

真实数据位于正在使用 WAL 的目录。主 db 文件只有 4096 字节不代表完整数据；未来任何批准的备份/候选副本必须是一致性备份，不能只复制主 db，更不能让候选与旧实例同时写原目录。

## 旧客户端协议

生产 bundle 内只做固定字符串存在性核查：server:join/challenge/verify/joined、token:refresh、certificate/assertion 及身份迁移相关标记存在。早先猜测的 `server:proof` 不存在不能解释成缺少身份校验；实际 join 使用 certificate/assertion。

候选实际 registerJoinHandlers、身份加密和数据库回归通过三项：旧 nickname → challenge → certificate/assertion 流程加入已有成员；返回刷新令牌且不要求 Hybrid 声明；错误 nonce 被拒绝。JWT 中原 serverUserId/tokenVersion=7 与 owner 均保持。Socket.IO 传输为 fake，未联网、未运行生产客户端或媒体。

完整 join 回归显式设置 `GRYT_IDENTITY_TIERS=account,local`，使用真实 ES256 self-signed local 证书。因此它证明允许 local 时的旧消息流程，不能宣称生产默认 account/外部 CA 联网流程已验。另有候选现有 20 项身份纯测试（4 suites）通过，包括默认 tier、self-signed、nonce 和时钟约束；外部 CA 网络用例未运行。生产实际身份配置、旧客户端联网和持续刷新仍待隔离验收。

## 仍阻塞的验收与重建条件

父线程报告构建侧首轮精确 backend 在健康检查前 exit 1，使用隔离空数据和无网络；原因尚在区分。本次未运行该镜像，不把这次退出归因于生产不兼容。先取得其脱敏异常栈/退出原因，验证必要 JWT/config/data 权限和实际 bundle 导入路径。源码 production 会拒绝缺失/默认 JWT_SECRET，这只是可核查的配置要求，不是对该次失败原因的断言。

在精确候选启动通过后，仍需批准的隔离数据副本迁移/重启、真实旧 account 客户端 join/refresh、backend↔SFU token/control 合约及镜像和数据联合回滚。现有生产缺少新 Hybrid 标记；仅改环境 flag 不能启用尚未部署的协议。此次合成回归没有证明 Hybrid 媒体、ET、权限全量行为或新 SFU 生产兼容性。

当前建议：保留候选源码，不做仅为版本数字的基线重建。如果后续确认实际生产来源与声明的 6ea 基点不同且有未包含业务差异，或启动/真实旧客户端回归定位到候选源码回退，则依据具体差异重建并重新冻结镜像。三个模块保持独立版本/进程/回滚，grant 工作待本阻塞解除。

机器可读证据摘要和本地只读材料 SHA256 见 `acceptance/backend-version-baseline-review.json`。完整生产 bundle/数据库导出此前被自动审批拒绝，未执行；本次改用授权的结构摘要与固定标记核查，没有绕过拒绝。未 push、部署、停止生产服务、读取真实用户资料或运行 ET/TUN/媒体。

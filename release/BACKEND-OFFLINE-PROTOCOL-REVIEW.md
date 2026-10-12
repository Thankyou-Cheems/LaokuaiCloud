# 后端精确镜像离线协议核查

现有 `85ec3b9c` 后端镜像通过 20 项离线合成协议/数据检查，未修改组件源码、已封存镜像或版本标签，当前无需因此重建。生产部署仍暂停，ready=false / finalPackage=null。

## 首次 exit1 的原因已证实

已读取构建任务 `hybrid-backend-sfu-85ec3b9c-offline-selfcheck/REPORT.md` 和 HANDOFF。两次后端空配置启动都在 production 模式因 JWT_SECRET 缺失/默认占位值主动拒绝，非 OOM，未进入数据库初始化。它是预期的认证配置保护，不是数据库不兼容证据，也不需要删改保护代码。

本次仅在隔离 fixture 进程内生成临时合成 JWT secret，仍使用 production 模式和原 bundle；没有生产密钥或持续有效访问。镜像 OCI ID 为 `sha256:e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba`，bundle SHA256 为 `8181b0834bcb93937b567939f69b26e8719a15e2785f9fd5ea3be955dade3fe5`，source85ec/tree96db 原值保持。

## 本次真实运行范围

`release/tests/offline-backend/run-image-protocol.py` 检查精确镜像/source/tree/UID，再启动一个 network=none、无主机端口、只读 rootfs、1CPU/1GiB 的自有容器；唯一主机挂载是只读 fixture 脚本。数据与身份只存在于 tmpfs。容器内通过原 bundle 的 loopback HTTP 健康和真实 Engine.IO/Socket.IO WebSocket 协议测试，没有假处理器、假 JWT 验证或 bundle 修改。

Node22.23.3 / SQLite3.51.3，实际 20/20 检查通过，包括：

- 旧 nickname→challenge→certificate/assertion join，原 member ID/tokenVersion7 保留。
- refresh-token 和 access-token 两分支、新 socket 用副本前 refresh 恢复、缺少 userTokenVersion 的旧格式兼容。
- 无效/过期/撤销 refresh、过期 server-wide tokenVersion、错误 host 和 nonce 被拒绝；默认 account policy 仍拒绝 local 测试证书。
- 服务停稳后 WAL checkpoint、integrity_check、合成既有库逐字节复制；带既有迁移标记启动保持 owner/SFU key/config/tokenVersion/成员角色/refresh。
- 候选不写原回滚副本；恢复预试验快照逐字节一致，原 refresh 可恢复，候选期间新增 refresh 不存在于恢复库。
- 四次真实后端启动都 TERM exit0；整个容器 exit0/非OOM，9 个配置采样保持 networknone/无端口，准确自有容器已移除，tmpfs 丢弃。

完整结果锁定在 `acceptance/backend-image-protocol.json`，主机本地 RESULT/stdout 的哈希保留。真实用户数据、密钥、私有数据库或生产 bundle 没有被导入 Git。

## 限定与 SFU 状态

此合成基线由候选初始化，再填入既有成员和已迁移标记；生产结构版本已只读对照一致。通过的是已迁移结构 replay 与合成副本恢复，并非所有历史迁移或真实生产数据。join 的完整正例使用显式允许的 local 合成证书；account/外部 CA 和真实旧客户端程序仍未验。数据恢复后运行的仍是同一候选镜像，不是旧生产镜像二进制回滚。

构建侧 SFU 的离线健康与 UID1001 通过，但 TERM exit2 未通过优雅退出判断；这是独立未解决问题，不是后端缺 JWT 的预期错误，不可写成 SFU 回滚通过。当前没有足以定位其退出原因的 stack，不能盲改 SFU 或暗改镜像。若诊断需要普通源码修复，应冻结新 commit、通知指定 builder 重建 SFU，再按精确新产物验收；当前后端无需重建。

## 部署前最小参与/批准步骤

1. 由父线程指定 owner 完成剩余隔离验证：准确旧镜像来源/身份、SFU退出原因与 backend↔SFU token/control 合约。可继续使用合成 fixture；不需新真实账户、生产密钥或生产停机。如果发现源码问题，交新冻结源与镜像，不修改旧封存产物。
2. 请求用户批准一个隔离 staging 窗口和一致性数据副本的明确保管范围。原 JWT/服务器身份/SFU key 由管理员在目标的现有密钥管理路径配置，助手不读取值或创建新长期凭据；允许范围内由用户使用已有 account 身份执行 join/refresh，验证真实旧客户端。真实副本不传回本地或提交 Git。此时在副本上验证旧/新准确镜像切换与恢复，禁止同时写原数据。
3. 仅在上述验收通过后，提交实际目标机导入后的镜像身份、数据备份点、独立 backend/SFU 切换及回滚方案和中断窗口，取得生产变更的最终批准。生产账号/密钥、ET/TUN、screen 和媒体权限不因此扩展；三模块独立回滚。

因此当前无需用户为了完成本离线测试登录或提供秘密。真正剩余的用户参与是 staging 范围批准及已有账号一次兼容性操作，随后才是生产窗口批准。

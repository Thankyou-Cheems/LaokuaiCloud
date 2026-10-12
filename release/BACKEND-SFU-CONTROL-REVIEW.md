# Backend/SFU 控制合约离线回归

原 backend bundle 与原 SFU ELF 在一个 network=none 容器内通过 30/30 项真实进程/loopback 协议检查；另有 13 项真实源码处理器/ACK 纯测试和 1 项 SFU lease 状态测试通过。组件源码、镜像与 ELF 未改，本轮不需要重建产物。生产部署仍暂停，ready=false/finalPackage=null。

后端来源 `85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d`，bundle SHA256 `8181b0834bcb93937b567939f69b26e8719a15e2785f9fd5ea3be955dade3fe5`；SFU同一冻结来源，ELF SHA256 `47378f28e35a4a9a95aced3c3d4f21f028e13e6552721e1a814ed7492203afb2`。backend tree96db/SFU tree24c 保持。测试的进程同容器放置仅用于避免新 Docker 互通网络，生产模块边界和独立部署方式保持原方案。

## 覆盖与未覆盖

| 合约 | 实际证据 | 限定 |
| --- | --- | --- |
| backend→SFU 注册、probe/ACK | 原 bundle 的 SFUClient 经 loopback proxy 连接原 SFU，收到真实 supported ACK | 两端进程同一隔离容器，非跨容器/生产网络 |
| 旧客户端没有 Hybrid 声明 | 三个合成成员真实 join、voice:room:request 获得 SFU join token | 测试旧消息格式，不是实际旧客户端程序；local 身份显式允许 |
| 身份/频道/epoch | 实际 backend 拒绝错 access token、serverInstance/roomGeneration/session/room、跨频道、旧 publication 和 operation epoch | 应用 voice/stream/connected 状态由合成客户端明确公告，没有物理 PC |
| SFU 控制鉴权 | 原 ELF 拒绝未注册连接、错误 server/password、持正确凭据的另一连接 | 全部合成 server/key，未读取生产凭据 |
| SFU 参数与 peer 世代 | 原 ELF 拒绝错 room、空 authority、短 pause、空 session、退休 session | 非空 authority/pair 对正在暂停的冲突由纯状态测试覆盖 |
| 暂停/恢复 ACK | 实际 SFU 因缺少已连接物理 peer 返回 failed；backend 返回 hybrid_sfu_ack_failed，不返回 applied | 成功的物理暂停/恢复 ACK 尚未覆盖，不能用假 peer 绕过门禁 |
| 丢 ACK 超时/迟到 ACK | proxy 丢弃实际 hybrid_result；原 backend 在5002ms返回 hybrid_sfu_ack_timeout；迟到旧结果不影响新 probe | 没有真实已暂停的 RTP 路径，不能宣称媒体自动恢复已验 |
| 断开回退 | 真实控制连接关闭后 scope 返回 hybrid_unsupported；普通登录会话仍经实际 token:refresh 刷新 | backend fail-closed/普通会话持续通过；SDK实际音频回退仍待媒体验收 |
| 成功 ACK 关联/重放 | 13项实际处理器/SFUClient + 真JWT/合成DB纯测试通过 | SFU传输/正向ACK是mock，未扩大为原 ELF 物理 applied |
| lease 暂停/恢复/过期 | 精确 audio_lease_state.go+原测试：旧 revision、authority、pair、清理冲突及到期恢复通过 | 单纯状态，标准库编译；不是实际转发计数/RTP暂停 |

SFU 的成功 applied 要求 source/receiver PC 当前 Connected、signed session 匹配、实际音频 publication 和 receiver 存在。当前检查保留这些门禁，未生成假成功结果。以后应由指定媒体 owner 用准确冻结的两端/SDK、合成 RTP 和连接 peer 验一次真实 pause ACK、包停转发、lease expiry/resume ACK及异常回退；不需要真实生产账号或设备，但须协调该独立媒体执行范围和资源。

## 运行及失败保留

单容器 UID1001、1CPU/1GiB、read-only rootfs、无主机端口/外网、只读脚本/ELF挂载，tmpfs合成数据。backend保留production模式，仅进程内临时JWT用于fixture；真实用户/密钥/DB/生产服务均未触碰。所有自有容器按准确ID移除，tmpfs丢弃。没有创建额外 Docker 网络或改全局权限。

run1记录器漏收stderr，仅留下“缺少fixture结果”的失败；run2保存错误，定位为测试把ELF复制到默认noexec tmpfs的EACCES。run3直接执行原只读ELF挂载，并补child spawn错误处理，30项全部通过。原bundle/ELF未变，没有修改noexec设置。前两轮及清理结果完整保留，不能归为产品失败或覆盖旧失败。

backend TERM exit0。本轮SFU作为子进程收到SIGTERM退出（code=null/signal=SIGTERM），不能当作原SFU容器PID1优雅exit0或解释构建owner的TERM exit2；该owner的独立调查继续，不抢修其树或二进制。

证据和脚本SHA256见 `acceptance/backend-sfu-control-contract.json`；重跑说明见 `tests/offline-backend/CONTROL-README.md`。真实数据副本、现有account联网 staging、旧生产二进制/数据联合回滚和生产变更窗口仍待明确审批，本轮没有新增部署授权。

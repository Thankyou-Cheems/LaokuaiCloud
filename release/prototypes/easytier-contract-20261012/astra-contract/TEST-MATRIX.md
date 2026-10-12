# 唠蒯云社区 EasyTier 测试矩阵

本矩阵把本轮已经运行的纯边界测试与必须在来电后执行的 native/产品测试分开。P 表示交接包 prototype 已运行；A 表示服务端或主进程 adapter 尚待实施/验收；N 表示需要实际 ET、Windows 或媒体环境。P 通过不代表 A/N 通过。

## 本轮纯测试

执行：`node --test contract-prototype.test.mjs`，Node v24.19.0。实际结果以本包 `test-results.tap` 为准。本轮无 network/process/filesystem adapter，没有真实凭据签发。

| 测试组 | 状态 | 必须满足的断言 |
| --- | --- | --- |
| renderer 输入 | P | 只接受 communityId/enabled；secret/config/path/command/account/device/native ID/peer URI 等未知字段全部拒绝 |
| grant scope | P | serverInstanceId/account/community/device/nativeInstanceId 不可跨用 |
| 网络意图 | P | networkName/revision/IP/bootstrapProfile 与 main-owned intent 一致 |
| 对象边界 | P | 拒绝未知顶层/嵌套字段、原型对象和 getter；异常不回显 secret |
| 最小权限 | P | reusable=true、allowRelay=true、任何 proxy CIDR 均拒绝 |
| 操作绑定 | P | requestId 不一致、复制 ticket、旧响应、已接受响应重放均拒绝 |
| 退出与切换 | P | disable/enable、close/account change、native restart 使旧 ticket 失效 |
| 时间 | P | 已过期、非法续期时间、超长 TTL 拒绝；客户端时钟偏差允许，时钟倒退不延长授权，迟到请求不重置 TTL |
| 撤销 | P | 对应 grant 的在途响应被 tombstone 拒绝；旧撤销不取消无 active 时的新 acquire 或不同 active 的续期；跨社区事件拒绝 |
| 终态优先级 | P | closed 不被任何 enable/disable/撤销改写；disabled 收撤销仍保持 disabled，同时记住 tombstone |
| 续期 | P | 必须 expiry 实际增加、revision 增加、身份不变；旧 Generate expiry 不算续期，不能悄悄更换 secret/key/credentialId |
| 多社区 | P | 两个 gate 的 ticket 和 scope 互不混用；不声称有两个真实 TUN |
| 秘密隔离 | P | 公开 snapshot 和 JSON.stringify(gate) 不含 secret；这是 DTO 边界测试，不是对 Electron/日志系统的泄漏审计 |
| 本机观察 | P | 固定实例、runtime generation、IP、network、公钥指纹都一致；观察过期/重启失效 |
| 成员绑定 | P | 将真实字段形状的连接公钥与同 peer route 关联；route-only、闭合/未认证连接、管理员假冒、重复 key/IP、陈旧 provider generation 均拒绝 |
| 矛盾观察加固 | P | 同 peer 活跃认证连接出现不同公钥/身份类型时拒绝；闭合旧连接不构成矛盾。此项针对 adapter 混合采样，不是 ET 漏洞 |
| 防误显直连 | P | DIRECT 和 relay next hop 都不能让 physicalDirectVerified 变 true |

固定 fixture 的 secret 和 public bytes 不是密钥对，未加入任何 ET trust list。因此 P 不证明 X25519、Noise、issuer 身份或官方 credential provider 正确。

独立复核定位的两个 prototype 状态机问题已按本矩阵修复并增加回归。最终共 97 项测试通过。第三项矛盾观察已按上游实际保护降级为 adapter 防御，官方 `peers/conn/peer.rs` 的 `add_peer_conn` 已有公钥与身份一致性检查。

## 真实 provider 与服务端负面测试

| ID | 阶段 | 输入或故障 | 预期结果与证据 |
| --- | --- | --- | --- |
| A01 | A | 未认证/过期 JWT/非成员请求 grant | 不调用 provider，不分配 secret，稳定错误代码 |
| A02 | A | renderer/body 自报 admin/accountId/RPC 地址/管理实例 | 忽略或拒绝；身份和管理实例只从可信会话及 DB 解析 |
| A03 | A | native instance selector 为空、仅名字、匹配多个 | 失败，不自动选默认实例，不触碰私人 ET |
| A04 | A | Generate 超时后其实已成功 | 固定 id 恢复并 readback；不存在第二 credential |
| A05 | A | provider 已签发但 app DB 提交失败 | 补偿 revoke；失败则保留 reconciliation，不写“已清理” |
| A06 | A | 成员在 native 操作期间退出或封禁 | 迟到成功不交 main，撤销已创建授权 |
| A07 | A | 同账号设备两个并发 acquire | 每 scope 串行/幂等，单一当前 grant，readback 精确 |
| A08 | A | Generate 同 id 返回旧 expiry | 不能声称 renew 成功，转明确 same-key Upsert 流程 |
| A09 | A | Upsert 回 changed=false | 读回目标 expiry/policy 已满足则幂等成功，否则失败 |
| A10 | A | Upsert 超时、Revoke 与 renew 交错 | terminal revoke 不被迟到 Upsert 复活；必要时补偿撤销 |
| A11 | A | native 回 reusable 缺失或 true、allow_relay true、proxy cidr 非空 | grant 不进入 active；核查本次 provider 兼容性与补偿 |
| A12 | A | ListCredential 指纹与 private-key 派生公钥不符 | 拒绝配置/绑定，秘密只留私密边界 |
| A13 | A | 官方 int64 expiry 超安全整数、秒/毫秒误配 | 拒绝，不能授予极长有效期或立即误过期 |
| A14 | A | issuer credential storage 丢失/损坏后重启 | fail closed 并报告恢复问题，不能当作空 store 签发新世代 |
| A15 | A | managed_credentials 和 RPC 写同 id | 明确配置冲突，不忽略 native 拒绝 |
| A16 | A | Revoke success=false | 仅在正确实例 readback 已缺失时记幂等撤销；与传播完成分开 |
| A17 | A | 同 credential 同 key 两条物理连接 | 保持一个设备；不能误认为 credential 被两个 peer 复用 |
| A18 | A | 同 key 两个活跃 peer、相同 IP 两个 route | 成员绑定 pending/conflict，不择一随意显示身份 |
| A19 | A | ListPeer 与 ListRoute 读取期间 topology/runtime 改变 | 丢弃混合观察，重新采样，不能拼出虚假绑定 |
| A20 | A | 当前 CLI 只给 route/hostname，没有 Noise 公钥 | pending/unknown；不伪造认证结果，不退回客户端自报 |
| A21 | A | relay-only 路径没有公共 API 可取的端到端连接公钥 | 验证 provider 的真实覆盖，必要时实现窄结构化观察，不声称已支持 |
| A22 | A | raw NodeInfo.config、CLI Generate stdout、异常对象写日志 | 脱敏投影，无 secret/key/network_secret 泄露到日志/renderer/诊断附件 |
| A23 | A | 过期证据被另一个账号/社区重新提交 | 精确 scope+generation+revision 拒绝 |
| A24 | A | 网络断开、短暂 Socket 重连但仍是社区成员 | 仅保持未到期授权、有限续期重试；明确退出立即停，不无限授权 |

## 原生与整机测试

| ID | 阶段 | 场景 | 验收点 |
| --- | --- | --- | --- |
| N01 | N | 干净 Windows profile 第一次加入社区 | 无手写 TOML，正常 UAC，产品专属 TUN/IP/路由就绪 |
| N02 | N | 同时存在用户私人 ET | 端口/实例/配置/网卡不误认、不 kill、不删除 |
| N03 | N | 接受权限/拒绝权限/取消 UAC | 三条路径可恢复；拒绝后无隐形重试或全机权限变更 |
| N04 | N | 两个社区并发、相同子网候选 | 确认独立实例及地址冲突处理；单 owner 限制不能被 UI 掩盖 |
| N05 | N | ET 进程崩溃重启，peer ID 改变 | fixed instance UUID 保持；旧绑定和路径过期，重新观察，不改 reusable=true |
| N06 | N | reused=false 旧 peer 未收敛时新 peer 启动 | 测得 owner 收敛和恢复行为，不靠更宽权限绕过 |
| N07 | N | issuer 重启，凭据持久化存在/缺失 | 有持久化时恢复原授权；缺失明确失败，不能假装续期 |
| N08 | N | 凭据到期/撤销，含断网设备 | 区分本地 stop、issuer 移除、全网连接断开，量化传播窗口 |
| N09 | N | 休眠/恢复、时钟向前/向后调整 | 授权不会延长，恢复重验证，不长时间用陈旧路径 |
| N10 | N | 动态 UDP/TCP 打洞、IPv4/IPv6、对称 NAT | 验证实际应用级/接口级规则；不能只开放固定 11010 就宣称完整 |
| N11 | N | 退出/升级/崩溃清理 | 仅清理产品 owned handles/文件/网卡；检查残余且不影响私人网络 |
| N12 | N | 指定真实游戏，直 IP 和广播发现两种入口 | 游戏会话真的建立；ping 和虚拟 IP 不能替代此项 |

## 语音及屏幕边界

| ID | 阶段 | 场景 | 验收点 |
| --- | --- | --- | --- |
| M01 | N | 已加入社区但没进入语音房 | 不创建媒体发送/配对；ET 可以继续运行 |
| M02 | N | 同房间与跨房间 | 同房间授权成功；跨房间无媒体配对，LAN 身份不覆盖房间权限 |
| M03 | N | ET 不可用但 SFU 语音正常 | 继续既有语音服务，不为 ET 入网失败误断普通语音 |
| M04 | N | P2P 语音转 SFU | 实际暂停/恢复 ACK、RTP/解码证据、无重复播放 |
| M05 | N | 已绑定成员、ET route DIRECT，但 WebRTC 选中 TURN 或不同端点 | 界面不得显示媒体物理直连 |
| M06 | N | 屏幕正在发送时 ET 直连失去 | 屏幕数据面 direct-or-drop，SFU/TURN/ET relay 屏幕字节为零；语音独立恢复 |
| M07 | N | 15–20 总在线，4×5/2×10 房间 | 记录全客户端 CPU/上传/SFU 下行/断续；回放器与完整 SDK 数量分别报告 |

## 交付与停止条件

本轮的完成条件是严谨契约与可运行纯 prototype，不以 N/A 项通过为前提。来电后由 owner 按真实已授权范围逐项推进；未执行的项目保持待验，不把静态报告或 fake provider PASS 改写为 native PASS。

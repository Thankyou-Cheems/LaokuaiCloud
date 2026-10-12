# 唠蒯云社区 EasyTier 接口契约

## 结论与适用边界

建议按 owner 的四个模块划分实施：server 的 `communityGrant.ts`、`communityDeviceBinding.ts`，Electron main 的 `communityEtGrant.ts`、`communityEtConfig.ts`。现有 `easyTierCommunityIpc`、`EasyTierCommunityManager` 由唯一 owner 集成。本文件是基于固定上游源码的接口草案，不是已经接入产品的说明。

加入社区建立 ET 网络成员关系；进入语音房才授权麦克风或屏幕媒体配对。离开语音房不应销毁社区 TUN。加入 ET 虚网不授予跨房间听音、屏幕观看或管理员能力。

基准：官方 `8b7f1f0196edb5b580829ed5f135050fb5853478`；云端能亲见的私仓止于 `cb209bd24fd47f2d0ff6841e5032c118678c441f`；owner 指定、云端未见的实施基点为 `71b4f57ad2931e32690efbd8e9940122a112550d`。来电后先对最新源码做差异核对，不能把本包覆盖到最新文件。

## 已确认的官方协议事实

以下链接均固定到上游提交。它们比旧说明文档里的计划或示例优先。

| 项目 | 固定版本真实字段与行为 | 对实现的约束 |
| --- | --- | --- |
| GenerateCredentialRequest | groups、allow_relay、allowed_proxy_cidrs、ttl_seconds、可选 credential_id、instance、可选 reusable | instance 必须用 backend 固定的管理实例 UUID；明确传 reusable=false，不能吃默认值 |
| GenerateCredentialResponse | credential_id、credential_secret、expiry_unix | 不含公钥、指纹、peer ID、设备 ID 或虚拟 IP，不得造这些返回字段 |
| credential_id | 默认生成 UUID，也支持非空自定义管理 ID | 不可将其解析为公钥或由它推出设备身份 |
| ListCredentials | 每条有 id、groups、allow_relay、expiry_unix、allowed_proxy_cidrs、reusable、public_key_fingerprint | 可用于签发/续期后的权限与有效期回读；不返回 secret 或原始公钥 |
| 指纹 | SHA-256(解码后的 32 字节 X25519 公钥)，小写 64 位十六进制 | 不是对 Base64 文本哈希，也不是 hash(secret) |
| Generate 同 ID | 若已有有效条目，返回旧 secret 和旧 expiry，changed=false | 同 ID 重试是幂等恢复的一部分，不能冒充续期或策略更新 |
| UpsertCredential | 接受 id、secret、groups、allow_relay、allowed_proxy_cidrs、expiry_unix、reusable、instance；响应 changed | 可保持同 key 延期；changed=false 不等于失败，需要回读确认目标状态 |
| CLI | credential 子命令为 Generate / Revoke / List | 固定版没有 renew 或 upsert CLI 子命令；需要窄 RPC adapter，不能发明命令 |
| 管理配置与 RPC 写入 | Upsert/Generate 拒绝同 ID 的配置受管条目 | 选一种权威写入方式。最小方案使用 RPC base credential store，不同时用 TOML managed_credentials 重写同一 ID |
| reusable | 缺省 true；false 时根据当前活跃 peer 做唯一 owner 选择/抑制重复 peer | 同一 peer 多条连接并非多设备；重启 peer ID 改变要等待旧拓扑收敛。它不是硬件锁、不是一次使用即销毁 |
| SecureAuthLevel | None=0、EncryptedUnauthenticated=1、PeerVerified=2、NetworkSecretConfirmed=3 | 不存在 CredentialAuthenticated=4，不能写入这样的兼容假字段 |
| PeerIdentityType | Admin=0、Credential=1、SharedNode=2 | 本产品普通成员路径应同时检查 PeerVerified 与 Credential；不能把管理员身份借给成员 |
| ListPeer | PeerInfo.peer_id、conns、default_conn_id、directly_connected_conns；每条连接有 network_name、is_closed、noise_local_static_pubkey、noise_remote_static_pubkey、secure_auth_level、peer_identity_type | 可以取得连接级公钥身份；字段存在不等于现有产品 CLI 投影已经暴露 |
| ListRoute | peer_id、ipv4_addr、inst_id、next_hop_peer_id、cost，另有 latency-first 路径字段 | 没有公钥。route/DIRECT/hostname 单独都不能构成认证设备绑定或媒体直连证据 |
| NodeInfo | peer_id、ipv4_addr、inst_id、config 等 | 没有独立本机静态公钥字段；config 可能含秘密，不能进入普通日志/renderer |
| 内部 RoutePeerInfo | noise_static_pubkey、peer_id、inst_id、ipv4_addr 等 | 这是内部 peer RPC/OSPF 数据，不应假装已包含在公共 ListRoute DTO 中 |

来源：

- [官方 API proto](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-proto/proto/api_instance.proto#L355-L420)
- [真实 Generate 与 Upsert handler](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/management/instance_rpc/full.rs#L322-L388)
- [管理器 Generate 幂等行为](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/credential_manager.rs#L305-L338)
- [管理器 Upsert 行为](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/credential_manager.rs#L468-L542)
- [指纹算法](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/credential_manager.rs#L741-L748)
- [身份枚举与连接报文](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-proto/proto/peer_rpc.proto#L329-L340)
- [连接认证判断](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/conn/peer_conn.rs#L713-L782)
- [连接与路由 proto](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-proto/proto/core_peer.proto#L18-L64)
- [非复用 credential 的活跃 peer 选择](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/route/peer_ospf_route.rs#L1071-L1119)
- [CLI 支持的凭据命令](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier/src/easytier-cli.rs#L446-L486)

## 四个模块的最小责任

### communityGrant 服务端

1. 复用现有已认证连接/JWT 和真实数据库成员资格，不能相信请求正文里的 accountId、角色或管理员标记。
2. 用稳定的社区记录解析管理实例 UUID、networkName、networkRevision、受控 bootstrap profile、设备地址分配。客户端不能选择后台 RPC 地址或管理实例。
3. 按 `(账号, 社区, 设备, nativeInstanceId)` 串行化 grant 的创建、续期、撤销；为此维护持久化的操作意图、grant 状态和单调 revision。
4. 调用有限的 CredentialProvider 接口，签发后回读 native 实际政策和 expiry。RPC 超时属于结果未知，先按固定 credentialId 查询/恢复，不能盲发第二个凭据。
5. 在调用前后均检查当前成员资格/授权 epoch。调用过程中用户退出，不能把迟到的成功 grant 交给客户端；应对已签发 credential 做补偿撤销并跟踪结果。
6. secret 仅保存在授权的服务端私密存储/凭据 provider；不进入一般数据库日志、事件总线或异常字符串。不要仅因为 Node error 可序列化就向前端透传。

建议 provider 接口名称是本产品适配层，不是官方 RPC 名称：

```ts
interface CredentialProvider {
  inspectInstance(expectedAdminInstanceId: string): Promise<InstanceCapability>;
  create(request: CreateIntent): Promise<PrivateNativeCredentialReceipt>;
  extendSameKey(request: ExtendIntent): Promise<NativeCredentialReadback>;
  revoke(request: RevokeIntent): Promise<NativeRevocationReceipt>;
  read(credentialId: string, expectedAdminInstanceId: string): Promise<NativeCredentialReadback | null>;
  observeAuthenticatedPeer(request: ObservationIntent): Promise<ProviderPeerEvidence | PendingEvidence>;
}
```

`extendSameKey` 需要 adapter 能取得原 secret 并调用官方 Upsert。ListCredentials 本身不能取回 secret；不要假装只凭 id 就能 renew。旧密钥仅在私密边界内使用，不要求用户重新手写。fake provider 只能测试调用次序、错误和状态机，不能证明真实签发能力。

### communityDeviceBinding 服务端

expected 来自已生效 grant 的持久化记录，observed 来自固定管理实例的可信 provider。客户端提交的 peer ID、IP、hostname 或公钥只是提示，不是足够证据。

形成绑定需要以下交集：

1. 当前 grant 有效、未撤销，scope 和 revision 仍当前。
2. fresh connection evidence 的 remote public key 指纹等于 grant 登记的指纹；连接未关闭；普通设备是 `PeerVerified(2) + Credential(1)`。
3. 同一 `peer_id` 的 route 恰好一个，`inst_id` 等于预登记的本机 nativeInstanceId，虚拟 IP 等于分配值，networkName 一致。
4. 同 key 不同时属于多个活跃 peer；同 IP 不属于多个设备。多个连接属于同一 peer 则允许。
5. 观察的 provider runtime generation 和本次请求一致，采样在有效期内；旧实例/旧进程的观察不能拼接新绑定。

同一批 ListPeer/ListRoute 并非天然原子快照。真实 adapter 至少检查 generation 不变，并在前后采样存在变化时重采；可使用前后相同身份观察夹住 route 读取。无法取得连接公钥的 relay-only 情况返回 `pending`，不要把内部 RoutePeerInfo 字段塞入公共 DTO 冒充已有数据源。必要时加一个窄的结构化观察导出，但这是额外 adapter 工作，必须验收。

对同一 peer ID 的活跃认证连接，如果 adapter 提供了矛盾公钥或身份类型，整批绑定失败。此项防御针对混合采样/适配器错误：官方固定版 `Peer::add_peer_conn` 已拒绝同一 peer 的身份类型或公钥不匹配连接，不能据此宣称 ET 本身存在该漏洞。[官方连接一致性检查](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/peers/conn/peer.rs#L160-L189)

这些检查约束真实 ET credential 的使用，不提供硬件证明；掌握设备私钥的恶意客户端仍可能冒充该设备。无需为小社区引入硬件认证或新 PKI。

### communityEtGrant 主进程

- main 持有受信的账号/服务器会话上下文、设备标识和每社区 nativeInstanceId；renderer 只提出加入/退出意图。
- grant 请求直接在受控 main/认证通道完成。秘密响应不得先经过 renderer 再转交 main。
- nativeInstanceId 为本产品持久化的每账号/社区/设备实例 UUID，不是用户随手传的 UUID，不是管理服务器的 ET 实例 UUID，也不是 app backend 的 serverInstanceId。
- runtimeGeneration 是每次实际 core 生命周期的本地代数。重启可保留 nativeInstanceId，必须更换 runtimeGeneration、清空 peer/IP 观察并重新核实。
- 验证 requestId、scope、operation epoch、revision、networkRevision、有效期、policy 后才交给 config builder；过期、撤销、退出后的响应不得写盘或启动。
- 绝不能用网络失败触发“借用管理员账号”“改用主 network_secret”“回退私人现有 ET 实例”或“接受 renderer TOML”。

### communityEtConfig 主进程

- 输入是验证后的 grant 与本机固定模板，不是任意 TOML 文本。
- main 从已认证社区元数据取得网络描述，与 grant 对照。prototype 把这个步骤表示为 constructor 的 trustedIntent；不是要求用户手动提供这些值。
- 明确设置 network_identity.network_name 与 secure_mode.enabled，使用 credential secret 作为本机 private key，不写主 network_secret。固定源码会把“有 network_identity、secure mode 开启、无/空 network_secret”解释为 credential 模式。[配置加载规则](https://github.com/EasyTier/EasyTier/blob/8b7f1f0196edb5b580829ed5f135050fb5853478/easytier-core/src/config/toml.rs#L726-L741)
- peer endpoint 由已批准的 bootstrapProfileId 在受控模板内解析，普通 renderer 不传远程地址。issuer/relay 公钥 pin 与网络配置分别验证，不能由任意 URL 改写。
- 只使用产品目录、产品 binary hash、产品创建的配置文件。拒绝路径穿越、符号链接越界、用户提供的 helper/脚本路径。
- durable secret 使用已有安全存储；native 所需临时配置用严格文件 ACL 创建。普通 Node 日志、NodeInfo.config、CLI stdout、crash report 不得包含 secret。
- `reusable=false` 是管理员侧 credential grant 的政策，不是仅在客户端 TOML 加同名字段就能强制实现；通过 native ListCredentials readback 核实。
- main 将安全的连接状态送 renderer：社区、阶段、已核实虚拟 IP、错误代码。完整 grant、secret、raw config、原始 CLI 输出均禁止。

## 建议 DTO

下面是产品草案字段，不是伪称上游全部已有。字段名称可由 owner 对齐现有代码，但语义必须保留。

### renderer 到 main

```ts
type CommunityIntent = {v: 1; communityId: string; enabled: boolean};
```

采用 exact object validator，拒绝未知字段。账号、设备、实例、配置、凭据、command、path、peer URI 不接受 renderer 指定。真实 IPC 还要核对 senderFrame/top-level origin；纯 prototype 没有真实 Electron 环境。

### main 与 backend 之间的私密 grant

```ts
type Scope = {
  serverInstanceId: string; accountId: string; communityId: string;
  deviceId: string; nativeInstanceId: string;
};
type PrivateCommunityGrantV1 = {
  v: 1; requestId: string; scope: Scope;
  grantId: string; credentialId: string; revision: number;
  networkName: string; networkRevision: number; virtualIp: string;
  bootstrapProfileId: string;
  issuedAtMs: number; serverTimeMs: number; renewAfterMs: number; expiresAtMs: number;
  publicKeyFingerprint: string; credentialSecretB64: string;
  policy: {reusable: false; allowRelay: false; allowedProxyCidrs: []};
};
```

- scope、requestId、grantId、revision、networkRevision、bootstrapProfileId、设备地址与毫秒时间是产品字段。它们不来自 GenerateCredentialResponse。
- credentialId、secret、expiry 来自固定管理实例的 native 操作；expiry_unix 为秒，转换须检查 int64、安全整数与单位，不能把秒当毫秒。
- publicKeyFingerprint 来自 ListCredentials，并与安全边界内实际 X25519 公钥关系核对。prototype 不验证私钥→公钥关系；固定 fixture 的 secret/public 字节刻意不是密钥对。
- serverInstanceId 必须与本次受信 backend 连接的实例身份完全一致，不能把稳定社区 ID、host URL 和 server runtime instance ID 互换。
- revision 建议按该 scope 的 grant 生命周期单调递增并持久化；新 grantId 也不能把 revision 回退到 1，除非显式重新建立新 scope 并撤销旧状态。
- virtualIp 在第一版由 server 分配并以固定范围模板落地。它不是凭据 native 返回值。若选择 DHCP，则必须改成“运行后分配、观察后绑定”的单独契约，不能让两个方案混用。

### 向成员界面公开的状态

```ts
type CommunityPublicState = {
  v: 1; communityId: string;
  status: 'waiting' | 'granted' | 'native-observed' | 'expired' | 'revoked' | 'disabled' | 'closed';
  virtualIp: string | null;
  memberBindingVerified: boolean;
  physicalDirectVerified: false;
};
```

prototype 永远不把本机 NodeInfo 观察提升成服务端 member binding，所以 `memberBindingVerified` 在其公开状态中保持 false；独立 verifyDeviceBinding 的结果需要由集成 owner 接到真实 provider 后再投影。状态名只是测试草案，产品可沿用已有文案，不能靠改名代替缺失功能。

## 生命周期与异常处理

### 首次签发

持久化创建意图和固定 credentialId → 再核对成员资格 → 调用 native Generate → List 回读政策/expiry/fingerprint → 再核对本次权限与 scope → 提交 active revision → 仅给 main 私密回复。未知结果先恢复同一操作，不盲目二次创建。

如果签发成功后 app 数据库写入失败，使用已记录的固定 ID 补偿撤销。撤销失败则保留 reconciliation 任务和短期 expiry，不把它记录成已清理。不得在普通错误日志内附带包含 secret 的 native response。

### 续期

同一 grantId、credentialId、私钥、公钥、nativeInstanceId、networkRevision，更新 expiry；使用同 key 的 Upsert，并回读新 expiry 与完全相同的权限。一次 request 对应一个提交 revision。不能只增加 app 自己的 expiresAt，而 ET native expiry 仍旧。

RPC 超时但实际上写入成功，通过读回状态确认，不凭超时认定失败。服务端串行化同一 credential 的 renew/revoke，撤销一旦提交就是 terminal，不允许迟到的 Upsert 再把同一 grant 复活。必要时补偿 revoke，并保留状态直到 native 清理可核实。

### 时间和短暂掉线

不要要求用户电脑与服务器 wall clock 严格相等。main 结合可信 serverTimeMs 与本次请求 monotonic 时间建立保守到期 deadline；传输时间不能延长 TTL。prototype 扣除整个请求年龄，拒绝超过 30 秒的响应，并以接收时锚定的 wall/monotonic 双 deadline 处理暂停或时钟倒退。这些上限是草案，不是上游默认值。

续期提前进行并有抖动；临时网络失败保持尚未到期的既有授权并重试，不无限延期。明确注销、退出社区、封禁立即结束本地使用；单次 socket 短暂重连不应被误认为永久退社区。到期后停止 owned native 使用并清除当前成员绑定，不自动创建新授权。

### 撤销

scope-bound tombstone/terminal 状态先落地，禁止该 grant 的成功回复 → 向 main 发准确 grantId 的撤销事件 → 调用正确实例的 native Revoke → 回读缺失。`success=false` 只表示未找到，结合正确实例的读回才可作为幂等已缺失结果。

本地停止、issuer 撤销和全网传播断开是三个不同事实。不能在收到 Revoke RPC ACK 后立即宣称所有离线/远端连接都已断。 native 传播、连接关闭与 TTL 要另做真实验收。旧 grant 的迟到撤销不能误伤同 scope 的新 grant；跨社区事件应直接拒绝。

若当前没有 active、但新的 acquire 正在等待，旧 grant 的撤销只记对应 grantId tombstone，不取消这个未知新 grant 的 ticket。收到响应后按实际 grantId 拒绝已撤销项，同时允许不相关的新授权。只有命中当前 active grant 的撤销才取消其在途 renewal。状态优先级固定为 closed 终态优先、用户 disabled 意图次之；enable/disable 和迟到撤销不得改写 closed，disabled 收到撤销仍保持 disabled，并保留 tombstone 供下次重新开启核对。

### 重启和并发

- backend 重启：从持久化意图和 credential store 恢复，检查固定管理实例；不能把丢失 credential 文件当空库正常继续。
- main/core 重启：固定 nativeInstanceId 可恢复，core peerId 可能改变；旧 peer/IP/route 证据一律失效。不能沿用之前 true 的状态。
- reusable=false 不保证新 peer 在旧 peer 尚活跃时立刻获准。重启重叠时等待/清理旧 owner，不通过把 reusable 改 true 解决。
- 多社区使用独立实例/独立 grant/独立配置与冲突检测。当前旧产品只有单 owner，需要 owner 真正补实现；云端 prototype 的多个 gate 只证明状态隔离，不证明多个 TUN 已可共存。
- 账号切换、离开社区、native 重启、请求 supersede 均递增本地 epoch。迟到响应只可被忽略/补偿，不可写入新 scope。

## 物理直连与语音回退

社区已入网、设备已绑定、ET route 显示 DIRECT，均不等于某条媒体物理直连。接口不得从这些条件产生 `physicalDirectVerified=true`。

媒体要额外关联当前 PC/ICE generation 的 selected candidate pair、端点、接收媒体与 main-owned ET 路径。普通语音优先使用现有实际 SFU ACK/恢复机制；ET grant 失败不能关闭所有正常 SFU 语音，也不能绕过 voice room 权限。

屏幕只在已验证且数据面禁止回退的直连路径发送。没有 TURN、不送 SFU；若走 ET，还要在真实发送路径保证 direct-or-drop，不能只轮询 DIRECT 标签。此包没有屏幕实现、媒体传输或直连证明。

## 来电后的实施顺序

1. owner 核对 `71b4f57...` 的新源码，列出与旧 `cb209bd...` 的实际差异，再决定文件放置和命名。
2. 先移植 pure validators 和 fake-provider 时序测试；保持共享 IPC/Manager 由同一 owner 修改。
3. 实现真实窄 RPC adapter，固定实例选择，验证 Generate/List/Upsert/Revoke 字段和 JSON/protobuf 投影，不通过任意 shell 参数传 secret。
4. 实现 main 私密配置写入、系统权限、实际 native 生命周期和多社区隔离；运行专门原生矩阵。
5. 两台真实设备做社区游戏/注销/撤销/重启测试，再接入真实成员绑定和既有语音回退。
6. 屏幕媒体直连另行验收。任何 pure PASS 都不能提升 native/游戏/媒体的验证状态。

# MagicDNS 认证目录接线

2026-10-13：服务端源码已接入既有认证 HTTPS 目录，未部署、未启用 Windows/native DNS。
这是后端可信名字与生命周期接线，不是系统解析或游戏域名连接的验收。
不引入 Ed25519、CA、额外 bearer 或新的成员认证体系。

## HTTP 合同与旧版本兼容

仍用 `POST /api/community-et/directory` 及既有普通成员 bearer。
旧请求 `{v:1, communityId}` 仍返回完全相同的 `{v:1, communityId, members:[{serverUserId, virtualIp}]}`。
默认不会添加名字或 metadata，保持旧客户端 `exact` 解析器兼容。

新客户端显式请求：

```json
{"v":1,"communityId":"community-fixture","includeDnsNames":true}
```

成功时返回以下类型。新响应每条成员记录的两项 DNS 字段都必填：

```typescript
interface CommunityDnsDirectoryResponseV1 {
  v: 1;
  communityId: string;
  dns: { zone: string; serverTimeMs: number; maxAgeMs: number };
  members: {
    serverUserId: string;
    virtualIp: string;
    dnsName: string;
    dnsExpiresAtMs: number;
  }[];
}
```

`maxAgeMs` 固定 10000。`serverTimeMs` 是本次初始目录快照的服务端 UTC 毫秒。
`dnsExpiresAtMs` 取初始采样时间＋10秒、当前 session expiry、已经确认的 grant expiry 三者最小值。
异步权限检查后的第二次 store 回读还可缩短该期限，但不以权限查询结束时间重新延长初始快照。
客户端应按相对期限减去整个请求耗时，再用本机单调时钟约束缓存；不要要求客户端与服务端 UTC 完全相等。

`includeDnsNames` 只接受字面值 `true`；`false`、字符串、`null`、显式 `undefined` 均拒绝。
成员不能在请求中提交 hostname、zone、dnsName、身份或过期时间。响应继续 `no-store`，沿用原请求限速与严格解析。
无认证 401，其他社区 403，权限/DB/状态错误按既有 allowlist 返回；不泄露内部异常或私密数据。

canonical DTO 与 parser 位于 `components/server/src/easytier/communityGrantApi.ts`。
新增 `CommunityDnsDirectoryMemberV1`、`CommunityDnsDirectoryResponseV1`；`CommunityGrantApi.directory` 返回 legacy/DNS 两种响应 union。
客户端 `communityEtHttpContract.ts` 已同步此扩展；后续 V2 中继 DTO 独立演进。
未发现独立合同生成脚本，不能声称已经自动生成。

## 持久名字与原数据

三张新表使用 `CREATE TABLE IF NOT EXISTS`，不重写原 ET 设备、IP、grant、session 或清理账本：

- `community_et_dns_zones`：社区对应随机、唯一的 `c-<32hex>.lan.voice.ruikang.wang.` zone。
- `community_et_dns_devices`：账号＋社区＋设备对应随机 `d-<32hex>` 标签，社区内唯一；完整名字为标签＋zone。
- `community_et_dns_session_auth`：当前 session 的 server/user token version，使用现有 vault key 加密并绑定 session ID。

zone/标签分别取 16 个随机字节，名称不从当前 IPv4、昵称、账号 ID、机器名或凭据推导。
SQLite 唯一约束仍拒绝冲突，最多重试 8 次；存储内容不符合固定名字语法时拒绝 DNS 响应。
同一账号多个设备各有自己名字及 IP，不发布账号快捷名、多 A 自动选择或“最新设备”名字。

映射保存在原 SQLite 数据卷中。已验证真实 SQLite 文件关闭后重新打开，名字、zone 和原设备行保持。
同一设备 token/session 轮换及受控地址变化不改变别名。撤销/过期只从响应移除名字，不删除预留或将名字转给别人。
不需要新的 HMAC key，因此没有 DNS key 轮换改变名称的问题；现有 vault/session 恢复仍服从原加密系统的规则。
数据库丢失、重建或删除这些映射不保证名字稳定；备份与生产回滚必须保留这些表。

原 `sealed_session` JSON 的七项字段保持完全不变，旧服务端仍可读取新创建的核心会话。
新 DNS 版本元数据放在独立加密表，避免旧服务端 `exact` reader 拒绝扩展后的 JSON。
旧 session 缺少 DNS 元数据时仍可提供 legacy IP；需要通过现有 `/session` 重新验证后才发布 DNS 名称。
元数据认证失败只影响 DNS 请求，已验证 legacy directory 与真实服务方法的 own-device binding 仍可使用。
将来明确重置社区时应决定是否保留名字预留，并清理已退休 session 的 DNS 元数据；本轮没有执行数据清理。

## 认证、撤销与时间边界

请求前后检查当前请求者身份和成员准入。DNS 候选必须满足：

1. 当前 sealed session、scope 账本及 epoch 一致，session 尚未过期；设备/native instance/IP 仍匹配原分配。
2. grant 为 active，IP/网络配置仍一致，确认期限尚有效。same-key renewal 只使用原确认期限，不能借用正在申请的延长期限。
3. session/grant 的确认时间不在当前服务器时钟的未来；服务器时钟回退时不发布未来证据。
4. 从当前成员表检查每个候选账号/serverUserId 仍有效，并匹配原 session 的 server/user token version。
5. 异步读取权限后重新检查 grant/session/epoch/IP；途中撤销或替换会话不能保留旧 DNS 回应。

版本元数据来自已有验证后的 bearer claims，不是请求体声明。移除远端成员、提升用户 token version、
撤销 grant、会话过期或 DB 无法确认时，DNS 名字失效。权限查询异常拒绝整份 DNS 响应，不能把未知权限当允许。

客户端已接全量替换缓存、取消/认证代次保护、固定社区范围及外层查询失败清除。
单凭 10 秒轮询无法立即清除 OS/游戏已有缓存；名字失效也不等于已有连接或游戏数据包被阻止。
这里的记录只证明可信地址分配，不证明设备在线、端口可达或物理直连。

## 本地验证

使用现有满足后端依赖 engines 的 Node 22.23.2，从 `components/server` 运行：

```powershell
& 'C:/Program Files/nodejs/node.exe' --test --require ts-node/register src/easytier/communityGrant.test.ts src/easytier/communityGrantApi.test.ts src/easytier/communityGrantRouter.test.ts src/easytier/communityGrantService.test.ts src/easytier/communityDeviceBinding.test.ts src/easytier/communityCredentialProvider.test.ts src/easytier/communityRpcWire.test.ts
& 'C:/Program Files/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit
```

108 个 EasyTier 契约/真实 SQLite/内存 HTTP 对象测试通过；无生产连接、native core 或 OS DNS 操作。
定向 ESLint 与完整 server no-emit 类型检查通过。
验证覆盖旧 DTO 精确兼容、严格 opt-in/hostname 注入拒绝、持久名字、跨社区隔离、多设备、
session/token/version/grant 撤销、异步撤销竞态、原 sealed JSON 回滚兼容、可选 DNS 故障隔离及服务器时钟回退。

本地首次类型检查暴露 `Object.hasOwn` 与当前 TS lib 不兼容，已改为 `Object.prototype.hasOwnProperty.call`。
首次新增夹具也发现新 token 的未来 iat 与 idempotent session 的期限构造问题，修正夹具后重跑通过；
没有为测试放松产品认证或修改实际 token 期限。

## Windows 客户端接线与真实验收边界

服务端只发名字；native `accept_dns` 保持关闭。主进程自己的解析器只监听
`127.0.0.153:53` 的 UDP/TCP，仅回答认证目录所属后缀，不递归、不接受 peer hostname。
Windows helper 使用 NRPT 为当前 `.<community-zone>` 指向这个地址；不改物理网卡、
全局 DNS 或 hosts，不安装持久服务。具体行为受本机“MagicDNS”偏好控制。

规则操作先写本机随机归属账本，再调用固定 WMI 方法；已有同后缀/祖先/后代冲突
拒绝接管。删除必须完整名称、服务器地址、归属和属性仍匹配。退出、离开社区及
下次启动崩溃恢复都清理自己的规则；即使关闭偏好，下次启动仍会处理旧账本。
规则无法准备时不展示可用域名，数字 IP、普通 ET 和语音不因此退出。

目录请求每约 5 秒刷新，缓存期限按请求耗时扣减并同时受单调/墙钟约束，DNS回答
TTL 最长1秒；失效后拒绝旧记录。成员域名复制还需本机解析策略已准备、记录未过期
及认证 IP 归属一致。自己的行只显示当前设备，多设备成员分别列出设备地址。

25项主进程 fake-I/O/临时账本检查、Windows CLR helper纯夹具（未创建 WMI 对象）、
成员目录/复制与 runtime 接线检查通过；没有把这些写成实际系统解析通过。

生产部署、Windows 系统 resolver、真实游戏进程、两个设备/多个社区同时解析、DNS缓存撤销、
私人 ET 共存和退出恢复均未在本轮执行；服务端契约通过不能升级成这些验收已通过。

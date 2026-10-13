# MagicDNS 离线预研发

此目录是独立参考模型，未被客户端、后端、构建或 .6 测试包导入。
不会打开 socket、启动 ET/TUN、修改 Windows DNS/hosts/防火墙或访问生产。
用户继续测试已交付的 .6；本目录不改变该版本。

从 `D:\Dev\LaokuaiCloud` 用 PowerShell 7 执行：

```powershell
& 'D:/Dev/LaokuaiCloud/.local/toolchains/node24/node.exe' --test experiments/community-network/magicdns/model.test.mjs
```

17 个契约测试通过，依赖仅 Node 内置 `node:crypto`、`node:test`、`node:assert`。
测试全部使用合成身份、地址、时钟及临时内存密钥，不读取真实 profile 或凭据。
首次测试发现夹具试图修改已冻结 envelope；改为复制后篡改，复跑通过。不是产品失败证据。

## 模型边界

`model.mjs` 分两个纯逻辑入口：服务端 authority 把**已认证的服务端 session/grant/device 数据**转成别名目录；
客户端 cache 将完整目录转为带期限的查询结果。authority 并不实现成员认证，不能被 renderer、peer
广播或普通 HTTP 请求直接调用。`authenticated:true` 之类声明不能取得这项权限；额外 hostname、nickname、
peer 字段、accessor、原型继承及重复归属被拒绝。

未来生产的权威边界优先复用现行认证 HTTPS 社区目录及成员 session。
当前生产 `/directory` 只有成员 ID 与 IPv4，尚无稳定设备别名、会话期限/撤销代次这些完整字段；
不能仅从 IP 推出设备身份，也不能从现行字段冒称已经实现本实验的协议。

本模型为检查离线快照篡改额外附带一个 Ed25519 envelope 夹具。
它是**可选的离线研究手段**，没有 CA、证书、网络密钥分发或生产 PKI；不要求未来生产增加签名协议。
真实 HTTPS adapter 可以在既有认证、社区 scope 与取消能力边界内提供同等“已认证完整目录”，
届时应删除或隔离这个签名夹具，而非把测试用 key 或 envelope 格式移植成必需产品架构。

## 名字与设备

名字采用专用服务端 HMAC key 派生的 128 位标签：社区 zone、账号标签 `u-…`、设备标签 `d-…`。
HMAC 输入包括服务实例、社区和用途，设备标签绑定账号＋设备，session 轮换不改变设备名。
对外记录没有原始账号/device/session ID；账号标签仍可把同社区的设备关联起来，这是化名而非完全匿名。
客户端及成员不能指定名字或改占其他成员的记录；重复设备、地址、会话和设备标签拒绝发布。

实验域名以 `c-….lkc.invalid.` 结尾。`.invalid` 只用于表达和离线测试，**不是可用游戏地址**，没有写入 UI。
真实 zone 的选择、原生配置和系统解析另行设计、验证；不会默认占用整个 `et.net.`。

每设备一个 IPv4。一个账号仅有一个有效设备时，账号快捷名可以返回该设备；同时有多个设备时返回
`ambiguous` 及具体设备选项，不能随机挑最新设备或自动回多个 A 记录让游戏选错机器。
native DNS 接入时，这种账号快捷名应返回无 A 答案；具体设备名字仍可正常查询。
同账号多设备使用不同地址，保留现有分配机制。

稳定性取决于服务端专用 namespace key 及设备身份保留。删除 profile、换设备或更换 key 会改变派生名。
生产落地应持久化首次签发的 zone/设备别名映射，加入唯一约束、key version 与历史保留；
轮换 key 时保留已签发映射，用新 key 创建新设备映射，不能重新推导并覆盖所有既有名字。
如果需要撤销旧别名，应显式保留 tombstone，禁止把旧名字重分配给另一账号。
当前模型仅证明同一 key 的确定性，没有实现数据库、key 轮换迁移、旧 key 恢复或别名回收。

## 有效期与撤销

完整目录替换旧目录，缺席记录立即撤除。服务端仅发布 active session/grant、匹配当前授权代次、
未撤销且尚未过期的设备；授权会话撤销不会被继续使用同一旧 session 的更新复活。
设备有效期取 session、grant、目录三个期限的最小值，不把凭据延长中的未来期限当已生效期限。

cache 将最大 10 秒目录 TTL 扣除完整请求耗时，分别受本机 monotonic 与 UTC 两个截止时间约束。
服务器 UTC 偏差不要求两边时间相等；本机时钟回退清除旧目录，UTC 跳到未来不能延长记录。
不到一秒的 DNS TTL 使用 0，不向上舍入。真实解析器及游戏缓存行为仍需测量。

请求能力与当前认证代次绑定，新请求退休旧请求；旧 callback 既不能恢复过期记录，也不能清空新的目录。
离线夹具还检查请求 nonce、目录 revision 和单次使用，记录掉线后不以查询时间重新变成新鲜。
这些是能力/排序原则，不要求生产新增字段：真实 adapter 可以复用主进程已有 epoch/cancel/request 能力。
生产 revision 持久性、服务端重建及账号权限撤销通知如何保证仍待确定。
仅靠 10 秒轮询 TTL 不可能立即撤销游戏进程已经缓存的地址，也不等于能阻止后续游戏数据包。

## 固定 native 与 Windows 接入设计

复用已有审视：native 源 `089b6182c603c8ab60044b673effe0cf614cc28a`，
`components/easytier/receipts/modern-static-build.json` 已包含 `magic-dns` 与 `tun`。
`source/easytier-core/src/config/toml.rs` 默认 `accept_dns=false`，当前产品未开启。
`source/easytier/src/instance/runtime_host/magic_dns.rs` 按该标记创建任务。
这证明固定版本有实现能力，不证明现行 Windows 应用具备本实验的账号解析。

原生默认记录来自路由 hostname；其入口必须改成只发布社区 authority 提供的设备别名与分配，
否则成员仍可自报 hostname 占用名字。既有 `CorePacketPlane.register_magic_dns_resolver` 是候选接入点，
需核对网络内 hostname 注册、跨 instance DNS 汇聚及默认路由记录是否可彻底隔离。
本实验没有修改 native，尚未证明无需补丁即可完成这个接入。

Windows 设计应分成以下阶段；均未在本轮执行：

1. 用主进程认证社区能力取得目录，启动只作用于该社区自有 ET 实例的解析器。
   DNS 故障只撤除名字信息，不注销社区、不停止游戏 LAN 或语音。
2. 确认具体自有网卡 GUID/LUID、native generation 及 profile 所属，捕获其 DNS 设置、SearchList、
   EnableMulticast 原始值与“值不存在”的状态，写入私有可恢复账本；不捕获/提交其他网卡凭据。
3. 在真实网卡接入前确定 Windows 的查询路由范围。现 native 仅修改自有网卡 DNS/SearchList，
   不能直接宣称按 zone 的系统 split DNS 已成立。普通域名应保持已有解析路径，
   `.lkc` zone 不应跨社区；不能因为启用虚拟 DNS 就接管全部物理网络 DNS。
4. 应用 DNS 变更后通过 Windows 系统 resolver 与真实游戏进程读取具体设备域名，
   检查 1/2 设备、两个社区同时运行、已有私人 EasyTier、物理网络 DNS 共存及短 TTL。
5. 正常退出先退休查询能力/记录，再按账本还原自己改过且仍完全符合期望的设置。
   GUID/LUID、generation、属性任何不匹配都停止还原并保留恢复证据，避免覆盖用户或第三方新设置。
6. 崩溃恢复先识别上一轮归属，再恢复尚存的同一网卡；网卡已移除时不把设置写到同名新网卡。
   恢复成功前不启用新 DNS。若需要管理员更改，沿用正常管理员应用边界，不增加服务或绕过 UAC。

固定源 `source/easytier/src/instance/dns_server/system_config/windows.rs` 会设置自有网卡
`NameServer`、`SearchList`、`EnableMulticast` 并执行 `ipconfig /flushdns`，但其 `SystemConfig.close()` 返回空成功，
没有恢复这些值。自动开启前必须补齐上述归属与恢复设计；TUN 删除不能替代可验证的恢复证据。
本模型不执行这些命令，不含可调用 OS 接入代码。

## 仍未解决

- 实际生产 alias DTO、专用 key 存储/轮换及持久映射；HMAC 碰撞的数据库唯一性和受控迁移。
- 原生仅接受 authority 记录的实现、社区 zone 汇聚边界、Windows DNS 路由及退出/异常恢复。
- 多设备友好显示名与具体游戏设备选择；无需暴露 device ID 的可靠命名体验。
- 权限撤销后浏览器/系统/游戏缓存的上限、负缓存、DNS poisoning 面及物理网络断开时的恢复。
- 真实 Windows resolver、游戏进程、两设备/跨社区/native 共存验收。

17 个离线契约通过只能说明参考模型的这些边界，不能称为 MagicDNS 已启用、系统已能解析或游戏已可用。

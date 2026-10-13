# 成员虚拟局域网地址

2026-10-13 本地源码实施与轻量验证记录。未部署后端，未启动真实 ET/TUN、修改系统 DNS 或验收双设备游戏连接。

## 本轮行为

成员行在联机状态旁显示可点击复制的 RFC1918 虚拟 IPv4。本机地址来自已校验身份的自有 ET 实例；
另一成员的地址只来自该社区 HTTPS 后端的认证目录，不采信昵称、在线状态、物理端点、语音数据或客户端自报。
复制成功/失败有提示；复制按钮保持键盘可用，点击不会打开成员卡片。

同一账号多个设备各有不同 IP，成员行逐个显示，不任意选择“最新设备”。本机行仅显示当前设备。
多地址成员不借用其中一个 peer 的路径作为所有设备的路径。目录返回身份与分配，未证明真实连接，
因此无 peer 证据的成员显示“地址已分配”，不显示绿色“已入网”；详情说明端口可达性尚未确认。
路径、RTT、WebRTC 媒体与地址分配继续独立。

目录每 5 秒至多查询一次，采用本机请求开始时间记录年龄；其他 ET 轮询不会更新缓存的年龄。
目录独立 1 秒超时、错误或格式错误清空远端地址，超过 10 秒的分配证据隐藏；真正的外层取消仍向上传递。
401/403 保留既有认证失效处理，
退休自有实例；普通后端目录故障仅失去地址信息，不关闭活跃 ET。停更、社区切换、歧义和无效地址保持保守。

## 稳定地址与多设备

现行服务端已在 SQLite `community_et_devices` 中按 `account_id + community_id + device_id`
持久分配 IP，并对社区内地址及 native instance 建立唯一约束。本轮没有迁移分配表、替换 IP 池或改变凭据授权。
正常应用/服务器重启、相同设备身份重连、凭据轮换保留分配；撤销或过期后目录隐藏地址，数据库仍保留预留。
测试重开 store 验证设备分配保持，两个同账号设备分配互不冲突，native identity 替换被拒绝。

这是账号与设备共同绑定的稳定性。删除/更换客户端 profile、换电脑或新增设备会生成新的设备身份，
不能保证仍取得原地址；同账号多设备不能共用一个 IPv4，否则会形成路由冲突。
当前池最多 254 个地址，设备预留暂无回收策略；未声称满足无限成员或重装次数。

## 最小后端部署准备

新增 `POST /api/community-et/directory`，请求仅 `{v:1, communityId}` 加既有成员 bearer。
响应仅 `{v:1, communityId, members:[{serverUserId, virtualIp}]}`；同账号可出现多个设备记录，IP 必须互异。
不包含 account/device/native ID、peer ID、物理 IP、凭据或私钥。要求请求匹配此服务的社区配置，
前后重新检查当前请求者的成员权限；仅列出未过期 session、活跃 grant 和原始设备分配一致的地址。
响应 `no-store`，沿用既有请求限速及 4 KB 严格请求解析；不增加 native RPC 或凭据写操作。

待批准的生产变更只需重新构建并替换 Gryt server 镜像，新增源码位于：

- `components/server/src/easytier/communityGrantApi.ts`
- `components/server/src/easytier/communityGrantRouter.ts`
- `components/server/src/easytier/communityGrantService.ts`
- `components/server/src/easytier/communityGrantStore.ts`
- `components/server/src/routes/ownJsonParsers.ts`

现行 Gryt 镜像 `9ddd8f97` 没有目录路由：新包仍能复制本机 IPv4，另一成员的目录地址不可用，
不能把本轮本地实现写成生产已启用。部署时必须保留既有 SQLite 数据卷及私密配置，
`VOICE_MAX_USERS=12` 和 `/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json`。
不需要 SFU 镜像替换、ET 重启、新端口、新 DNS 服务、系统 hosts 或防火墙/路由修改。
本轮没有执行部署；生产升级后的认证目录、两台完整客户端复制与游戏联机另行验收。

## MagicDNS 核对

固定 native 源 `089b6182c603c8ab60044b673effe0cf614cc28a` 的
`components/easytier/receipts/modern-static-build.json` 明确包含 `magic-dns` 与 `tun`。
native 确实具备 MagicDNS，不需要凭空另建一个 DNS 服务。但该能力不等于本应用已启用：

- `source/easytier-core/src/config/toml.rs` 默认 `accept_dns=false`，默认区域为 `et.net.`；
  当前客户端 `communityEtConfig.ts` 没有开启 DNS，也没有按认证账号提供 hostname。
- `source/easytier/src/instance/runtime_host/magic_dns.rs` 仅在该标记开启时启动解析任务。
  默认记录来自路由 hostname，不是本应用的账号认证目录；仅设置昵称不能获得可信账号别名。
- `source/easytier/src/instance/dns_server/system_config/windows.rs` 通过自有网卡 GUID 设置
  `NameServer`、`SearchList`、`EnableMulticast` 并刷新 DNS。仅有 UI 域名或 TXT 配置不能证明 Windows 游戏可解析。
  当前 `SystemConfig.close()` 本身不恢复这些设置；未来启用前须单独审视本应用网卡生命周期和异常退出恢复。

后续可利用已有 native 能力做社区内解析，先规定社区隔离的 DNS zone、服务端签发的稳定账号别名、
每设备唯一名字、同账号多 A 记录的产品含义及撤销/过期缓存规则。
账号名字不能任意指向“最新设备”；游戏默认应能选择具体设备。
验证需包括 Windows 系统解析、真实游戏进程、两设备冲突、跨社区隔离与退出恢复。
本轮没有展示可复制域名，避免把未经操作系统解析验证的名字当成可用 MagicDNS。

## 本地验证

- `tools/check-core-contracts.ps1`：25 组通过（固定 Node 24.10.0；包括成员模型 16、ET 38、runtime 57 场景，
  主进程与完整 renderer 类型、i18n 及无提权 Windows broker 管道夹具）。
  后续新增目录独立超时回归，runtime 58 场景通过。
- 新后端 API/router/service 与 `routeJsonLimits.test.ts`：50 个测试通过；覆盖 scope、认证失效、客户端身份/IP注入拒绝、
  多设备、稳定分配、过期、撤销和路由解析清单。后端 `tsc --noEmit` 及客户端/后端定向 lint 通过。
- 后端依赖通过固定 Yarn `--frozen-lockfile --ignore-scripts` 安装，未改锁文件。
  本机固定 Node 24.10.0 不满足现锁 `jsdom@30.0.1` 的 `^24.15.0`，改用已安装、符合其 `^22.22.2` 的 Node 22.23.2。
  未跳过引擎检查、未更新依赖。该版本选择只用于本地后端检查，不修改生产镜像。
- 首轮路由解析测试 49 个断言通过，但 Windows 临时 SQLite 未关闭导致清理 `EBUSY`；
  测试 teardown 现先关闭 fixture DB，再清理临时目录，重跑完整测试通过。该失败没有涉及产品数据。

这些是源码/夹具验证；复制 UI 实际布局、生产认证目录、真实多设备 ET、游戏端口及 MagicDNS 尚未验收。

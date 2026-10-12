# 首设备真实范围，待父集中批准

本文件为可审查执行范围，不是已批准部署指令；没有执行生产写入。原两设备/额外 issuer/旧15889提案失效。首轮只用本机当前真实社区成员；第二账号/设备未指定，不纳入，也不阻塞第一设备。真实 SDK P2P 的两设备验收另留 pending。

## 已只读确定

- 腾讯云既有 `cheems-p2p`（host networking）真实官方2.7/11014/127.0.0.1:15890。`network_name=CheemsP2P`、`private_mode=true`、`relay_network_whitelist=*`；复用此网络和当前 network secret，不改成另一网络/无条件共享中继。私网 `easytier`2.6.4/15888和管理 Web保持。
- backend `laokuailiao-server` 是 `gryt`，容器与宿主真实 UID/GID **1001:1001**，gryt-voice bridge，现有唯一数据挂载 `/opt/stacks/gryt/data:/data`。native持久目录既有 `/etc/easytier-cheemsp2p:/root:rw`，root0运行。只输出公开参数，未读 native配置文件/key/credential或账户 profile。
- 候选 **10.203.217.0/24**、首设备 **10.203.217.2/24**。本机当前具体路由10.14/16、10.15/24、10.16/24、10.126.126/24、192.168.31/24、172.23.160/20、198.18.0/30及云端10.0.4/22、10.8.8/24、10.14/16、10.15/24、10.16/24、10.126.126/24、172.17–21/16均不重叠；默认路由不当作所有网段冲突。启动前仍需只读复核新学习路由。绝不删旧接口/按接口名杀进程。

## 管理通道确切落点

固定 host AF_UNIX `/run/laokuai-community-et/public-management.sock` → host `127.0.0.1:15890`。该 socket/父目录实际均不存在；云端无socat，已有Python3.11.6。拟使用普通受限 host service `laokuai-community-et-management.service`，service文件 `/etc/systemd/system/laokuai-community-et-management.service`（root0644），程序 `/usr/local/libexec/laokuai-community-et-management/proxy.py`（root0644、所在新目录root0755，使用已有 `/usr/bin/python3 -I`），User/Group1001，RuntimeDirectory `laokuai-community-et`模式0700，socket1001:1001/0600。这个新程序落点避免给UID1001增加整个 `/opt/stacks/gryt` 的遍历权限；不改原项目目录权限。service拟设NoNewPrivileges/ProtectHome/ProtectSystem=strict，仅RuntimeDirectory可写，网络仅AF_UNIX及loopback15890。

只给现有 backend 加只读目录挂载 `/run/laokuai-community-et:/run/laokuai-community-et:ro`（连接Unix socket不需要文件写入）；服务仅连接现有15890，不新建TCP监听、不开放公共RPC、不授Docker socket/root SSH/namespace权限。server源只消费该固定已批准socket，不创建服务；安装/代理源码审查和实际健康检查尚未执行。父批准后先审查这个普通helper和service，再部署，不能假设“已有长期通道”。

public Admin 稳定UUID保持 `e2a5bd9d-47bb-4120-8589-e6898112ae85`；计划在现有root挂载下新写 `/etc/easytier-cheemsp2p/laokuai-community-admin.toml` 和 `laokuai-community-credentials.json`（容器 `/root/`同名），root0600。TOML在批准后本机云端就地生成持久X25519 key，不打印/发给backend；保留原secret/flags/11014/15890。backend只存本次个体credential secret的加密SQLite，不读取上述Admin文件。只重建该public service及精确新backend；不全栈up/down。

## 确认的2.7兼容语义

固定源码 `config/mod.rs::normalize_secure_mode_config` 会在启用secure且未给key时生成新的X25519 pair，因此必须持久化Admin key。`config/toml.rs::new_from_config` 以secure+缺network_secret判credential；持有既有secret的public为Admin，不是按容器名分类。

`PeerConn::do_handshake_as_server_ext` 虽仍接收旧HandShake，**`peer_manager::add_new_peer_conn`明确拒绝同网两端secure开关不同**。启用public secure使旧CheemsP2P非secure客户端不能再同网加入；旧secure客户端也需正确secret或被信任credential/issuer pin。foreign manager继承parent secure，仍受private_mode(secret或已建立network的trusted credential)及原whitelist双门，不能保证旧foreign relay无影响。原whitelist*不绕过private_mode。当前只读/历史升级未验旧远端客户，不能承诺兼容或零中断。重建至少短暂断开public连接；回退必须包含原public配置/镜像与新增Admin状态备份，不能只执行旧升级rollback覆盖后续配置。

## 本机应用与凭据范围

只用精确当前app-owned core `f716a1139d66800bbc75daa200b1c0c6eecccb97e88e13167fafb8d7d38bb81d` 和CLI `1ad46380937aab6dd7385ebb37bb458c94f8d1a3e68baf2e6c24ea973adc6411`。一个owned UUID/TUN，IP10.203.217.2/24；固定TCPbootstrap `124.221.119.113:11014`，core自身管理RPC仅127.0.0.1动态独占端口/whitelist127.0.0.1/32，listeners=[]。不修改默认路由/exit-node/proxy routes，不替换driver，不允许全局防火墙/profile关闭；系统权限不足由父处理真实管理员授权，不绕过UAC。

应用规则若系统需要新增，只按**这个确切core路径+hash**：到既有bootstrap的TCP11014、该core的UDP STUN/打洞临时端口及其返回流量；CLI仅本机loopback。真实普通app HTTPS443/WSS/SFU语音仍属于已有应用流量。规则用本次唯一名，退出只删除自己新增的确切规则ID；不能开所有程序/整个bridge或公共管理端口。

当前冻结配置没有关闭默认STUN/UPnP。固定2.7默认UDP STUN为 `txt:stun.easytier.cn`、`stun.miwifi.com`、`stun.chat.bilibili.com`、`stun.hitv.com`；TCP STUN为hot-chilli/fitauto/lifesizecloud/Twilio/Cloudflare/blackberry/radiojar，IPv6 `txt:stun-v6.easytier.cn`。DNS/TXT解析可变化，不能给它们虚构固定IP；UDP与TCP打洞、SSDP1900/路由器UPnP映射操作并未被source禁用。**这些默认流量与可能的UPnP修改必须被父显式纳入批准，或先交最小普通config变更关闭UPnP再重冻；当前不假称只TCP/不改路由器。** 第一设备无第二peer，不以此声明实际P2P验收。

一份member credential：TTL300s、allowRelay=false、reusable=false、allowedProxyCidrs=[]。server自动renewAfter=TTL×0.6=180s；首轮从第一次acquire开始由真实执行owner加**330秒owned-core watchdog**，最多一次成功同key续期（下一次约360s，不到它），任何auth/native/续期错误立即结束、不重试一轮。首次与续期native expiry都必须实际读回，最晚不得超过首次签发+600s；不能仅靠文档计数。停止后同一有效auth执行Revoke/List absent回读，未知保持pending。不要先让backend approval过期而挡住其revoke；停止与撤销完成后再收回write approval，紧急失败则owner做明确native对账，不能称已撤销。

330秒是本机native活动上限，600秒是credential绝对有效期上限。server/community ET生命周期独立于切voice房间。结束精确owned PID/handle、观察owned TUN/portal/规则残留、删除自己的临时TOML与已确认撤销的secret；保留真实用户profile与别的ET进程/路由/规则。新backend/client构建、实际service/helper权限核验、Admin/persist/readback、TUN/网络保护与cleanup、SDK完整真实验收均尚未执行。

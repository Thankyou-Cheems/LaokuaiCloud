# 主社区两服务实际测试候选

本次最小上线只升级既有 Compose `laokuailiao/server+sfu`。用户已表达普通部署与实际测试意图；本交接没有执行生产切换，不把 ET 接线、设备激活或最终公开发布绑在普通语音上线前。操作入口 `cutover.py` 已用8项纯范围检查验证；Docker/目标端阶段须由父指定部署 owner 执行。阶段和报错均不输出 env、账号、密钥、数据行或完整 Compose。

|输入|准确标识|
|---|---|
|backend 源码|85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d / tree96db8312488c4f399904192f3a932232cf6130ad|
|backend OCI/config|e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba / e8747cede11f23df31cb9c190362a63dcf2873c12d7162926934a67e32372367|
|backend TAR|server-85ec3b9c-linux-amd64.docker.tar，111582720B，SHA2569dde30f81c4daf6cffa0e5d63a98b37951b55e55f5d19fda76fda17bda944453|
|SFU 源码|011f12b92af2732cc6a86a088c5f753dfd5c1a14 / tree3d64d5904681d59590be940870ce045e5c1577ff|
|SFU OCI/config|d38ed22ddbed419661ba20b2c0bf008b18d07e05446c0c813c05a022883aafc6 / 2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f|
|SFU TAR|sfu-011f12b9-linux-amd64.docker.tar，10624000B，SHA256102fba9de73bb8eb9cb5e47171e5938330635a9dc827e27085ea800a632ceaaf|

本地 backend TAR 位于 `2026-10-12/task/hybrid-backend-sfu-85ec3b9c-build/artifacts/`，SFU TAR 位于 `2026-10-12/task/sfu-shutdown-011f12b9-build/artifacts/`。只传镜像与本目录操作材料；真实资料、密钥、Compose/env始终留在目标机。镜像不重建、不 pull latest；Docker29 manifest ID 与 classic config ID 的差异由 load 后实际 image ID/源码 labels 核验处理，不能只认tag。当前集成20006cf1新增的ET纯模块不在此backend镜像中，且尚未接运行入口。

## 准确变更与权限

- `server`：新准确镜像，`VOICE_HYBRID_ENABLED=true`；显示版本显式设为 `1.0.76-laokuai.hybrid.85ec3b9c`，不是把它伪装成原1.10.58的Git来源。
- `sfu`：新准确镜像，`SFU_HYBRID_ENABLED=true`、`SFU_AUDIO_ONLY=true`；保留 client token=true、control9092、metrics0、UDP mux3478。AudioOnly明确限制为音频，屏幕共享不纳入此次验收。
- 保留原 `/opt/stacks/gryt/compose.yml`、环境、JWT、服务器/管理员身份和 SFU key；不读取值到本地或新签发身份。现有网络 `gryt-voice` 和DNS别名、内部5000/5005/9092及宿主UDP3478不扩张，TLS/Caddy/域名不改。
- 原数据 `/opt/stacks/gryt/data` 完整保留；停稳 backend 后 `cp -a` 全目录到 `/opt/stacks/gryt/hybrid-upgrade-d38ed22d/data-candidate`，包含SQLite WAL/SHM并保持owner/mode。候选只写副本，目录700、操作摘要600，不导出资料。两实例不能同时写原目录。
- 无ET管理/设备凭据、TUN、驱动、NET_ADMIN、host network、OS路由/防火墙或新增公网端口权限。已有普通服务运行使用既有配置；新的安全敏感ET范围另行由父确认。

旧生产镜像固定 backend `b6f4bf5db57493a06307e1cfaefd1c92d6c90ccc26e46c9ba05a8fab53d093e8` / SFU `33babe9b71475b123d5bb0e8482f0da5ae2b92c0fbe0e59a00957d89faea6eef`。2026-10-12旧只读基线不是现在的现场状态；helper会重新验证正在健康运行的两个服务、owner labels、准确旧image/data/port和当前环境与base Compose一致，漂移时拒绝切换，且不打印私密差异。

## 在目标执行

将两份 TAR 放入一个新 staging 目录，与本目录分开，勿提前创建 `/opt/stacks/gryt/hybrid-upgrade-d38ed22d`；它是 activate 的不可覆盖事务目录。先确认目标空闲磁盘可容纳两TAR、导入镜像和数据副本。`python3` 与现有 Docker Compose 必须已可用；不自动安装工具。

```sh
python3 cutover.py --phase load --tar-directory /exact/operator/staging
python3 cutover.py --phase inspect
python3 cutover.py --phase activate
```

load 先验证TAR哈希，再只导入镜像，不启动产品。inspect只读。activate先私密渲染最终Compose并严格比较仅允许两image、列明flags/version及 `/data` source变化；继承其他服务/env/mount/networks；再按 backend TERM→20秒停稳→全副本逐字节hash→旧SFU TERM→新SFU→新backend 的顺序，只操作两个服务。使用 `--no-deps --pull never`，无 down/prune/删卷/删资料。遇到停止超时不 SIGKILL。预计中断60–120秒，维护预算300秒；不能保证旧线上正在进行的通话无断开。

helper完成启动后不声称验收通过。父部署 owner在45秒内检查实际image/labels、SFU与backend直连健康、控制注册及原公网route，然后用户用原管理员/成员身份加入、刷新令牌、双向普通SFU通话；再用支持本协议的冻结client/SDK尝试Hybrid。不能创建替代管理员或假grant/正ACK。真实旧 account/外部CA/client与公网听感留给此次实际试用，健康200不是它们的通过证据。

```sh
docker exec laokuailiao-sfu wget -qO- http://127.0.0.1:5005/health
docker exec laokuailiao-server node -e 'fetch("http://127.0.0.1:5000/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
curl --fail --max-time 5 https://voice.ruikang.wang/health
```

## 回滚和实际已验边界

启动/控制注册/原身份加入/普通语音失败时，维护窗口内执行 `python3 cutover.py --phase rollback`。它只对确认为本轮旧/新镜像的两service发TERM，检查base Compose和原数据未变，使用旧准确images与原data恢复SFU后server。候选目录保留供后续核查，绝不删旧images/data。候选期间新增聊天、设置和refresh只在副本；回滚原目录不会带回这些新增写入，须告知试用用户并保留副本，不能把它称为零数据差异回滚。

如果 activate 在写 `operation.json` 之前因copy/验证失败，旧backend已停但原data未动；先核对仍为上述旧镜像，再 `docker start laokuailiao-server` 恢复原服务。不要继续激活、不覆盖已有事务目录；按safeError具体处理。若base/data/容器来源漂移，helper拒绝自动回滚，父owner需现场核对，不杀不明实例。

已有42表/permission-schema10/三个迁移标记只读一致性与20项精确bundle合成join/refresh/副本恢复证据；实际生产Git祖先、旧二进制跑迁移后副本和真实外部CA尚未完整证明。原目录留存就是回滚边界，无候选迁移写回它。

buildowner run3 已通过真实backend/SFU+raw Pion：5秒251有效Opus包B/C各251；真实pause applied ACK后B新增0而A/C各101；resume21ms新包；控制断线后暂停lease安全到期恢复；活动TERM189.277ms exit0，3容器/网络残留0。它不是完整SDK自动P2P切换、公网NAT或设备听感；完整监听清单unknown。回执见 `../../acceptance/minimal-media-d38ed22d-run3.json`，旧source/PID1/失败证据各自保持。Task6未创建测试资源或执行本helper的Docker/生产阶段。

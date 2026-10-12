# 纯社区合约与 SFU 退出交付

唯一分支 integration/lifecycle3-20261012，源码冻结 20006cf1bad50e5331339710ae22ae6578fffed8，完整 tree a18f9310a9c66e3b40f6ab896ee63becea9de73e。ab1246dc 八文件无冲突 cherry-pick；八个 Git blob 与原交付一致。原型 ZIP 不入 Git，九文件全字节归档，97/97 原型纯测试保持独立。

|组件|当前精确 tree|
|---|---|
|client|fbcc9d4e2db64348fc17704d486a421233f7513f|
|voice|45a5122b5480e37224987e74b898cfd4553f0cb4|
|server|9e7b2a54df362e6039106bb809447ae6515de797|
|sfu|3d64d5904681d59590be940870ce045e5c1577ff|
|easytier|1af35e8bef73da0a0c3eaddef464a714d8a4b2a2|
|landing|e1215b01f703d2a2dba56ba9cb1261b55789220a|

本地47服务端+121 main 纯测试、两侧严格模块类型、八文件定向 lint 和 diff 检查通过。不是完整产品编译；首次本地统计器把 Node spec 输出当 TAP 而失败，全部168测试本身通过；ESLint Windows ESM 配置路径首次失败后修正，产品源未改。两条 eslint-env 弃用提示保留。相关原始检查日志只存 owner 的 et-contract-integrated-check。

清单86项回归（10正向/76反向）通过；普通 verifier exit0，--require-ready exit2。exact SFU17/ET8增量与哈希、祖先、组件tree、范围和执行限制单独校验；旧a88 UI13实际渲染、旧SDK/包/媒体证明不升级为当前完整产品验收。

SFU源码011f12b9/tree 3d64d5904681d59590be940870ce045e5c1577ff；新 OCI sha256:d38ed22ddbed419661ba20b2c0bf008b18d07e05446c0c813c05a022883aafc6，config sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f。TAR10624000B/SHA256 102fba9de73bb8eb9cb5e47171e5938330635a9dc827e27085ea800a632ceaaf；ELF13365432B/SHA256 4232d60e7967ca7edcd10ca188e6fdcf941683da71884fd6680bd6da38897a77；Task6只读重哈希匹配。指定builder实际默认PID1 TERM/INT/stop全exit0/无残留，network=none。活跃认证/PC/RTP/lease drain未验，旧e0f镜像保持。

下一轮：真实认证/成员DB、持久operation/revision/tombstone与补偿、固定instance Credential Generate/同key Upsert/List/Revoke、main可信grant transport/IPC/config ACL/issuer pin/真实观察闭环。当前模块没有被运行入口导入，无真实provider或IPC接线，不签发、不激活。physicalDirectVerified=false、activationReady=false、ready=false、finalPackage=null。

父已把人工批准的窄3容器媒体范围转交buildowner01a12dd7；Task6未创建媒体网络/容器。四容器V2提案未批准。没有产品/ET/TUN启动、构建、生产写入、远端push或公开发布；所有既有冻结包与成果保留。

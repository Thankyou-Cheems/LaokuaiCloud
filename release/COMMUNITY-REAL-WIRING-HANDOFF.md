# 真实社区 ET 接线冻结交接

唯一写入分支 `integration/lifecycle3-20261012`；源码 `8f8dd7c1f61f89a0e85bfa882a6ba13992fc4fdb`，完整 tree `fcb347b9b07d268e6f4bc51f9b7efded25a74005`。client tree `c418608a2afe02b7cd28839e2f64accf29b31304`，server tree `1cf6c787fadaaf21fb1216da5f7ed381b04fc164`。原 client history/dirty snapshot、已交 UI/pack/SDK/native/SFU 均保留；没有重写历史、push、发布或生产切换。

统一 API `6bfcc88→e31000a1`、修正 wire `d10f2eb→d02aaecc`、main `8be8c8f6`、组件内生成类型 `553af957`、最终 server `52f81677→4d106304`、既有 server auth/SQLite/路由入口 `8f8dd7c1` 顺序完成。全链无 cherry-pick 冲突；server 最终九个 Git blob 与 owner 完全一致。source overlay 限定准确40路径；canonical HTTP blob `21d7a4804b1b35d33197346b5b7098254c9a8701`。

接线包括实际 JWT/token-version/member/ban、加密 SQLite operation/revision/tombstone、固定 native UUID 的 Generate/同 key Upsert/List/Revoke、main-only HTTPS/IPC、ACL 文件/issuer pin、唯一真实 CLI sample 的绑定投影、鉴权与退出时先关 owned core 再删文件/撤销。provider 不读取 root native seed；没有后台撤销 worker，未知结果保留 pending，由后续 authenticated acquire/revoke 对账，不能写成即时撤销。main 五路 HTTP DTO 不接收 sessionId；renderer 不提供 native config/URL/key。

239 main/既有纯检查、最终 server owner86、入口19通过；app655/main64/server229个输入零类型错误；定向 lint 零错误。49 runtime 已含在239，不重复计数。没有重新声称历史 UI/媒体包覆盖新源码。旧纯检查统计器误读 spec、旧 fixture 和 loader 设置失败材料留在 Task6 本地；原产品缺陷的 Manager 错误吞并已修正并回归。

实际公共 `cheems-p2p` 官方 `2.7.0-8b7f1f01`，TCP/UDP11014、host loopback15890、native UUID `e2a5bd9d-47bb-4120-8589-e6898112ae85`。owner 冻结 wire 的真实只读 ListCredentials(method3) 解码通过，credentialCount0，SSH child 正常退出。仅证明此 RPC wire 分支，不证明 secure/Admin、Generate/Upsert、持久化、Windows TUN、SDK真实 P2P/fallback 或听感。

当前 `ready=false`、`activationReady=false`、`physicalDirectVerified=false`、`finalPackage=null`。SDK tgz仍 `897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae`，SFU tree仍 `3d64d5904681d59590be940870ce045e5c1577ff`，native core/CLI仍 `f716a113…`/`1ad46380…`。旧 backend e45e9/new SFU d38ed22d 镜像及旧 UI/媒体材料保留为原快照证据；ET-disabled 两服务 cutover 已取消，不执行旧 operator。

下一执行只针对父统一批准的真实腾讯云和本机范围，见 `COMMUNITY-REAL-FIRST-DEVICE-SCOPE.md`。需要从本冻结源码 fresh build backend/client，取得明确批准后再切换；Task6未构建、未上传镜像、未启动 core/TUN、未写真实 profile 或云端配置。

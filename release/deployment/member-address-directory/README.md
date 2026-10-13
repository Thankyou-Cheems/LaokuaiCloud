# 成员虚拟 IP 目录后端增量

用户于 2026-10-13 明确同意立即更新 `voice.ruikang.wang` 的 Gryt server。
本地编译既有锁文件的 server bundle，上传精确 hash 与 source commit 到
`/opt/stacks/gryt/member-address-directory-20261013`。operator 分别执行 build、activate；
build 基于固定现行镜像 COPY 一个 bundle，无 RUN/依赖安装/拉镜像/新增端口。
activate 仅重建 server，保持所有原环境、数据卷和 12 人参数，失败恢复原镜像。
旧镜像和合并 Compose 私有快照留在服务器，可显式 rollback；不导出凭据。
SFU 容器 ID/启动时间必须不变；没有 ET 命令。健康不等于完整客户端或游戏验收。

后续 Compose 操作必须保留此目录 `activation.overlay.json`，以及之前的
`sfu-12-fallback-16k60/activation.overlay.json`。执行结果另记 release/acceptance。

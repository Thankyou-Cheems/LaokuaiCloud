# 成员虚拟 IP 目录后端增量

用户于 2026-10-13 明确同意立即更新 `voice.ruikang.wang` 的 Gryt server。
本地编译既有锁文件的 server bundle，上传精确 hash 与 source commit 到
`/opt/stacks/gryt/member-address-directory-20261013-r3`。operator 分别执行 build、activate；
build 基于固定现行镜像 COPY 一个 bundle，无 RUN/依赖安装/拉镜像/新增端口。
activate 仅重建 server，保持所有原环境、数据卷和 12 人参数，失败恢复原镜像。
旧镜像和合并 Compose 私有快照留在服务器，可显式 rollback；不导出凭据。
SFU 容器 ID/启动时间必须不变；没有 ET 命令。健康不等于完整客户端或游戏验收。

前两次切换分别因环境变量/挂载列表顺序被比较器当作实际配置变化而自动回滚。
原始私有快照与失败记录留在原目录及 `-r2`；`-r2` 完整差异证明确为挂载排序。
现比较器只规范化环境键顺序和挂载目标顺序，仍比较完整值和属性、拒绝重复项。
`-r3` 切换成功；其原始 ACTIVATED 的 runtimeStarted=false 是继承 BUILD 的旧报告字段，
实际 activated=true 且新容器 healthy；此处已修复后续报告生成，不改写原始回执。

后续 Compose 操作必须保留此目录 `activation.overlay.json`，以及之前的
`sfu-12-fallback-16k60/activation.overlay.json`。执行结果另记 release/acceptance。

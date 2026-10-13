# 为公开移除 Npcap 历史载荷

用户于 2026-10-13 明确批准修改提交历史，移除 Npcap 分发。已在完整 Git
bundle 校验成功后，用 git-filter-repo 从分支/标签历史删除以下六个路径：

`components/easytier/source/easytier/third_party/{arm64,i686,x86_64}/Packet.{dll,lib}`

共处理 1722 个提交；开发提交 `69777ba86c9430a2a75420a6c596a2d06e63f925`
映射到 `0cec203c4c53eac9a8a0a767f7950886ba7c0529`。其余 HEAD 文件逐项
Git blob 比对一致。`commit-map.txt` 可用于解释历史测试记录中的旧提交 ID；
该映射不把旧测试升级成新源码的测试。

历史扫描未发现真实生产凭据或原始 Microsoft 编译静态库。Packet.dll 的 PE
版本信息为 Npcap 1.79，许可不允许直接外部分发；现代产品本来就不打包这些
文件。原生运行时保持同一 core/CLI 和两份驱动，未重新编译或执行 ET。

完整恢复 bundle 仅保存在开发机 `.local/review-20261013/`，SHA256：
`90df7a732b0ec47c589ad7a29f26059e84f614068fad01a16f0533513780d32a`。
应用自动产生的 `refs/codex/*` 本地检查点也不推送；禁止用 `push --mirror`
把这些私有恢复引用带到远端。公开入口收敛为 `main`，旧工作区不要直接推送
清理前历史。

对应源码包使用已排除非构建二进制的 1262 文件源材料。原 1277 文件导入
记录及 source tree hash 是历史来源，不代表清理后组件目录仍含 1277 文件。

远端只保留清理后的 main，且已经设为默认分支。但 GitHub contents API 在
旧提交 `7a9ba9dd221fbf7bf5259600d39c76ccf8a43a59` 上仍返回原 Packet.dll，
blob `7e1bf1206a781cf6db41cc41bf59854e63dd8f6a`，220032 B。这是服务器保留的
不可达对象，继续 force push 不能保证清除。尚未切换 PUBLIC，也未删除重建仓库。
参见 GitHub 官方的
[历史重写后残留说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#fully-removing-the-data-from-github)。

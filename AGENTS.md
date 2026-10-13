# 唠蒯云开发约定

先读 `HANDOFF.md`。唯一开发目录为 `D:\Dev\LaokuaiCloud`。用户于
2026-10-13 恢复本地审视、改进与历史清理；旧 Task-6/owner 分工已结束。

## 产品目标

首次添加 voice.ruikang.wang 输入一次社区密码，保存成员身份；以后恢复社区
自动加入 EasyTier，不依赖进入语音房或另找联机开关。语音优先使用经媒体
验证可用的 P2P，失败恢复 SFU。ET 不可用时社区认证和 SFU 语音仍可用。

## 开发与验证

- Windows shell 使用 `pwsh` 7、UTF-8 无 BOM；直接调用可执行文件，shell
  编排写入 `.ps1`。工具入口见 `tools/enter-local-dev.ps1`。
- 客户端、Voice SDK、Gryt 后端、SFU、ET 分别位于 `components/`；腾讯云
  ET 与 Gryt/SFU 独立部署。ET 固定基线与产物见其 `provenance.json`。
- 改入会/ET/语音接线时运行 `tools/check-core-contracts.ps1`，再按改动运行
  对应类型、lint、行为检查。该命令是源码检查，不代表产品/网络验收。
- 当前完成度和优先级见 `docs/PROJECT-REVIEW.md`；精确历史产物来源见
  `release/manifest.json`，按需查 `release/acceptance/`。旧通过只适用其固定版本。
- 优先验证首次入会、普通重启、无需开关的自动联机和真实双设备回退路径。
  区分 ET 路径、WebRTC 媒体路径与物理直连；未知保持未知。
- Git 提交使用已有有效身份和英中双语 Conventional Commit。

## 操作边界

- 本轮可修改本地源码/文档、运行轻量检查、清理已核实的历史分支/工作树。
  清理前保存完整 bundle，核实未提交及忽略文件，恢复材料留在 `.local/`。
- 真实 profile、凭据、密码、原始机器日志不进入 Git；社区密码由用户在
  安全 UI 输入，不替换为邀请、管理员权限或设备共享凭据。
- 正常 UAC 不绕过；安装持久提权服务须单独明确批准。当前运行客户端、
  私人 CheemsTier、生产部署、TUN、驱动、防火墙/路由操作需具体运行范围。
- 用户已恢复开发、构建轻量绿色测试包、同步对应源码并公开
  `Thankyou-Cheems/LaokuaiCloud`。随后明确批准删除 GitHub 旧仓库并同名重建，
  用清理后的 main 和源码标签重新推送；本地旧备份保留且不得推入新仓库。
  公开前检查将公开的完整历史和材料，包引用精确版本对应源码，不内嵌源包。
  保留必要许可证/声明；不操作 i18n fork。持久服务安装仍需另行批准。
- 用户已明确批准修改提交历史以移除 Npcap 分发。先完整备份，再清除历史中
  3 个架构的 Packet.dll/Packet.lib；校验所有公开 refs，不扩大历史重写范围。
- 保留许可证、对应源码、来源和历史失败证据；文档整理不提升发布就绪状态。
- 同名重建后仓库为 PUBLIC。每次推送先核对目标仓库及将公开的改动；只推
  明确的分支/标签，不使用 mirror 推送本地 Codex 检查点或恢复引用。

旧流水记录在 `docs/history/2026-10-13-takeover/`，仅追溯时读取；其中临时
任务分工和一次性许可不授权新运行。

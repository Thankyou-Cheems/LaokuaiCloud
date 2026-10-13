# 客户端

遵循根 `AGENTS.md` 和 `HANDOFF.md`；本地开发者是当前集成写入者。
社区入口在 `src/components/communityLanSession.tsx`，本机授权与 ET 在
`electron/`，语音桥在 `src/packages/webRTC/src/adapters/`。

改接线运行根 `tools/check-core-contracts.ps1`，按改动补跑本组件类型/lint。
保留已批准中文 UI、品牌、音量菜单、静音/PTT/Squad 语义和精确 vendor 锁。
`docs/releases/` 是历史检查点；全局产物来源见根 `release/manifest.json`。
首次入会和普通启动自动 ET 尚未验收，不能用 mock/native 单次试验代替。

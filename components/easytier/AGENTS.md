# EasyTier

遵循根 `AGENTS.md`。固定上游 v2.7.0 基线为
`8b7f1f0196edb5b580829ed5f135050fb5853478`，来源/补丁/当前二进制见
`provenance.json`；构建、导入和许可证证据见根 `release/`。

保留现代 Windows 标准静态 CRT/no-encoding 修复与原始许可。
官方 Windows 二进制仅作参照，不静默替换私有修补产物。
修改 native 源码需新构建与来源验证；旧哈希和单次测试不覆盖新产物。
腾讯云 ET 与 Gryt/SFU 独立；本地审视不授权修改生产、私人实例或网络配置。

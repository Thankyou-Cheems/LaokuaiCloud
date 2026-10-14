# 启用现有成员移频协议

2026-10-14 只读核对：线上 Gryt 为友好 DNS 镜像 `34cde4c1`，SFU 为12人预算镜像
`585f0a76`，两者固定源码均已含成员移动协议，但 `VOICE_ATOMIC_MOVE_ENABLED`
尚未设置。客户端拖拽必须遵守服务端能力、`disconnect_members` 权限和严格角色
高低检查，不能绕过能力开关。移频不触碰成员社区 EasyTier 会话。

具体操作仅将 Gryt 的 `VOICE_ATOMIC_MOVE_ENABLED` 设为 `true` 并重新创建
`server` 容器；不替换镜像，不改12人上限、其他环境、端口或挂载，不重启 SFU、
EasyTier 或管理代理，不修改数据库。既有九项 Compose 文件全部保留。
会有短暂社区重连，正在使用语音的客户端可能需恢复连接。

`operator.py inspect` 只读验证固定镜像、健康和基线配置。
`activate` 须在取得本次具体生产授权后执行；本地准备并不表示已启用。
操作器在 `/opt/stacks/gryt/voice-member-move-20261014-r1/` 保存权限0600的原配置
与原叠加文件哈希，再比较合并配置只差这一项开关；完成后验证其他服务代次及
服务实际配置。失败恢复原 Compose 文件组合；`rollback` 也只重启 Gryt并移除
本次开关，不退旧镜像或删除数据。私人备份不得下载后提交 Git。

启用后读取 `server:info.voice_atomic_move_enabled` 应为 `true`；这包含 Gryt 对
当前 SFU 的能力确认。实际管理员拖动、目标端准备与提交、成员音频恢复仍须实测，
不能仅凭环境变量为true宣告双端移频成功。

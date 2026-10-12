# 最小媒体候选与自动入网闭环接线

本文件是后续接线计划。本轮仅整合ab1246dc八文件纯模块为20006cf1；真实provider、IPC、存储和runtime接线不在本轮范围。

媒体执行已转交父指定build owner01a12dd7。已封存85ec backend e45e9c27、旧SFU e0f67b7c和当前SDK lifecycle.3/897b5979保留。新的TERM011f12b9 SFU镜像d38ed22d已完成静态核验与三项无媒体PID1退出；它可以作为另一个精确候选，活动RTP仍未验。旧SFU停止exit2事实保持，不能提升为优雅清理通过。

已有两真实SDK/P2P/PCM试验的Chromium runtime63c27620与原wrapper可作harness来源。它旧试验用SDK8abe，不能挪用旧结果证明当前897版本；指定owner必须冻结实际适配器及输入，并在获准范围内检查运行时可用性。测试须由实际SDK完成选路和断链回退，不能由脚本手动切音频制造通过。

当前人工批准仅为最多3容器、临时internal bridge，容器TCP5000/5005/9092、可选9093，UDP3478/40000–40031；无宿主发布端口、生产资料或ET/TUN。准确范围与执行owner见media/internal-bridge-scope.json。internal bridge不等于OS/WebRTC egress防火墙；清理仅限准确自有ID/label/endpoint。

media/internal-bridge-media-first-v2.json只保留历史未批准提案：4容器、HTTP8080与宽动态UDP均超出当前批准范围。Task6没有建媒体网络/容器，也不据此启动。执行者若无法在当前窄范围完成真实SDK验收，应回报具体边界，不能扩张范围。

入网最小闭环仍缺以下真实接线，不增加通用诊断或新纯矩阵：

1. **后端真实issuer任务**：在server/src/easytier新增communityEtStore.ts、communityCredentialProvider.ts、communityEtService.ts及窄handlers。复用现有认证/成员DB验证账号与社区权限，落operation/revision/tombstone，固定管理instance，真实Generate(reusable=false)/同key Upsert/List回读/Revoke；RPC与存储失败要补偿，取消后不能发布迟到grant。Admin管理材料只在受保护server provider内；成员永远是Credential身份，无network_secret/管理员私钥返回。现有共享DB migration/handler注册由唯一owner接入。
2. **main真实runtime任务**：在client/electron新增communityEtRuntime.ts、communityEtGrantTransport.ts、communityEtObservationProvider.ts。从可信既有账号会话/签名证明获取main-only grant，不能信任renderer accountId；固定instance RPC、issuer pin、公钥与route关联；ACL私密配置、路径与四文件binary校验、精确owned进程/会话取消。不能从credential_id推出公钥，不能投影NodeInfo.config，不能把接口IP当绑定证明。未取得真实字段就返回unsupported/unavailable。
3. **唯一owner共享接线**：八个纯模块已整合；下一轮把上述真实适配器接到easyTierCommunityIpc.ts、easyTierCommunityManager.ts、main.ts/preload及现有community membership session。Renderer只发communityId/intent；社区加入/退出拥有ET生命周期，语音切房/退出不重启共享ET。保持本机激活/签名/许可门禁、已有实例保护及单active-community限制，不能借社区权限提权。
4. **一次实际闭环**：批准的受限issuer/设备场景中观察加入→短grant→owned config/core→真实Credential/PeerVerified及IP绑定→同key续期→社区退出撤销/owned stop。现有bootstrap是否支持Secure Mode和准确issuer公钥必须先验证；未批准不能修改Tencent公共节点。代码接线与网络/驱动激活是不同授权。

并行者只写新增adapter/store/service文件，共享IPC/Manager/DB注册/root manifest继续单写入。168纯契约和97原型测试是基础，不能宣称自动入网；下一工作应是这些窄真实provider接线和媒体运行。首次单机bridge通过仍不代表公网NAT/P2P、真实设备听感、弱网跨网或最终生产可用。

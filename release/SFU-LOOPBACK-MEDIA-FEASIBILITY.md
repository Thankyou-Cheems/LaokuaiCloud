# 原 SFU 的仅回环媒体可行性

结论：当前精确 SFU ELF 在 network=none、只有 lo 的容器中，不能完成真实 RTP 或成功暂停/恢复 ACK。7 项运行检查已固定原因：原 ELF 健康、合成控制注册和签名 client_join 能取得音频 offer，但 UDP3478 mux 监听数为0、SDP/trickle candidates为0，原日志明确报告无可用 UDP mux 接口。即使配置 ICE_ADVERTISE_IP=127.0.0.1、STUN关闭，也没有改变结果。没有生成新的媒体二进制或修改产品。

原来源85ec3b9c，ELF47378f28；本次没有替换镜像/代码。单容器UID1001/1CPU/1GiB/networknone、无主机端口、真实账号/麦克风/数据。仅合成60秒SFU token位于进程内；没有持久凭据。确切自有容器已移除，tmpfs丢弃。真实PeerConnected/RTP/physical applied ACK均false。

源码因果链：cmd/sfu/main.go 的 newSettingEngine 调用 NewMultiUDPMuxFromPort 时仅提供IP过滤，不提供 UDPMuxFromPortWithLoopback；Pion ice/v4 v4.4.1 的该构造参数 includeLoopback 零值为false，localInterfaces在IP过滤前跳过loopback。原 SettingEngine 也未设置 SetIncludeLoopbackCandidate(true)。广告地址重写不能制造未绑定的接口。运行结果证实实际冻结二进制具有这一限制；这是严格测试环境限制，不能据此认定正常生产网卡或公网NAT一定失败。

本机已找到现有Pion/webrtc、ice、gorilla/websocket的准确缓存归档，但未编译新helper，也未宣称整个依赖闭包已核验。仓库既有 cmd/integration-probe 使用专用loopback API/testtransport，可用于同源码转发核心的真实媒体检查；它不运行原产品入口，因此不能写成上述封存ELF媒体验收。

最小后续方案：

1. 若必须验证原ELF，批准一个有明确边界的隔离非回环网络环境，保留无主机发布端口/无外网和合成身份；或先审查一个默认关闭、仅显式测试模式允许的loopback mux/API选项。当前请求规定需产品改动时先给方案，因此本轮不实施该选项，不添加NET_ADMIN/dummy网卡、不改现有网络或产品配置。
2. 在选定环境用两个现有Pion合成peer，绑定真实signed app_socket与最终publication，先见RTP，再验真实pause applied ACK和单方向包停止、另一方向持续、显式resume、到期恢复、丢ACK/断链回退及旧epoch不能清理新lease。全部使用冻结backend/SFU源码与精确新测试产物，不混淆原镜像和测试入口。
3. 单机通过仍需真实既有account的批准staging、跨容器控制、旧镜像/数据回滚，以及公网NAT/P2P/弱网和ET身份/入网验收。此轮没有赋予这些网络或生产授权。

后续已授权的TERM/INT修复单独处理，保持网络/codec/auth/Hybrid业务默认值；它不自动解决此loopback限制。证据摘要见 acceptance/sfu-loopback-media-feasibility.json，本地脚本/原结果哈希保留，状态是已完成的可行性核查、媒体链路仍阻塞。

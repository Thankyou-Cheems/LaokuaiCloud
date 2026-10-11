# 唯一路径 Provider 已接入只读 SDK 与 ET 候选

SDK source b8f16d0eac49c2fb09a92f6298d8cbb9eaed7bc1 / receive-path.1。
精确 TGZ SHA256 8abea479d053b6310e8c97746ae8b07f153a17d691dc20bdd5a241b6fe90caed。
旧 SDK3、a36 媒体快照和24k/48k失败证据全部保留，不改写为本轮验收。

- ReceiveCorrectionBridge 内仍只有一个 MemberVoiceMediaBridge/Store。
  普通 SFU 和 receive-only 不启动 Hybrid、不造本地 publication。
- MemberVoiceReceiveTranslator 消费实际 ReceivePathObserver，scope 来自独立
  当前认证 account/socket/room/roster，PC 引用和 getConnectionEpoch 同时匹配。
  BrowserHybridVoiceSession.getReceiveScope 是独立被动 authority；观察行
  的 scope 只能用于比对，不能反向创建当前身份。opaque token 原样保存。
- SDK/Store 的生产时钟都是本页 performance.now。readAt 只标记逻辑选择
  当前读数，绝不充当解码 proof 时间。首份报告仅 baseline；正 packets 和
  totalSamplesReceived 窗口、真实 track 和新 generation 才能确认 fresh。
- receiveGeneration/selectionEpoch 是本地正 ordinal，不称服务端 generation。
  原 Hybrid routeGeneration/revision 单独保留 diagnostic。PC/auth/socket/
  房间/session/publication/source/track/revision/token 退休会清证据并旋转
  lease；相同 track ID 的新对象也不可复用旧窗口。完整快照缺行会清空。
- 逻辑 peer 与可用 decode 独立于物理路径。failed fallback 但选中的 P2P
  仍 fresh 时不声称断音；switching/recovering 保留真实过渡。send 没有远端
  authenticated decoded receipt，继续未知。physicalDirectVerified=false。
- 默认订阅不展示指标；详情打开通过同一 SDK observer 订阅 details，
  没有第二 getStats/RMS/PC。RTT 只取 selected pair 的测量窗口，loss 只取
  exact track 的 packet delta。真实0保留，缺失/重置/静默/过期不补0。
  输出 metricsAgeMs/lossWindowMs；SFU RTT 是 SFU→本地 leg。
- 最后 unsubscribe 取消 SDK 定时器与被动监听，丢弃旧 flight；客户端
  unmount 只清自己的 observer 订阅/500ms lifecycle tick/socket监听，
  不 stop/dispose 借用媒体、不 disconnect共享socket、不管 ET生命周期。
- ET localDetails 由原 community main producer 读取自有实例 verbose route
  list，经过许可、scope、single-flight、retirement 与<=5000ms acquisition
  TTL。Renderer UTC 只用于 ET TTL，不能混到 SDK performance.now。
  同一 Provider 的 localNetwork 和 useMemberVoiceLocalNetwork 可读这些
  独立本机事实；memberBindings=[]、physicalPath=unknown、rttMs=null。
  不把 next-hop/reportedDirect/cost 关联成员或称完整物理音频路径。

实际源码 Observer/Translator/Store 11组、挂载/lease/socket18组、SDK精确包
154断言、完整app/desktop类型及目标lint通过；其他UI/ET纯检查见统一manifest。
Task6真实PC/网络/capture/ET/TUN/Docker运行均0。后续容量owner只取此新冻结
快照进行真实媒体/采样/48-64/恢复复验；DOM与用户设计批准也仍待完成。

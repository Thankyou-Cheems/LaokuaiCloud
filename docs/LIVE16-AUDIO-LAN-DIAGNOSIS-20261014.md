# .16 双人音质与虚拟网 Ping 现场诊断

本记录是未完成的现场调查，不是修复或验收回执。程序仍为
`06708268dfda7e5021e145970c913968d190f40c` 的 .16。未重启客户端、Gryt、SFU、
EasyTier，未修改账号、配置、防火墙或路由，未执行 GitHub CI。
原始日志、实际地址、实例和规则信息只存 `.local/live16-audio-quality/`。

## 用户可复现的失败

- 用户描述声音发闷、像电话、细节少；收听方向尚待确认。
- 两端截图都显示自己已入网，对方仅显示地址已分配。
- 本地运行 `pwsh -NoProfile -File .local/live16-audio-quality/check-lan.ps1`：
  名称解析到目标虚拟 IPv4，3 次 ICMP echo 全部超时。
- 同次 owned instance CLI 结果中，目标地址存在、下一跳是目标节点、
  一条连接、cost=1、ET 报告延迟约 67 ms。它证明节点传输可见，不能证明
  内层 IP 数据已送入目标 TUN，也不能把该延迟标成 ICMP RTT 或语音延迟。
- 用户随后提供朋友反向 Ping 的截图：4/4 回复，64–67 ms，平均65 ms。
  这证明朋友到本机请求、本机到朋友响应的内层往返可用；主动请求方向不对称，
  重点转向朋友侧入站请求处理，不能再表述为整个虚拟网不通。仍未取得朋友侧
  防火墙/WFP数据或规则A/B，不能认定确切拦截点。用户要求暂停降噪调查。

## 已确认的边界

1. 名称解析成功；当前失败不是 DNS 无法解析。
2. 本地 TUN 地址和 /24 路由存在，网卡分类为 Public。
3. 产品防火墙只创建 app/easytier 两个程序入站规则，没有 TUN ICMP 规则。
   ET 自己的接口规则创建被显式禁用。程序放行不能代替 Windows IP 栈
   echo responder 或其他游戏程序的入站规则。
4. 机器还存在历史 EasyTier 接口规则，包含已失效接口及接口字段为空的行。
   没有清理它们；不能仅凭规则名称、枚举允许规则或 Public 分类就认定本次
   ICMP 被拦，需要目标 TUN/WFP 证据或精确作用域的规则 A/B。
5. `communityEtGrantRuntime.ts` 当前只产出本机身份 binding；
   `easyTierMemberAdapter.ts` 为目录中没有 binding 的远端固定投影 assigned。
   因此双方看对方“地址已分配”是接线能力限制，不是远端掉线证据。
6. `avoid_relay_data` 只限制转发给第三方，不阻止节点自身收包。
   产品没有配置 ACL；不能解释成普通成员之间被设计为隔离。

## 同时捕获的语音事实

在 13:28–13:30 UTC 的本地日志中，曾多次进入 P2P 并暂停对应 SFU 转发，
之后又因 `peer_path_changed` 恢复 SFU。切换前后日志有 `fresh_decode`，
路径从 host/host、non-turn-candidate 变成 pair-unavailable；后者将
多个原因合并，现有日志不能区分 transport 缺项、pair 缺项或非 succeeded。
同段 ET 本机代次保持 connected，未见其跟随语音切换重启。

13:30:40 UTC 服务端收到本机 muted/deafened=true；随后权限范围失效不能
直接算成协议故障。不能把这段正常静音后的证据与此前声音差混为一谈。

只读线上数据库确认：服务器 voice cap 为 96000 bps，三个语音频道的
max_bitrate 都是 null；没有证据支持当前频道把 peer 限成 16 kbps。
本地保存标准 preset 和 RNNoise=true。标准 SFU 是16 kbps/60 ms，peer
是独立编码的64 kbps/20 ms；共享的是编码前 PCM track，不是 SFU 的压缩流。
这些是配置和源码事实，尚非现场实际编码码率/频带测量。

现有客户端诊断没有 peer sender 配置回读、连续发声的字节增量或硬件
实际采集参数；不能只靠 P2P 标签宣布音质达标。待做单项对比：同一设备、
同一句话、其他设置不变，发送端只关闭 RNNoise，看接收端是否明显改善。
未采集或录制用户语音。

## 无效探针与后续判据

- 尝试从服务器容器 ping 两个虚拟地址也超时，但随后 `ip route get`
  证明服务器主机把这些目标送往公网默认网关；该次探针没有进入目标 ET
  虚拟网络，结果作废，不能用于归因防火墙或成员连通性。
- 朋友反向 Ping 已由截图确认成功；范围已缩小到另一方向的请求处理，仍不
  代表所有游戏端口可用。
- 最直接的网络判据是目标 TUN 收到 echo request 后是否发出 echo reply。
  若做防火墙对比，只允许目标应用 TUN、目标本地地址、该测试对端地址、
  ICMPv4 type8，测试后撤销；不关闭防火墙、不默认放开全网段全部服务。
- 音质候选需分别验证采集/耳机模式、RNNoise共同处理、实际编码参数以及
  SFU回退占比。尚未确认音质根因，不为某一个猜测直接更改全体默认值。

没有运行真实 ICE/Go 网络测试或把源码检查数量当作双人验收。

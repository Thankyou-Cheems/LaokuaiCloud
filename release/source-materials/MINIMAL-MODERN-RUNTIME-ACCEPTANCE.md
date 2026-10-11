# 现代089b6182的最小验收交接（未授权激活）

此交接只读准备；不是可执行runner、不是新的scope批准。当前正式输入是089b6182/tree25be11e0，
17features/+crt-static/windows-std-static-minus-faketcp-v2。具体4文件大小/完整SHA、source/lock/patch/profile
和producer原BUILD/import audit/current notices pins均在RUNNER-PIN-UPDATE-PLAN.json。

## 源码与已通过旧载荷的差异

两份原始preferred-source归档共有的624个Rust文件逐字节相同，唯一改过的共有文件为
`easytier/Cargo.toml`：Windows service-manager default-features=false去掉命令输出编码依赖；
非Windows原声明保留；thunk-rs删除产品win7 feature，切换标准静态CRT路径。Cargo.lock完全不变，
17个产品feature不变。旧506→现代504是Windows active graph移除encoding-utils0.1.0/codepage0.1.3（encoding_rs仍由其他路径保留），
不是修改协议、TUN ownership、SFU/P2P媒体或AGC/码率。原Rust thunk helper在空features路径提前返回，
原source helper本身没修改；匹配新PDB/link记录没有VC-LTL/YY输入。

现代原始源归档新增6个历史Packet DLL/LIB源树资产且去掉旧upstream .env文件，属于归档组成差异；
这些Packet资产未链接，也不在4文件运行载荷。不要拿该未筛选归档发给收件人；使用已筛选1262文件kit。
core20284928B/f716a113、CLI6160896B/1ad46380均重新编译，旧core20107264B/d4f、CLI6050816B/b84f。
两程序增加bcryptprimitives.dll和api-ms-win-core-synch-l1-2-0.dll导入，移除msvcrt.dll；
无Packet/wpcap/Npcap/pnet或新的动态CRT依赖，两个driver原字节未变。运行库选择会影响实际加载/运行，
不能用Rust源码不变推导modern功能已经PASS。此方案面向Win10/11，不补测Win7兼容。实际N0只证明被测OS build；若最终声明Win10和Win11均已验收，
分别保留支持版本的实际加载/N0证据，不能用一台机器的PASS代替另一OS。本阶段不启动WindowsVM。

## runner继承与重新冻结

继承真正PASS的local pwsh7候选：原f273/schema6/a071自身没有执行，不能退回Windows PowerShell入口。
PASS schema7/981da5b3的3项pwsh源码改变已在旧结果中列明，19个最终pin均核对；授权已消耗。
不改成功的40秒full collector、5秒light、1秒pause、PID跨查询身份、2次clean samples或65秒请求停逻辑。

新owner首先独立冻结新runner commit，更新SCOPE source/tree/patch/profile/core+CLI大小/hash/路径，
EXPECTED_UDP_PLAN的source/core和原producer证据、当前notice/inventory/BOM pins，再重新计算19个源码pin。
原BUILD validator只接受schemaVersion2/files4，而modern原BUILD为schema1/artifacts2加driverReferencesOnly2；
原PE audit的行字段/文件路径也不同。必须做严格schema适配，保留原证据bytes/hash，不伪造旧schema或关掉gate。
原19pins没覆盖policy本身、approval/dispatch wrapper等全部可调用入口；一并固定wrapper入口hash和one-shot lock。

变更后只需定向纯检查：拒旧d4f/b84与旧dbaf/a071/981批准，拒错误4文件/原receipt/hash/feature/profile，
拒混用新EXPECTED_UDP_PLAN和旧source；验证raw forbidden counts保留、extra UDP/nonloopback RPC仍拒绝；
验证pwsh7入口、schema原证据检查与超时/ACK/cleanup模拟。无需重跑无改动UI或完整SDK协议纯测试。
最终新scope必须同时覆盖准确输入与当前受保护GUI/网卡/driver信息；本交接不提前给可激活scope hash。
由指定owner完成当前只读preflight、确认PID/保护对象/alias/IP/RPC冲突及4文件不可变，再由父收集明确的新scope批准。
不默默把保护对象换成其他PID，不启动试探性core，不允许自动重试，不删残留网卡/NetworkList/driver以补PASS。
parent报告的历史review拒绝与所有旧失败保留；准备工作不等同于原审批被撤销或新批准。

## 最少实际场景，按阶段分别授权

| 阶段 | 最小场景与输入 | 新证据及停止条件 | 不能得出的结论 |
| --- | --- | --- | --- |
| N0现代native起停 | 新scope下exact f716 core，仅no-peer、无ET listeners/STUN/UPnP/转发；CLI只hash核对；已有ET GUI保护 | 1次正常UAC，65秒内请求停；完整before/prepared/during/after+light；NIC地址/安全路由与native receipt匹配；稳定PID的UDP wildcard最多1；ACK+exit0+2light及post-full无NIC/RPC；old配置0差异，NetworkList新增保留 | 不是peer/community、CLI RPC、语音、游戏或UDP egress测试；driver API维护风险仍在范围说明中 |
| C1真实community生命周期 | 新媒体/网络scope批准后，2台Windows客户端、一个隔离且真实鉴权的测试community；使用exact842/portable3cff及原四文件，原运行系统不动 | 正常加入、拒未授权/跨房、借用认证socket；CLI只向本测试community loopback RPC取一次状态；ET由community持有，voice切房/退出不关闭ET，离开community/退出app只收尾自己instance，无foreign stop | 不证明multi-community并发，LAN可达不授予跨房媒体；CLI hash不是CLI执行验收 |
| V1完整app双向声音 | 同2客户端/已批准账户设备；一次实际mic→对端speaker双向通话，先普通SFU，再受控P2P机会 | 精确selectedTrack/PC epoch、RTP+decode和双向听到证据；SFU48/P2P64保留已有custom/cap；manual mute/PTT最终gate、取消/切房，无误示发送或Path | 不借沿用SDK loopback/TEST fixture宣称设备或完整app已验；实际physicalDirect需独立传输证据，否则保持unknown |
| V2单次路径失效恢复 | 仅隔离fixture/session中制造一次选定路径失效，正常房间授权保留 | P2P不可用时SFU恢复；如要验证停SFU转P2P，另列该具体网络scope并保留其恢复观测。fresh ACK+真实decode恢复、borrowed socket/track不误关，退出清理 | 不改变生产SFU、公共ET节点或全机网络；不把metadata/glyph变化当actual media恢复 |

C1/V1/V2可在一个明确授权、固定输入的2客户端会话中顺序取证，避免为每个按钮重复搭建环境；
N0旧no-peer授权不能覆盖它们。媒体scope需要账户/设备/对端/测试server、限定时间和网络变化范围，
凭据由父在许可渠道安排，不进入本Git/材料。若当前portable与冻结source/hash不一致先停，不为测试偷偷重打app。

游戏共存若仍是本次发布目标，只在父选择的一款游戏/测试session和短时间预算内检查app/native同行运行、
前台/帧时间异常和退出cleanup；不自动启动游戏或Sigua，不与父的Sigua性能研究抢槽。
现阶段无需盲目重跑旧dbaf已通过N0、已有Provider/SFU48/P2P64协议proof、33条生产UI fixture、
纯测试或20人重槽。4x5/2x10历史容量是2SDK+18 RTP replayer，不能升级成20完整app/device通过；
若最终发布要求20完整客户端，父再单独安排容量验收，其不属于modern CRT加载证明。

## 当前状态

runtime ZIP17bdccba的4文件和原producer/build/import/current文档已静态重核；source delta与导入差异已核。
没有生成新的可执行trial，不做OS快照/监听/core/CLI/TUN/应用/麦克风/网络执行，不改runner或产品源码。
ready=false/finalPackage=null。需要的是指定owner的schema/pin冻结与新实际激活授权，旧N0不必重跑。

Policy/source hash closure：含SCOPE的policy与全部可调用wrapper用不可变runner commit及外置SOURCE-PINS manifest固定。不要将policy自身hash塞进自身SCOPE形成自引用；最终批准同时绑定新scope及冻结源码/入口closure。原producer INPUT-HANDOFF与两个整合modern receipt的额外hash也列入本次准备receipt。

C1/V1实际媒体必须使用经批准的普通app路径；--laokuai-ui-check-dir模式会deny capture/网络/native IPC，不能用于真实通话。普通main的HTTP/mDNS/会话网络和可能的hotkey/helper启动必须在未来实际启动scope中先按exact ASAR源码核清范围；不能沿用N0无peer的端点上限作为整个app网络策略，也不能为方便测试悄悄绕过production/profile/auth门禁。

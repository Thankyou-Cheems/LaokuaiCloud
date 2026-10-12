# SFU 有界退出源码冻结

源码提交 `011f12b92af2732cc6a86a088c5f753dfd5c1a14`，SFU tree `3d64d5904681d59590be940870ce045e5c1577ff`。仅17个SFU源码/测试路径改变；backend、client、SDK、ET字节保持。停电前11个改动文件已在owner本地独立备份，没有reset或覆盖成果。

原精确镜像PID1 TERM/stop exit2来自未安装显式信号协调器；原镜像/日志保持封存。新源码捕获TERM/INT，共用5秒总预算，关闭public/control/可选metrics HTTP、升级WebSocket及实际handler、keepalive、peer PC、track/lease、周期任务与UDP readiness；peer运输释放后关闭共享UDP mux。阻塞JSON writer不能阻止底层连接关闭；真实关闭/监听失败保持非零。正常ErrServerClosed不再走log.Fatal，完成标记为SFU shutdown complete。没有修改auth/codec/Hybrid协议、端口、STUN策略或loopback候选默认值。

15项针对性关闭测试及8个包编译检查通过，Go1.27.0 Windows，GOPROXY/GOSUMDB=off、单编译任务、独立owner缓存。测试含真实gorilla WebSocket在内存net.Pipe上的阻塞writer关闭，不创建OS listener；其余为闭锁/期限/取消与资源契约。缺失未使用依赖缓存被记录，不声称全部module测试或完整依赖闭包通过。go.mod/go.sum保持原Git blob。

99个准确Git源文件包位于owner本地 `sfu-term-build-delivery/sfu-011f12b9-source.zip`，192373B，SHA256 `f202c9cc9db362692910c31345355bf1e1555ae90be70fd3a9232fa6ef1c5776`。同目录HANDOFF.json给出每个Git blob/SHA256及重建清单；ZIP不导入Git。只需指定builder重建SFU，使用原固定基础镜像摘要、Go1.25.14、Linux/amd64、CGO0及独立版本 `laokuai.hybrid.shutdown.011f12b9`。revision label必须为上述commit，component-tree为上述tree。保持原e0f67b7c镜像tag/证据，backend e45e9c27继续原值。

指定builder已完成新Linux镜像：OCI manifest `sha256:d38ed22ddbed419661ba20b2c0bf008b18d07e05446c0c813c05a022883aafc6`，config/classic ID `sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f`。TAR10624000B/SHA256 `102fba9de73bb8eb9cb5e47171e5938330635a9dc827e27085ea800a632ceaaf`，ELF13365432B/SHA256 `4232d60e7967ca7edcd10ca188e6fdcf941683da71884fd6680bd6da38897a77`；Task6只读独立重哈希两件产物匹配。

builder独立network=none验收默认ENTRYPOINT/PID1 TERM、INT、普通docker stop，均exit0、5秒内完成、无SIGKILL/OOM/panic、残留0。见 acceptance/sfu-shutdown-image.json。真实bind/config失败、认证升级/待join连接及活跃room/RTP/lease drain仍未实际验收。15项纯检查、三项无媒体PID1验收和活跃媒体清理分别记账。

原仅lo/networknone媒体阻塞保持；本修复不新增loopback模式。父已收到人工批准的窄3容器internal bridge范围，执行转交指定build owner；Task6未建网络/容器。四容器V2提案未批准。统一manifest分别引用源码与镜像回执，ready=false/finalPackage=null，无部署或远端push。

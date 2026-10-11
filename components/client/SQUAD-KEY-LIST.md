# Squad 闭麦触发键列表候选

基线 client a4693bfbd58badff53ad935e7fca0cebf9634a98；独立 codex/squad-key-list 工作树。本轮只修改普通客户端源码，未构建或启动 portable、游戏、native helper、全局钩子或网络 fixture。

首次配置默认 B/G/V。用户可以添加、编辑、删除任意数量的支持组合；不再限制3或6项。删除至零项保留 keys:[]，显示“尚未配置”，不创建新的 input helper；显式“恢复 B/G/V”才恢复默认。录制空行不立即保存。相同组合（含修饰键重排）去重，新增重复项提示错误；不同组合可共用主键。与通话快捷键的已有冲突检查保留。

仓库历史配置本来是 keys 数组，三行旧UI的现有数组、enabled/processDetection/processTarget 完整保留；没有找到已发布的独立三字段存储。另显式支持兼容入口 squadRadioKey/commandRadioKey/localVoiceKey：依次迁移有效字符串，空字符串代表未设置；keys（包括空数组）优先。此兼容入口不宣称是已发现的生产 schema，不猜其它字段名称。损坏/未知键保留用于错误诊断，不偷偷换回 B/G/V。

任一匹配主键被按住则保留临时闭麦原因；重复事件不重复计数，全部释放后经过200ms hangover及既有SDK fresh音频恢复。删除/改掉正在按住的绑定、关闭模式、改变进程条件时，旧主键仍被 helper 请求观察到可信物理松开。配置切换前已收到但等待 metadata 的按下边沿也保留；旧 helper 回调不能影响新实例。输入不可用时显示明确不可用并保留闭麦，恢复可信快照/重试后可完成松开，不以缺失数据假装释放。

既有SDK config.audio.transmitSuppressionEnabled + useMicrophone().setTransmitSuppressed(boolean) 保持原合同：数组聚合只在客户端，不改成SDK三键/数组接口。graph在闭麦和SDK recovering/suspended/failed期间仍保留；用户关闭开关不伪报实际已开放。user/admin/PTT原因未被本候选写入。native helper只移除12参数截断并去重VK，未更换监听技术或系统键盘设置。

普通源码使用基线的 package/lock；这棵树为节约资源借用隔离客户端 node_modules（其中 Voice 为 opus20.alias.1）作类型/lint验证；首次默认typecheck写入了共享开发依赖缓存，最终已通过 --tsBuildInfoFile 在候选证据目录单独重跑 renderer/main 两项。没有删除或移动依赖链接，未做此树自己的 fresh install或二进制构建。这里只使用两包已有的布尔 suppression API。稳定客户端、用户资料、更新/生产cap/编码配置、既有冻结SDK和交付均未改。本候选应在接入最终稳定树后再做精确安装/构建验证。

验证为纯状态/模拟 child transport/真实组件回调、IME忽略、TypeScript、ESLint与clang -fsyntax-only。没有DOM/浏览器、真实按键、捕获麦克风、音频线程、设备断连或游戏测试，不能称真实闭麦验收通过。自动读游戏配置仍独立研究；未来导入必须显式、标来源并保留自定义项。

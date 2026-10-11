# Private review: exact84292bf source

对应内部portable：129121178 bytes，SHA256
`3cff0c00f1a8441e98af909424081d4b74be08e9aba44d745eaa80d0f0062619`。
客户端来源为 PRIVATE 集成树84292bf；Voice首选源码来源b8f16d0e、当前
tgz为8abea479。此包不含Git历史，不改变任何仓库可见性，不代表已经分享或公开。

## 许可与应随接收者交付的内容

| 部分 | 原始许可记录 | 接收者材料与义务 |
| --- | --- | --- |
| Client及定制TS/Electron/C++/Go构建代码 | package.json及LICENSE均AGPL3-or-later | 提供实际版本首选源码、修改说明、构建/安装脚本、锁文件与必要资源；保留版权、无担保及许可。数字分发可把源码包与二进制并列提供等效获取方式，接收者不需进入本私有Git仓库。若适用AGPL13网络交互，应在对应软件提供源码获取机会。 |
| Voice定制源码、worklet/内嵌DSP与Hybrid/receive-path | package.json AGPL3-only；原LICENSE开头仍写or-later | 两份原记录均保留，不擅自改写上游版权。按共同支持的AGPLv3路径准备交付；记录metadata/text差异，不能声称取得新的许可。提供src、生成脚本及对应当前tgz；compiled dist不是首选源码替代品。 |
| Signalsmith移植/算法相关部分 | 两份MIT声明及源代码归属保留 | 保留原版权和MIT文本；不是另向作者索取许可的待办。首选TS代码也随Voice包提供。 |
| RNN/WebRTC/PFFFT/Abseil/Emscripten产物 | 原11份第三方notice和PATENTS文件 | 提供原notice、固定WebRTC/Abseil源码归档、analyzer C++与build/setup脚本、编译器获取哈希。BSD/MIT保留版权/条款/免责；Apache部分保留适用NOTICE/修改说明。golden PCM是已归属官方WebRTC资源的测试输入，不是本用户录音。 |
| @gryt/ui定制中文包及普通第三方JS依赖 | UI原MIT、其他各原包license及当前yarn.lock | 提供定制UI405文件首选TS/CSS/workspace/锁、19既有+4新文件delta及精确tgz；95 sourcemap源核对通过，未重编译声称字节一致。其他依赖保留各自版权/许可；固定registry归档与源码repo/gitHead。MIT并不单独要求公开我们的修改；组合应用的AGPL对应源码要求仍按实际依赖和程序范围处理。未把所有npm代码统一改为AGPL。 |
| RNNoise降噪wrapper/native与模型 | wrapper Apache2；native BSD3 COPYING | 补充包附固定318df wrapper首选源码、70f1原生C、model_version指定权重及构建锁/脚本；保留Apache许可/版权、适用NOTICE及修改声明和BSD3归属。不同于WebRTC RNNVAD，未改写为MIT或AGPL。 |
| EasyTier现代native、Rust依赖及改过的TUN | 单独筛选native草案bad7e5e4；LGPL/GPL/WTFPL与504 BOM | 原生材料及一次修改库relink由另一sole owner验证；此client/Voice包不能取代native包。提供原许可、preferred source、构建/安装信息；不要求每个收件者实际重建。 |
| Wintun/WinDivert及MSVC/SDK | 原 signed-binary例外、LGPL/GPL、平台条款分别保留 | 精确driver来源与原notice、相应源码路线和平台许可核对，不把所有二进制改称AGPL。此源码ZIP不装入驱动/微软.lib或旧Packet。 |
| Cheems/唠蒯品牌图片 | 用户已批准内部产品使用；不是上游代码许可的自动延伸 | 保留供审核及复现的必要图片，单独列出。对指定收件者分享或公开这些资源时，需要用户对本次分享范围和权利确认；不伪造作者/CC/MIT授权。 |

自定义语音门控、码率/回退接线、Provider观测、UI、中文、native身份及辅助程序
等候选修改都在直接源码中。`CLIENT-VOICE-SOURCE-MANIFEST.json`按文件列出与
已核实public fork默认分支commit相同的Git blob及其余候选字节；其余文件必须
由我们的交付补齐，不能只给不对应版本的public repo首页。匹配某个公开基点的
文件也直接附在本包，避免接收者依赖漂移main。

排除本地work order/AGENTS、单机TUN诊断脚本、研究测量输出、旧SDK包、历史
非源码调查元数据。排除不触及Client/Voice生产src、Electron、native/helper
首选源码、构建配置、当前lock/package以及RNN原材料。完整private统一仓库及
3554文件旧整体ZIP都不是本次公开方案。

## 获取方式的选择

1. 内部审核：保留在本工作区；无人被授予外部访问，不需要公网源码URL。
2. 指定接收者分发：用户批准人/组织及渠道后，把本源码ZIP、native源码kit和
   索引/notice与相应binary一同交付。收件者必须能够获得适用许可权利；不能
   用“私人发送”再附禁止依法修改/再分发的条款抵消AGPL/GPL权利。
3. 面向公众数字分发：先批准明确的已筛选文件和目标，例如在既有public fork
   发布独立source snapshot/release附件，或专用源码下载位置；不公开PRIVATE
   集成repo及历史。源码可在不同服务器，但binary下载处要明确指向同版源码。

分享动作尚未授权/执行。源码材料存在而无公网URL不阻塞内部relink/UI/音频测试。
源码访问测试应证明所选收件人/访问者可取得完整、校验匹配材料，不要求所有
接收者执行编译。当前未证明此筛选app包独立编译；不把producer缓存复现冒充
新收件环境通过。native重槽任务与本材料工作互不覆盖。

依据：[AGPL3 sections1/4/5/6/13](https://spdx.org/licenses/AGPL-3.0-only.html)、
[MIT](https://spdx.org/licenses/MIT.html)、
[BSD3](https://spdx.org/licenses/BSD-3-Clause.html)、
[LGPL3 section4](https://spdx.org/licenses/LGPL-3.0-only.html)、
[Apache2 section4](https://www.apache.org/licenses/LICENSE-2.0)。
此为按原文本准备的工程交付方案，尚无法律清关/公开发布结论。

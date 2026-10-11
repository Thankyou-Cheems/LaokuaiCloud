# Frozen acquisition and build recipe (review only)

把三个源码ZIP解到同一独立REVIEW目录；REVIEW在命令里代表其实际绝对路径。
先将 $reviewDir 设为实际绝对目录；下列命令使用 Join-Path。
`source/components/client`与`voice`是原始Git
字节，不依赖本私有仓库、账号或生产profile。所有命令是准备给未来获授权的
收件者/构建者，Task6不执行应用/辅助程序/网络监听/昂贵编译。

## 固定依赖获取

Client当前yarn.lock SHA256
`d2d38246a119b974b724d96846c11dfb191c2b177786316d82238180e1ba5032`。
用Node24.10.0和Yarn1.22.22；锁中的每个resolved URL和integrity/SHA都随原文
交付，`DEPENDENCY-ACQUISITION.json`给出可核对的记录。正常公网获取使用
已锁registry归档，不要求repo访问凭据；第一次允许取包，再用缓存offline。
不得改latest、改lock或把producer全局缓存当成已交付材料。

```powershell
Set-Location (Join-Path $reviewDir "source/components/client")
yarn install --frozen-lockfile --ignore-scripts --network-concurrency 1 --cache-folder "$reviewDir/dependency-cache"
```

当前`vendor/gryt-voice-0.6.2-laokuai.receive-path.1.tgz`随包，SHA256
`8abea479d053b6310e8c97746ae8b07f153a17d691dc20bdd5a241b6fe90caed`。
核对212 packed文件和随包Voice源码。若重新生成SDK，用Voice本目录package.json
和其锁文件；其build会核对/生成内嵌worklet代码并编译TS。重新pack后的tgz可能
改变归档字节；比较packed文件内容，再在独立修改版本更新client依赖/lock。

```powershell
Set-Location (Join-Path $reviewDir "source/components/voice")
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
```

RNN WASM首选C++与固定WebRTC2.1/Abseil20240722.1归档已附；查看
`voice/third-party/receive-rnn/setup_sdk.sh`和`build.sh`。Emscripten4.0.20是
明确的工具依赖，SDK下载哈希随源码；不声称已经附完整SDK。此Bash/Python3
工具链是该参考WASM复生路线，普通SDK TS build使用已记录的内嵌模块；无须为
验证app源码导出重跑RNN重槽。生成的dist/gryt-rnn.wasm对应 `src/audio/processors/receiveAnalyzerAsset.ts`
的RECEIVE_ANALYZER_BASE64，当前解码SHA256为
`21b6eb801901c5250215ff6a29b83471b13cdf45b69ba3fe438770b391a1d95b`。
额外交付的 `operations/receive-analyzer-asset.cjs` 可检查/提取，并在未来独立
修改副本中嵌入新WASM；运行原worklet生成脚本后再npm run build。Task6只做
当前嵌入hash和脚本静态校验，未重建WASM。

Electron固定40.6.1。`--ignore-scripts`不会自动下载二进制；未来builder需从
官方v40.6.1 Windows-x64 ZIP和SHASUMS256.txt取得并验证相同输入，或使用明确
提供且校验相同的缓存。不能由Vite通过误称Electron runtime已经获取。
官方获取说明：https://www.electronjs.org/docs/latest/tutorial/installation
electron-builder26.8.1使用自己的固定vendor工具获取/cache；记录工具版本/哈希，
不用producer私人路径。Windows C++ helper需合法VS2022 x64/SDK环境；native
core/CLI另用固定Rust/MSVC/protoc和筛选nativekit，不装复制的微软.lib。

## 定制UI的首选源码

Client还锁定 `vendor/gryt-ui-0.44.0-zh-cn.tgz`，SHA256
`a2f38b3efb98dec64df486d11472d93e0c61bc7e36770a19f27d12b15f8d9822`，
不是未改的registry包。将 `custom-ui-preferred-source-private-review.zip`
解到REVIEW，得到ui-preferred-source，405文件含TS/TSX/CSS、theme/owl/ui-native
workspace、bun.lock及构建配置。95 sourcemap内源文件与这些首选源码只忽略
CRLF后逐项一致；相对公开gitHead febd530f为19个既有文件内容差异+4个新文件，
配套patch和逐项manifest保留。原MIT/版权随源码和依赖包保留。

```powershell
Set-Location (Join-Path $reviewDir "ui-preferred-source")
bun install --frozen-lockfile --ignore-scripts
bun run build:lib
cd packages/ui
npm pack --ignore-scripts
```

workspace原声明Bun1.2.0；未来取得对应工具并记录哈希。原tgz仍直接附在Client，
源码重建尚未在收件环境执行；95源映射检查不声称重新编译104个不同packed
文件的字节一致。修改后重pack应在独立副本更新版本及Client依赖/lock，不能
用公共npm UI替换定制tgz再声称同版。

## RNNoise降噪依赖的独立首选源码

`rnnoise-preferred-source-private-review.zip`附 @shiguredo/rnnoise-wasm2025.1.5
原npm归档（integrity/SHA1已与registry核对）、首选TS/构建/锁文件commit
318dfdecdc2ddf3b33fe01a89ed8273ba0374ddc，原生RNNoise C源码commit
70f1d256acd4b34a572f999a05c87bf00b67730d，以及其model_version指定的58,603,099B
权重源归档，SHA256 `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`。
原wrapper Apache2及RNNoise BSD3文本单独附。此实现不是上面的WebRTC RNNVAD。

在独立获授权Bash工具环境按原build-rnnoise.sh使用Emscripten4.0.8，Autoconf/
Automake/Libtool；它的native commit和模型hash已固定。将附model归档放到该
RNNoise源码根目录，保留上游download_model.sh校验；原wrapper脚本会clone固定
native commit，可在独立副本把获取部分改为本地已校验源码而保留编译步骤。
随后使用原pnpm-lock.yaml进行pnpm install --frozen-lockfile和pnpm build。
这是未来源码复生路线，本轮未执行；不把官方现成WASM称为新编译验收。

## 编译/打包而不运行

```powershell
Set-Location (Join-Path $reviewDir "source/components/client")
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
$env:ELECTRON='1'
node node_modules/vite/bin/vite.js build
```

VS x64 shell内运行`cmd.exe /d /c native\build.bat`构建audio/screen helper，
并按`native/squad-scope/build.bat`的实际参数构建Squad。仅编译，不执行helper。
Go通用helper有自己的go.mod/go.sum及`build-helper.mjs`，本Windows slim候选
是否使用它以实际资源配置为准，不把所有平台helper算作已装入payload。

native当前四文件 `laokuai-modern-static-runtime-input.zip`（SHA256
`17bdccbab2d78b42642bbf934efb4c4bf9329a97ce4ed16685c3b5659f54ca74`）只用于复现原binary资源，不属于源码ZIP；
指定接收者分享该运行资源也要在明确授权范围内。`screened-recipient-source-materials-private-draft.zip` 是源码路线，SHA256
`bad7e5e4b3a666d63876eaa5910cf6e3aaafc927330521682adb5a80267c6205`。
另附索引锁定 `recipient-build-tools-supplement.zip`，SHA256
`24879c3a920fc4a12d2b30baa2c779ff8b9ebed3e13411861b563d8372560688`。
runtime ZIP 与构建receipt/package路径见 source/components/easytier/provenance.json
的 privateBuild.*Path（相对于client根），保持Windows资源manifest/四文件路径一致。
相关 receipt 原字节随源码交付，ZIP单独取得；不要用导出包缺席误称原pack通过。当前
生产分发gate=false仍会拒绝正式打包；不能改其证据为真来“复现”。

本包`operations/internal-builder.cjs`是84292bf producer的原始test-only
wrapper字节，`../source/components/client`布局匹配本包。其明确限定内部候选、
不publish、保留生产gate失败并检查精确资源/过滤器。未来单独授权内部构建
才可执行：先创建 (Join-Path $reviewDir "evidence") 和
(Join-Path $reviewDir "artifacts") 目录，再从client运行
`node node_modules/electron-builder/cli.js --config "$reviewDir/operations/internal-builder.cjs" --win portable --x64 --publish never`。
当前未安排第二次app构建。该wrapper不是公开发行配置或法律授权。

## 修改版本与安装资料

原product asset loader严格校验core/CLI/profile/receipt；随便替换EXE会拒绝。
首选loader/所有校验脚本随Client交付。修改版本可在独立源码副本更新本地
hash/receipt/profile常量与打包输入后重建，不涉及我们server认证秘密。无
签名密钥才能编译的要求；本候选本来unsigned。AGPL/LGPL允许的修改权不
应被我们发行条款禁止；当前生产/TUN授权仍不能由这些技术步骤代替。

此方案提供指定版本的源码及取得依赖路线，不承诺完全离线app重建已验；
独立收件编译、平台条款、分发访问验证和原产品验收分别记录。

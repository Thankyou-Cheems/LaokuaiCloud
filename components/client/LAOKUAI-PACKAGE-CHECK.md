# 唠蒯云最终绿色包清单与静态检查

本补丁基于完整候选快照 `2b9f02076051e3a445bfa99e79d1fc7ac421e19f`（父 HEAD `552dc88f3413b83ee29bdb4ab350286e7c9ad2d0`）。当前源码版本 `1.13.22-laokuai.opus20.1`，锁定 Voice `0.6.2-laokuai.opus20.alias.1`，vendor SHA256 `b47b268005f1d34b9aa4e7eea2468f4a045559a90bc25882a7e6d09e4ed2949c`。后续主 owner 更换版本/SDK 时，清单从最终 package/lock/vendor 自动读取，不沿用这里的旧哈希。

修复：随包携带 `legal/PRIVATE-PROFILE-REUSE.md` 和 `legal/SQUAD-KEY-LIST.md`；原包中的说明引用了它们但未实际打入。打包前逐文件比对 installed Voice 与锁定 vendor tar 的 dist/package/license，要求 helper 的源码和二进制构建收据；修正两个旧 artifact 校验脚本的固定输出目录/EXE名称及 SDK版本。托盘纯测试改读 PNG IHDR，不加载 sharp/native addon。

保持显示名唠蒯云、appId `local.laokuai.chat`、源码内部名 `gryt-chat`、既有 private 包内部名 `laokuai-chat`、默认 `laokuai-chat-data/sessions` 和显式 `--user-data-dir` 旧 profile 原位复用。管理员快捷方式参数保持原值，由用户/主 owner 继续使用；不创建、复制或读取真实身份。新奇丽叶 logo 未纳入任何打包资源。手动更新入口保留版本和升级说明，官方 updater 下载/安装/feed 禁用。

## 最终 owner 的唯一打包顺序（本任务没有执行这些构建）

在主 owner 的最终隔离整合目录执行；需要已有匹配依赖材料、Node 24.10.0/Yarn 1.22.22、Windows x64 C++ 工具。先合入本 commit，再合入其余已批准修复、确定最终版本与 SDK；全部构建顺序执行。继续使用现有 Yarn 离线缓存/构建材料，不另生成 npm/pnpm lock。`native/squad-scope/build.bat` 成功编译后自动生成收据，不能给旧 helper 手工补收据代替编译。

```powershell
$env:UV_THREADPOOL_SIZE = '2'
$env:CHILD_CONCURRENCY = '1'
$env:GOMAXPROCS = '2'
$env:RAYON_NUM_THREADS = '2'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:GRYT_MAS = ''
$env:GRYT_VARIANT = 'slim'
$env:ELECTRON = '1'
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '1'

yarn install --frozen-lockfile --offline --ignore-scripts --network-concurrency 1
if ($LASTEXITCODE -ne 0) { throw 'frozen offline install failed' }
# 仅当构建材料中的 Electron runtime 尚未就绪，按既有离线流程安装；不运行应用。
cmd /d /c native\build.bat
if ($LASTEXITCODE -ne 0) { throw 'native capture build failed' }
cmd /d /c native\squad-scope\build.bat
if ($LASTEXITCODE -ne 0) { throw 'Squad helper build/receipt failed' }
node node_modules/typescript/bin/tsc -b
if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
if ($LASTEXITCODE -ne 0) { throw 'lint failed' }

foreach ($check in @('check-laokuai-package-audit', 'check-private-profile-upgrade',
  'check-private-startup', 'check-private-profile', 'check-private-defaults',
  'check-squad-broker', 'check-squad-key-list-ui', 'check-laokuai-integration',
  'check-voice-transport-preset', 'check-i18n')) {
  node ("scripts/" + $check + ".mjs")
  if ($LASTEXITCODE -ne 0) { throw ("Pure check failed: " + $check) }
}
# 需要的协议/容量验收由主 owner 另行汇总。

node node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { throw 'desktop renderer/main build failed' }
node -e "require('./scripts/write-i18n-test-notices.cjs').writeNotices(process.cwd())"
node scripts/check-laokuai-package.mjs --out build/legal/LAOKUAI-PACKAGE-MANIFEST.json
if ($LASTEXITCODE -ne 0) { throw 'package preflight failed' }
node node_modules/electron-builder/cli.js --config=electron-builder.laokuai.cjs --win portable --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'portable build failed' }
```

使用既有低优先级构建 runner（BelowNormal、affinity 3）运行这些步骤；不要采用 `electron:build` 通用脚本，它选用另一份配置。`beforePack` 再次生成实际最终清单；清单在 EXE 外 `build/legal/LAOKUAI-PACKAGE-MANIFEST.json`，随匹配源码/锁/vendor/测试证据交付。清单包含源码、安装版本、打包映射、dist/dist-electron 的完整 bytes/SHA256、所有 legal/native/tray 资源、helper收据、内嵌接收 WASM 哈希与实际 RNNoise worker 名。

## 只解包和读取，不执行 EXE

使用新的唯一检查目录，下面两个 7z 调用只是静态解档。NSIS portable wrapper 允许是 x86；内层客户端和 helpers 必须 AMD64。检查 app 与 wrapper 的 PE RT_ICON payload 均对应批准的 Cheems ICO，并检查无签名。

```powershell
$cfg = node -e "const c=require('./electron-builder.laokuai.cjs');const p=require('./package.json');console.log(JSON.stringify({dir:c.directories.output,artifact:c.portable.artifactName.replace(String.fromCharCode(36)+'{version}',p.version)}))"
$meta = $cfg | ConvertFrom-Json
$artifact = Join-Path (Resolve-Path $meta.dir).Path $meta.artifact
$checkRoot = Join-Path (Resolve-Path '.').Path ('build/archive-check-' + [guid]::NewGuid().ToString('N'))
$outer = Join-Path $checkRoot 'outer'
$payload = Join-Path $checkRoot 'payload'
& 'C:\Program Files\7-Zip\7z.exe' x $artifact "-o$outer" -y
if ($LASTEXITCODE -ne 0) { throw 'portable static extraction failed' }
& 'C:\Program Files\7-Zip\7z.exe' x (Join-Path $outer '$PLUGINSDIR\app-64.7z') "-o$payload" -y
if ($LASTEXITCODE -ne 0) { throw 'inner archive extraction failed' }
node scripts/check-laokuai-package.mjs --payload $payload --portable $artifact --manifest build/legal/LAOKUAI-PACKAGE-MANIFEST.json --out (Join-Path $checkRoot 'archive-report.json')
if ($LASTEXITCODE -ne 0) { throw 'archive verification failed' }
```

不要使用 `verify-private-integration.mjs` 总 runner：它含 Electron profile 实测与其它超出本轮限制的步骤。新 `check-private-profile-upgrade.mjs` 只执行 Node、实际 userStore 和工作区合成 `gryt-chat` 资料，验证跨两个独立进程设置重载、原 session路径、false/0/null/空字符串、空 Squad keys、模拟全局设置与 IndexedDB sentinel不被改名/迁移；未打开 Electron IndexedDB，未验证真实管理员登录。

`--source-only --out <file>` 允许输出缺少构建收据时的观察清单；该清单明确标记 sourceOnly，归档验证会拒绝它。只有正常 preflight 的清单可以验证最终包。当前借用旧编译资源，helper缺少新收据被明确拒绝；这不是最终包验收通过。旧 portable SHA256 `963c3d74dac31b78c9c19c8f862d884fa195960953e2a2a398278d0436751aa2`，旧 app.asar SHA256 `23ae81f644bfa448881395021fb0452c016d96dccd78778fe56400e013ddfddc`，两者均不是此次最终交付。

边界：没有构建/启动 Electron、helper、浏览器、监听 fixture、安装包或 Docker；没有真实 profile、真实身份/输入/音频/设备/通话/容量验收；没有生产变更或 push。精简配置继续使用同一 SDK/协议，EasyTier/P2P 仍是尚未真联测的原型，不能标为正式集成完成。

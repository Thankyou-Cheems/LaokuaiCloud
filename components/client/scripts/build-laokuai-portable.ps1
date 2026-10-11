$ErrorActionPreference = 'Stop'
$taskBuildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskBuildRoot
$taskProcess = Get-Process -Id $PID
$taskProcess.ProcessorAffinity = [IntPtr]3
$taskProcess.PriorityClass = 'BelowNormal'
$env:UV_THREADPOOL_SIZE = '2'
$env:CHILD_CONCURRENCY = '1'
$env:GOMAXPROCS = '2'
$env:RAYON_NUM_THREADS = '2'
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '1'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:CSC_LINK = $null
$env:CSC_KEY_PASSWORD = $null
$env:WIN_CSC_LINK = $null
$env:WIN_CSC_KEY_PASSWORD = $null
$taskTools = Join-Path $taskBuildRoot 'local-build-tools'
New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
$env:ELECTRON_BUILDER_CACHE = Join-Path $taskTools 'electron-builder-cache'

& yarn install --frozen-lockfile --ignore-scripts --network-concurrency 1
if ($LASTEXITCODE -ne 0) { throw 'Yarn dependency install failed' }
& node node_modules/electron/install.js
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed' }
& cmd /d /c native\build.bat
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed' }
& cmd /d /c native\squad-scope\build.bat
if ($LASTEXITCODE -ne 0) { throw 'Squad scope helper compilation failed' }
& node scripts/convert-laokuai-icon.mjs
if ($LASTEXITCODE -ne 0) { throw 'Icon conversion failed' }

$taskArchive = Join-Path $taskTools 'winCodeSign-2.6.0.7z'
if (!(Test-Path -LiteralPath $taskArchive)) {
  Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $taskArchive
}
$taskExpectedHash = 'e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4'
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA512).Hash.ToLower() -ne $taskExpectedHash) { throw 'Windows tool checksum mismatch' }
$taskToolCache = Join-Path $env:ELECTRON_BUILDER_CACHE 'winCodeSign\winCodeSign-2.6.0'
& node_modules/7zip-bin/win/x64/7za.exe x $taskArchive "-o$taskToolCache" '-xr!darwin' '-xr!linux' -y -bd
if ($LASTEXITCODE -ne 0) { throw 'Windows tool extraction failed' }
& node node_modules/typescript/bin/tsc -b
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
& node scripts/check-laokuai-integration.mjs
if ($LASTEXITCODE -ne 0) { throw 'Own integration checks failed' }
$env:ELECTRON = '1'
& node node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { throw 'Electron bundle build failed' }
& node node_modules/electron-builder/cli.js --config=electron-builder.laokuai.cjs --win portable --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Portable packaging failed' }
Write-Output 'Created own portable package. It has not been executed.'

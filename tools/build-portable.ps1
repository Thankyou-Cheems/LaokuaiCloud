[CmdletBinding()]
param([ValidateSet('Compile','Package','All')][string]$Stage = 'All', [string]$NodePath)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$client = Join-Path $root 'components/client'
if (!$NodePath) { $NodePath = Join-Path $root '.local/toolchains/node24/node.exe' }
$env:Path = "$(Split-Path -Parent $NodePath);$env:Path"
$env:UV_THREADPOOL_SIZE = '2'
$env:CHILD_CONCURRENCY = '1'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:GRYT_MAS = ''
$env:GRYT_VARIANT = 'slim'
$env:ELECTRON = '1'
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '1'
$process = [Diagnostics.Process]::GetCurrentProcess()
$process.PriorityClass = 'BelowNormal'
$process.ProcessorAffinity = 3
Push-Location -LiteralPath $client
try {
    if ($Stage -ne 'Package') {
        & (Join-Path $client 'scripts/build-community-broker.ps1')
        & $NodePath node_modules/typescript/bin/tsc -b
        if ($LASTEXITCODE -ne 0) { throw 'Application types failed' }
        & $NodePath node_modules/vite/bin/vite.js build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
    }
    if ($Stage -ne 'Compile') {
        # Extract only Windows tools; the upstream archive also contains macOS
        # symlinks which should not require elevating this Windows build.
        $toolRoot = Join-Path $root '.local/toolchains/electron-builder'
        New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
        $env:ELECTRON_BUILDER_CACHE = Join-Path $toolRoot 'cache'
        $archive = Join-Path $toolRoot 'winCodeSign-2.6.0.7z'
        if (!(Test-Path -LiteralPath $archive)) {
            Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $archive
        }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash.ToLowerInvariant() -ne 'e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4') { throw 'Windows tool checksum mismatch' }
        $toolCache = Join-Path $env:ELECTRON_BUILDER_CACHE 'winCodeSign/winCodeSign-2.6.0'
        & node_modules/7zip-bin/win/x64/7za.exe x $archive "-o$toolCache" '-xr!darwin' '-xr!linux' -y -bd
        if ($LASTEXITCODE -ne 0) { throw 'Windows tool extraction failed' }
        & $NodePath scripts/write-source-offer.cjs
        if ($LASTEXITCODE -ne 0) { throw 'Exact source offer verification failed' }
        # Codex may keep mapped ASAR/EXE handles in the workspace. Build outside
        # it and copy back only the completed immutable portable executable.
        $packageDirectory = Join-Path ([IO.Path]::GetTempPath()) ('laokuai-package-' + [Guid]::NewGuid().ToString('N'))
        $packageDirectory | Set-Content -LiteralPath (Join-Path $client 'build/legal/package-output-path.txt') -Encoding utf8NoBOM
        & $NodePath node_modules/electron-builder/cli.js --config=electron-builder.laokuai.cjs "--config.directories.output=$packageDirectory" --win portable --x64 --publish never
        if ($LASTEXITCODE -ne 0) { throw 'Portable package failed' }
        $portable = @(Get-ChildItem -LiteralPath $packageDirectory -File -Filter '*-portable.exe')
        if ($portable.Count -ne 1) { throw 'Expected one portable executable' }
        $delivery = Join-Path $client 'release-laokuai-beta-20261013'
        New-Item -ItemType Directory -Force -Path $delivery | Out-Null
        Copy-Item -LiteralPath $portable[0].FullName -Destination (Join-Path $delivery $portable[0].Name)
        Write-Output "Portable ready: $delivery; unpacked verification files: $packageDirectory"
    }
} finally { Pop-Location }

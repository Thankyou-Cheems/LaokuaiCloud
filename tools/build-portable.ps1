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
        & $NodePath scripts/write-source-offer.cjs
        if ($LASTEXITCODE -ne 0) { throw 'Exact source offer verification failed' }
        & $NodePath node_modules/electron-builder/cli.js --config=electron-builder.laokuai.cjs --win portable --x64 --publish never
        if ($LASTEXITCODE -ne 0) { throw 'Portable package failed' }
    }
} finally { Pop-Location }

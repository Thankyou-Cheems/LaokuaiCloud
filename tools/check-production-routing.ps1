#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Voice', 'Gryt')][string]$Component = 'Voice',
    [string]$NodePath
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$NodePath) {
    $bundled = Join-Path $root '.local/toolchains/node24/node.exe'
    $NodePath = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node -ErrorAction Stop).Source }
}
$version = & $NodePath -p 'process.versions.node.split(".")[0]'
if ($LASTEXITCODE -ne 0 -or $version -ne '24') { throw 'Use Node 24 for production-method regressions.' }
if ($Component -eq 'Voice') {
    $nodeDirectory = Split-Path -Parent $NodePath
    $npmCli = if ($IsWindows) { Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js' }
        else { Join-Path $nodeDirectory '../lib/node_modules/npm/bin/npm-cli.js' }
    if (!(Test-Path -LiteralPath $npmCli)) { throw 'The selected Node 24 npm CLI is missing.' }
    $routingPathBefore = $env:PATH
    $env:PATH = $nodeDirectory + [IO.Path]::PathSeparator + $routingPathBefore
    Push-Location -LiteralPath (Join-Path $root 'components/voice')
    try {
        Write-Host '[Voice] Compile current SDK; dist checks test the actual build output.'
        & $NodePath $npmCli run build
        if ($LASTEXITCODE -ne 0) { throw 'Voice SDK build failed.' }
        Write-Host '[Voice] Production-source Peer/controller VM regression is reported separately from dist unit checks.'
        & $NodePath $npmCli run check-hybrid-regressions
        if ($LASTEXITCODE -ne 0) { throw 'Voice production-method regression failed.' }
    } finally { Pop-Location; $env:PATH = $routingPathBefore }
} else {
    Push-Location -LiteralPath (Join-Path $root 'components/server')
    try {
        & $NodePath --test --require ts-node/register src/socket/handlers/voiceHybrid.test.ts
        if ($LASTEXITCODE -ne 0) { throw 'Gryt authenticated pair-handler regression failed.' }
    } finally { Pop-Location }
}
Write-Host "[$Component] PASS: production methods with synthetic browser/server inputs or local test database."
Write-Host 'Product/WAN/media-device acceptance NOT RUN.'

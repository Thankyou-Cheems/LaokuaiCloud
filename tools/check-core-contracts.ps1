# Source contracts only: no Electron, native core, server, device or network launch.
[CmdletBinding()]
param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$NodePath) {
    $bundled = Join-Path $root '.local/toolchains/node24/node.exe'
    $NodePath = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node -ErrorAction Stop).Source }
}
$version = & $NodePath -p 'process.versions.node.split(".")[0]'
if ($LASTEXITCODE -ne 0 -or $version -ne '24') { throw 'Use the pinned Node 24 runtime.' }
Push-Location -LiteralPath (Join-Path $root 'components/client')
try {
    $checks = @(
        'electron/communityEtGrant.test.mjs',
        'electron/communityEtConfig.test.mjs',
        'electron/communityEtRuntime.test.mjs',
        'electron/communityEnrollment.test.mjs',
        'electron/easyTierElevationBroker.test.mjs',
        'scripts/check-community-easytier.mjs',
        'scripts/check-public-community-consent.cjs',
        'scripts/check-community-lan-isolation.mjs',
        'scripts/check-hybrid-product-bootstrap.mjs',
        'scripts/check-community-easytier-types.mjs'
    )
    foreach ($check in $checks) {
        Write-Host "Checking $check"
        & $NodePath $check
        if ($LASTEXITCODE -ne 0) { throw "Source check failed: $check" }
    }
    Write-Host 'PASS: ten source contract suites. Product autojoin/native/media acceptance is separate.'
} finally { Pop-Location }

# Source contracts plus bounded local fixtures: no Electron, EasyTier core, server,
# device, UAC, driver or network launch.
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
        'scripts/check-easytier-voice-underlay.mjs',
        'scripts/check-voice-transport-preset.mjs',
        'scripts/check-member-voice-media-path.mjs',
        'scripts/check-member-voice-receive-translator.mjs',
        'scripts/check-community-easytier-types.mjs',
        'scripts/check-community-lan-clock.mjs',
        'scripts/check-community-quit.mjs',
        'scripts/check-member-lan-status.mjs',
        'scripts/check-connection-details-ui.mjs',
        'scripts/check-connection-topology-icons.mjs',
        'scripts/check-private-startup.mjs',
        'scripts/check-i18n.mjs'
    )
    foreach ($check in $checks) {
        Write-Host "Checking $check"
        & $NodePath $check
        if ($LASTEXITCODE -ne 0) { throw "Source check failed: $check" }
    }
    $fixtureCount = 0
    if ($IsWindows) {
        $pipeCheck = 'scripts/check-community-broker-pipe.ps1'
        Write-Host "Checking $pipeCheck"
        & (Join-Path $root 'components/client/scripts/check-community-broker-pipe.ps1')
        if ($LASTEXITCODE -ne 0) { throw "Local fixture failed: $pipeCheck" }
        $fixtureCount = 1
    }
    $totalChecks = $checks.Count + $fixtureCount
    Write-Host "PASS: $totalChecks checks ($($checks.Count) Node24 source contract suites, $fixtureCount bounded Windows broker-pipe fixtures). Product autojoin/native/media acceptance is separate."
} finally { Pop-Location }

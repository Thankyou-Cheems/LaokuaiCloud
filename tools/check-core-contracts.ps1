# Source/VM contracts and bounded local fixtures. Counts are not media or
# product acceptance; production-method regressions run in separate CI jobs.
[CmdletBinding()]
param(
    [string]$NodePath,
    [ValidateSet('Core', 'SourceContracts', 'Types', 'Presentation', 'WindowsFixtures', 'All')]
    [string]$Group = 'Core',
    [switch]$List
)
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
    $groups = [ordered]@{ SourceContracts = @(
        'electron/communityEtGrant.test.mjs',
        'electron/communityEtConfig.test.mjs',
        'electron/communityEtRuntime.test.mjs',
        'electron/nativeLanAudioRuntime.test.mjs',
        'electron/nativeLanAudioIpc.test.mjs',
        'scripts/check-native-lan-room.mjs',
        'scripts/check-native-lan-provider.mjs',
        'scripts/check-native-lan-hotkeys.mjs',
        'scripts/check-native-lan-facade.mjs',
        'electron/communityDns.test.mjs',
        'electron/communityRelay.test.mjs',
        'scripts/check-community-network-preferences.mjs',
        'scripts/check-member-relay-settings.mjs',
        'scripts/check-invite-link.mjs',
        'electron/communityEnrollment.test.mjs',
        'electron/windowsAdminStartupGate.test.mjs',
        'scripts/check-windows-firewall-rules.mjs',
        'scripts/check-owned-tun-firewall.mjs',
        'scripts/check-owned-tun-session.mjs',
        'scripts/check-community-easytier-direct.mjs',
        'scripts/check-community-easytier-network.mjs',
        'scripts/check-community-easytier.mjs',
        'scripts/check-public-community-consent.cjs',
        'scripts/check-community-lan-isolation.mjs',
        'scripts/check-hybrid-product-bootstrap.mjs',
        'scripts/check-hybrid-readiness.mjs',
        'scripts/check-local-diagnostics.mjs',
        'scripts/check-easytier-voice-underlay.mjs',
        'scripts/check-voice-transport-preset.mjs',
        'scripts/check-member-voice-media-path.mjs',
        'scripts/check-member-voice-receive-translator.mjs',
        'scripts/check-community-lan-clock.mjs',
        'scripts/check-community-quit.mjs',
        'scripts/check-member-lan-status.mjs',
        'scripts/check-private-startup.mjs'
    ); Types = @('scripts/check-community-easytier-types.mjs'); Presentation = @(
        'scripts/check-voice-announcements.mjs', 'scripts/check-kirilie-theme.mjs',
        'scripts/check-connection-details-ui.mjs', 'scripts/check-connection-topology-icons.mjs',
        'scripts/check-i18n.mjs'
    ); WindowsFixtures = @(
        'scripts/check-community-broker-pipe.ps1', 'scripts/check-community-dns-policy.ps1',
        'scripts/check-community-broker-restart.ps1'
    ) }
    $selected = switch ($Group) {
        'Core' { @('SourceContracts', 'Types', 'WindowsFixtures') }
        'All' { @($groups.Keys) }
        default { @($Group) }
    }
    if ($List) {
        foreach ($category in $selected) {
            foreach ($check in $groups[$category]) { [pscustomobject]@{Category = $category; Check = $check} }
        }
        return
    }
    foreach ($category in $selected) {
        if ($category -eq 'WindowsFixtures' -and !$IsWindows) {
            Write-Host '[WindowsFixtures] NOT RUN: this host is not Windows.'
            continue
        }
        Write-Host "[$category] BEGIN (no product/native/media acceptance)"
        foreach ($check in $groups[$category]) {
            Write-Host "[$category] $check"
            if ($category -eq 'WindowsFixtures') { & (Join-Path (Get-Location).Path $check) }
            else { & $NodePath $check }
            if ($LASTEXITCODE -ne 0) { throw "$category check failed: $check" }
        }
        Write-Host "[$category] PASS within its stated source/fixture scope."
    }
    Write-Host 'Product acceptance NOT RUN: no complete client, real media, ET/TUN, UAC or WAN test.'
} finally { Pop-Location }

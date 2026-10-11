param(
    [Parameter(Mandatory=$true)][string]$RestoredDirectory,
    [Parameter(Mandatory=$true)][string]$VcLtlDirectory,
    [Parameter(Mandatory=$true)][string]$YyThunksDirectory,
    [Parameter(Mandatory=$true)][string]$ProtocExecutable
)
# Build-only handoff. Parent-designated sole heavy owner executes this command.
# No application/core/CLI/TUN/driver is launched by this script.
$ErrorActionPreference = 'Stop'
$restoreRoot = (Resolve-Path -LiteralPath $RestoredDirectory).Path
$receipt = Get-Content -LiteralPath (Join-Path $restoreRoot 'NEXT-SOURCE-RESTORATION-RECEIPT.json') -Raw | ConvertFrom-Json
if ($receipt.sourceCommit -ne 'fb3ae901a02f763241ff8d78f1db0b89243fba24' -or $receipt.windowsNormalBuildPackages -ne 504 -or !$receipt.lockUnchanged -or $receipt.nativeBuildExecuted) { throw 'Unverified next-source restoration' }
if ((Get-FileHash -LiteralPath (Join-Path $restoreRoot 'source/easytier/Cargo.toml') -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3c2acac6245433e4058a6bc9f8fa2e48a767d316e67e7cb60838ffefc10b28bb') { throw 'Source overlay differs' }
if ((Get-FileHash -LiteralPath (Join-Path $restoreRoot 'source/Cargo.lock') -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2') { throw 'Cargo lock differs' }
& (Join-Path $PSScriptRoot 'build-restored-native.ps1') -RestoredDirectory $restoreRoot -VcLtlDirectory $VcLtlDirectory -YyThunksDirectory $YyThunksDirectory -ProtocExecutable $ProtocExecutable

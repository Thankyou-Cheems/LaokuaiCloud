#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$RealBaseZip,
    [string]$RealUpdateZip,
    [string]$RealTargetZip,
    [ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedPackageSha256
)
$ErrorActionPreference = 'Stop'
$fixtureStage = 'initialize UTF-8 output'
Write-Host "[NativeUpdater] BEGIN; PowerShell=$($PSVersionTable.PSVersion); Apartment=$([Threading.Thread]::CurrentThread.GetApartmentState())"
try {
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (!$IsWindows) { throw 'The native updater fixture requires Windows/.NET Framework.' }
$fixtureStage = 'resolve isolated fixture directory'
Write-Host "[NativeUpdater] $fixtureStage"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root ('.local/native-updater-tests/' + [Guid]::NewGuid().ToString('N')) }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$allowed = [IO.Path]::GetFullPath((Join-Path $root '.local/native-updater-tests')) + [IO.Path]::DirectorySeparatorChar
if (!$OutputDirectory.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture output must stay in the dedicated repository .local/native-updater-tests directory.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Fixture output already exists; choose a fresh directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$fixtureRoot = Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$fixtureStage = 'create isolated junction fixture'
Write-Host "[NativeUpdater] $fixtureStage; directory=$fixtureRoot"
$junctionTarget = Join-Path $fixtureRoot 'junction-target'
New-Item -ItemType Directory -Path $junctionTarget | Out-Null
New-Item -ItemType Junction -Path (Join-Path $fixtureRoot 'junction-install') -Target $junctionTarget | Out-Null
# The native fixture creates real Unicode .lnk files through IShellLinkW.
# Production Discovery still reads them through its normal WScript getter.
$fixtureStage = 'compile production engine, discovery and form with fixture'
Write-Host "[NativeUpdater] $fixtureStage"
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$binary = Join-Path $OutputDirectory 'NativeUpdaterTests.exe'
$native = Join-Path $root 'tools/native-updater'
& $compiler /nologo /target:exe /main:NativeUpdaterTests /platform:x64 /define:UPDATER_TESTS /utf8output /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$binary" (Join-Path $native 'UpdateEngine.cs') (Join-Path $native 'Discovery.cs') (Join-Path $native 'Program.cs') (Join-Path $PSScriptRoot 'NativeUpdaterTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native updater test compilation failed; fixture material preserved.' }
$fixtureStage = 'validate optional real archive inputs'
$arguments = @($fixtureRoot, (Join-Path $root 'tools/incremental-program-paths.json'))
if ($RealBaseZip -or $RealUpdateZip -or $RealTargetZip -or $ExpectedPackageSha256) {
    if (!$RealBaseZip -or !$RealUpdateZip -or !$RealTargetZip -or !$ExpectedPackageSha256) { throw 'Real fixture requires base ZIP, update ZIP, independent target ZIP and pinned package SHA256.' }
    foreach ($path in @($RealBaseZip, $RealUpdateZip, $RealTargetZip)) { if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Real fixture input ZIP missing.' } }
    $arguments += @([IO.Path]::GetFullPath($RealBaseZip), [IO.Path]::GetFullPath($RealUpdateZip), [IO.Path]::GetFullPath($RealTargetZip), $ExpectedPackageSha256)
}
$fixtureStage = 'run isolated native updater fixture'
Write-Host "[NativeUpdater] $fixtureStage"
$output = & $binary @arguments 2>&1
$result = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }
$output | Set-Content -LiteralPath (Join-Path $OutputDirectory 'results.log') -Encoding utf8NoBOM
if ($result -ne 0) { throw 'Native updater fixture failed; evidence preserved.' }
Write-Host "Native updater fixture passed. Evidence: $OutputDirectory"
} catch {
    # GitHub's outer pwsh wrapper otherwise reports only its invocation line.
    # Retain the actual script line, .NET exception chain and current setup phase.
    [Console]::Error.WriteLine("[NativeUpdater] FAILED at stage: $fixtureStage")
    [Console]::Error.WriteLine($_.InvocationInfo.PositionMessage)
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    [Console]::Error.WriteLine($_.Exception.ToString())
    throw
}
# Preserve the isolated synthetic archives/recovery journals for inspection.
# This development runner never removes user files or launches the product.

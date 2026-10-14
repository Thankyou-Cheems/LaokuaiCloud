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
$shortcutTarget = Join-Path $fixtureRoot 'shortcut-target'
New-Item -ItemType Directory -Path $shortcutTarget | Out-Null
$fixtureStage = 'create existing synthetic shortcut targets'
Write-Host "[NativeUpdater] $fixtureStage"
# Supply existing native paths to the COM setter rather than dangling targets;
# the native fixture later replaces their bytes with its known baseline.
foreach ($targetDirectory in @($shortcutTarget, $junctionTarget)) {
    New-Item -ItemType Directory -Path (Join-Path $targetDirectory 'resources') | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $targetDirectory '唠蒯云.exe'), [byte[]]@(0x21))
    [IO.File]::WriteAllBytes((Join-Path $targetDirectory 'resources/app.asar'), [byte[]]@(0x21))
}
[IO.File]::WriteAllBytes((Join-Path $shortcutTarget 'not-the-app.exe'), [byte[]]@(0x21))
$fixtureStage = 'create WScript.Shell COM instance'
Write-Host "[NativeUpdater] $fixtureStage"
$shortcutShell = New-Object -ComObject WScript.Shell
try {
    foreach ($link in @(
        @{Name='正常 中文链接.lnk';Target=(Join-Path $shortcutTarget '唠蒯云.exe');Arguments=''},
        @{Name='带参数.lnk';Target=(Join-Path $shortcutTarget '唠蒯云.exe');Arguments='--fixture-argument'},
        @{Name='非应用.lnk';Target=(Join-Path $shortcutTarget 'not-the-app.exe');Arguments=''},
        @{Name='重定向.lnk';Target=(Join-Path $fixtureRoot 'junction-install/唠蒯云.exe');Arguments=''}
    )) {
        $fixtureStage = "create shortcut: $($link.Name)"
        Write-Host "[NativeUpdater] $fixtureStage"
        [string]$shortcutPath = [IO.Path]::GetFullPath((Join-Path $fixtureRoot ([string]$link.Name)))
        [string]$shortcutTargetPath = [IO.Path]::GetFullPath([string]$link.Target)
        $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
        try {
            $fixtureStage = "set shortcut target: $($link.Name)"
            $shortcut.TargetPath = $shortcutTargetPath
            $fixtureStage = "set shortcut arguments: $($link.Name)"
            $shortcut.Arguments = [string]$link.Arguments
            $fixtureStage = "save shortcut: $($link.Name)"
            $shortcut.Save()
        }
        finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcutShell) }
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

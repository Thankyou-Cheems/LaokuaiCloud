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
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (!$IsWindows) { throw 'The native updater fixture requires Windows/.NET Framework.' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root ('.local/native-updater-tests/' + [Guid]::NewGuid().ToString('N')) }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$allowed = [IO.Path]::GetFullPath((Join-Path $root '.local/native-updater-tests')) + [IO.Path]::DirectorySeparatorChar
if (!$OutputDirectory.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture output must stay in the dedicated repository .local/native-updater-tests directory.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Fixture output already exists; choose a fresh directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$fixtureRoot = Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$junctionTarget = Join-Path $fixtureRoot 'junction-target'
New-Item -ItemType Directory -Path $junctionTarget | Out-Null
New-Item -ItemType Junction -Path (Join-Path $fixtureRoot 'junction-install') -Target $junctionTarget | Out-Null
$shortcutTarget = Join-Path $fixtureRoot 'shortcut-target'
New-Item -ItemType Directory -Path $shortcutTarget | Out-Null
$shortcutShell = New-Object -ComObject WScript.Shell
try {
    foreach ($link in @(
        @{Name='正常 中文链接.lnk';Target=(Join-Path $shortcutTarget '唠蒯云.exe');Arguments=''},
        @{Name='带参数.lnk';Target=(Join-Path $shortcutTarget '唠蒯云.exe');Arguments='--fixture-argument'},
        @{Name='非应用.lnk';Target=(Join-Path $shortcutTarget 'not-the-app.exe');Arguments=''},
        @{Name='重定向.lnk';Target=(Join-Path $fixtureRoot 'junction-install/唠蒯云.exe');Arguments=''}
    )) {
        $shortcut = $shortcutShell.CreateShortcut((Join-Path $fixtureRoot $link.Name))
        try { $shortcut.TargetPath = $link.Target; $shortcut.Arguments = $link.Arguments; $shortcut.Save() }
        finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcutShell) }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$binary = Join-Path $OutputDirectory 'NativeUpdaterTests.exe'
$native = Join-Path $root 'tools/native-updater'
& $compiler /nologo /target:exe /main:NativeUpdaterTests /platform:x64 /define:UPDATER_TESTS /utf8output /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$binary" (Join-Path $native 'UpdateEngine.cs') (Join-Path $native 'Discovery.cs') (Join-Path $native 'Program.cs') (Join-Path $PSScriptRoot 'NativeUpdaterTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native updater test compilation failed; fixture material preserved.' }
$arguments = @($fixtureRoot, (Join-Path $root 'tools/incremental-program-paths.json'))
if ($RealBaseZip -or $RealUpdateZip -or $RealTargetZip -or $ExpectedPackageSha256) {
    if (!$RealBaseZip -or !$RealUpdateZip -or !$RealTargetZip -or !$ExpectedPackageSha256) { throw 'Real fixture requires base ZIP, update ZIP, independent target ZIP and pinned package SHA256.' }
    foreach ($path in @($RealBaseZip, $RealUpdateZip, $RealTargetZip)) { if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Real fixture input ZIP missing.' } }
    $arguments += @([IO.Path]::GetFullPath($RealBaseZip), [IO.Path]::GetFullPath($RealUpdateZip), [IO.Path]::GetFullPath($RealTargetZip), $ExpectedPackageSha256)
}
$output = & $binary @arguments 2>&1
$result = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }
$output | Set-Content -LiteralPath (Join-Path $OutputDirectory 'results.log') -Encoding utf8NoBOM
if ($result -ne 0) { throw 'Native updater fixture failed; evidence preserved.' }
Write-Host "Native updater fixture passed. Evidence: $OutputDirectory"
# Preserve the isolated synthetic archives/recovery journals for inspection.
# This development runner never removes user files or launches the product.

#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UpdateZip,
    [Parameter(Mandatory)][string]$OutputExe,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedPackageSha256,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (!$IsWindows) { throw 'Build this Windows updater on Windows.' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePaths = @('tools/native-updater','tools/new-native-incremental-update.ps1','tools/incremental-program-paths.json','components/client/LICENSE','components/client/private-brand/icon.ico')
& git -C $root diff --quiet $SourceCommit -- $sourcePaths
if ($LASTEXITCODE) { throw 'Updater sources must match the supplied frozen commit.' }
$untracked = @(& git -C $root ls-files --others --exclude-standard -- $sourcePaths)
if ($LASTEXITCODE -or $untracked.Count) { throw 'Uncommitted updater inputs are not release sources.' }
$zipPath = [IO.Path]::GetFullPath($UpdateZip)
$outputPath = [IO.Path]::GetFullPath($OutputExe)
if (!(Test-Path -LiteralPath $zipPath -PathType Leaf) -or [IO.Path]::GetExtension($outputPath) -ne '.exe' -or (Test-Path -LiteralPath $outputPath)) { throw 'Existing delta ZIP and fresh EXE path required.' }
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedPackageSha256) { throw 'Delta ZIP checksum mismatch.' }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entry = $archive.GetEntry('update.json')
    if (!$entry -or $entry.Length -gt 2MB) { throw 'Missing or oversized delta manifest.' }
    $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { $delta = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
if ($delta.format -cne 'laokuai-fixed-blocks-v1' -or $delta.baseVersion -cnotmatch '^[A-Za-z0-9.+_-]{1,100}$' -or $delta.targetVersion -cnotmatch '^[A-Za-z0-9.+_-]{1,100}$') { throw 'Invalid delta format/version.' }
$outputFolder = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
$build = Join-Path $root ('.local/native-updater-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $build | Out-Null
$sourceUrl = 'https://github.com/Thankyou-Cheems/LaokuaiCloud/tree/' + $SourceCommit + '/tools/native-updater'
$metadata = @"
namespace LaokuaiUpdater {
internal static class EmbeddedUpdate {
    public const string ExpectedSha = "$ExpectedPackageSha256";
    public const string BaseVersion = "$($delta.baseVersion)";
    public const string TargetVersion = "$($delta.targetVersion)";
    public const string SourceUrl = "$sourceUrl";
}
}
"@
$metadataPath = Join-Path $build 'BuildInfo.cs'
[IO.File]::WriteAllText($metadataPath, $metadata, [Text.UTF8Encoding]::new($false))
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$native = Join-Path $root 'tools/native-updater'
$sources = @((Join-Path $native 'UpdateEngine.cs'),(Join-Path $native 'Discovery.cs'),(Join-Path $native 'Program.cs'),$metadataPath)
$references = @('System.Windows.Forms.dll','System.Drawing.dll','System.Management.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll') | ForEach-Object { '/reference:' + $_ }
$arguments = @('/nologo','/target:winexe','/platform:x64','/langversion:5','/optimize+','/utf8output',
    ('/out:' + $outputPath),('/win32manifest:' + (Join-Path $native 'updater.manifest')),
    ('/win32icon:' + (Join-Path $root 'components/client/private-brand/icon.ico')),
    ('/resource:' + $zipPath + ',update.zip'),
    ('/resource:' + (Join-Path $root 'tools/incremental-program-paths.json') + ',program-paths.json'),
    ('/resource:' + (Join-Path $root 'components/client/LICENSE') + ',updater-license.txt'))
& $compiler @arguments @references @sources *> (Join-Path $build 'compile.log')
if ($LASTEXITCODE) { throw "Native updater compilation failed; see $build/compile.log" }
$hashes = [ordered]@{}
foreach ($file in $sources + @((Join-Path $native 'updater.manifest'),(Join-Path $root 'tools/incremental-program-paths.json'),(Join-Path $root 'components/client/LICENSE'),(Join-Path $root 'components/client/private-brand/icon.ico'))) {
    $relative = [IO.Path]::GetRelativePath($root,$file).Replace('\','/')
    if ($file -eq $metadataPath) { $relative = 'generated/BuildInfo.cs' }
    $hashes[$relative] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
$receipt = [ordered]@{
    schemaVersion=1; format='laokuai-native-incremental-exe-v1'; sourceCommit=$SourceCommit;
    sourceUrl=$sourceUrl; file=[IO.Path]::GetFileName($outputPath); bytes=(Get-Item -LiteralPath $outputPath).Length;
    sha256=(Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant();
    embeddedUpdateSha256=$ExpectedPackageSha256; baseVersion=$delta.baseVersion; targetVersion=$delta.targetVersion;
    runtime='Windows built-in .NET Framework 4.x'; requiresPowerShell=$false; elevation='asInvoker';
    compilerSha256=(Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant();
    inputs=$hashes; validation='not-yet-run'; payloadExtractionToSystemTemp=$false
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($outputPath + '.build.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 8

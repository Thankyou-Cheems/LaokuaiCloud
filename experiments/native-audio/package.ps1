#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$build = Join-Path $repo '.local/native-audio-build/Release'
$deps = Join-Path $repo '.local/native-audio-deps/aoo'
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) { throw 'Use a fresh output directory' }
$stamp = Get-Content (Join-Path $repo '.local/native-audio-build/build-inputs.json') -Raw | ConvertFrom-Json
if (!$stamp.offlineTestsPassed) { throw 'Run build.ps1 -Test first' }
$currentSources = @(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File)
if ($currentSources.Count -ne $stamp.sources.Count) { throw 'Source set changed since build' }
foreach ($file in $stamp.sources) {
    if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file.path)).Hash -ne $file.sha256) { throw "Source changed since build: $($file.path)" }
}
foreach ($file in $stamp.binaries) {
    if ((Get-FileHash -LiteralPath (Join-Path $build $file.path)).Hash -ne $file.sha256) { throw 'Binary changed since tested build' }
}
$dirty = & git -C $repo status --porcelain -- experiments/native-audio
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit the exact experiment sources before packaging' }
$commit = & git -C $repo rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Missing source commit' }
$bundle = Join-Path $destination '唠蒯云-原生语音实验1'
$legal = Join-Path $bundle 'licenses'
[IO.Directory]::CreateDirectory($legal) | Out-Null
foreach ($name in @('laokuai-native-audio.exe','唠蒯云-原生语音实验.exe')) {
    Copy-Item -LiteralPath (Join-Path $build $name) -Destination $bundle
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $bundle '使用说明.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LICENSE') -Destination (Join-Path $legal 'LaokuaiCloud-AGPL-3.0-or-later.txt')
Copy-Item -LiteralPath (Join-Path $deps 'LICENSE') -Destination (Join-Path $legal 'AoO-BSD.txt')
Copy-Item -LiteralPath (Join-Path $deps 'deps/oscpack/LICENSE') -Destination (Join-Path $legal 'oscpack.txt')
Copy-Item -LiteralPath (Join-Path $deps 'deps/opus/COPYING') -Destination (Join-Path $legal 'Opus-COPYING.txt')
Copy-Item -LiteralPath (Join-Path $deps 'deps/opus/LICENSE_PLEASE_READ.txt') -Destination (Join-Path $legal 'Opus-patent-notice.txt')
Copy-Item -LiteralPath (Join-Path $deps 'deps/portaudio/LICENSE.txt') -Destination (Join-Path $legal 'PortAudio.txt')
$pins = Get-Content (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
$offer = [ordered]@{schemaVersion=1; experiment='native-audio-1'; sourceCommit=$commit; sourceUrl="https://github.com/Thankyou-Cheems/LaokuaiCloud/tree/$commit/experiments/native-audio"; sourceArchive="https://github.com/Thankyou-Cheems/LaokuaiCloud/archive/$commit.zip"; buildRecipe='experiments/native-audio/build.ps1'; dependencies=$pins}
$offer | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $bundle 'SOURCE-OFFER.json') -Encoding utf8NoBOM
$files = @(Get-ChildItem -LiteralPath $bundle -Recurse -File | ForEach-Object {
    [ordered]@{path=[IO.Path]::GetRelativePath($bundle,$_.FullName).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$zip = Join-Path $destination '唠蒯云-原生语音实验1-win-x64.zip'
Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal
$receipt = [ordered]@{schemaVersion=1;experiment='native-audio-1';sourceCommit=$commit; zip=[ordered]@{name=[IO.Path]::GetFileName($zip);bytes=(Get-Item -LiteralPath $zip).Length;sha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()};files=$files; desktopModified=$false; productionModified=$false; realAudioAcceptance=$false; realEasyTierAcceptance=$false}
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $destination 'package-receipt.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 8

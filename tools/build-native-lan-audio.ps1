#requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $repo 'experiments/native-audio'
$deps = Join-Path $repo '.local/native-audio-deps/aoo'
$build = Join-Path $repo '.local/native-audio-build'
$pins = Get-Content (Join-Path $source 'dependencies.json') -Raw | ConvertFrom-Json
foreach ($entry in @(@($deps,$pins.aoo.commit),@((Join-Path $deps 'deps/opus'),$pins.opus.commit),@((Join-Path $deps 'deps/portaudio'),$pins.portaudio.commit))) {
    $head = & git -C $entry[0] rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -ne $entry[1]) { throw 'Dependency revision mismatch; fetch pinned sources using experiments/native-audio/build.ps1 -Fetch first' }
    $dirty = & git -C $entry[0] status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Modified native dependency' }
}
$cmake = 'C:/Program Files/CMake/bin/cmake.exe'
& $cmake -S $source -B $build -G 'Visual Studio 18 2026' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Native configuration failed' }
& $cmake --build $build --config Release --target laokuai-native-audio native-audio-offline --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
& (Join-Path $build 'Release/native-audio-offline.exe')
if ($LASTEXITCODE -ne 0) { throw 'Offline codec tests failed' }
$exe = Join-Path $build 'Release/laokuai-native-audio.exe'
& $exe --self-test
if ($LASTEXITCODE -ne 0) { throw 'Native boundary tests failed' }
$target = Join-Path $repo 'components/client/build/native-lan-audio'
$legal = Join-Path $target 'licenses'
[IO.Directory]::CreateDirectory($legal) | Out-Null
Copy-Item -LiteralPath $exe -Destination $target
foreach ($entry in @(@((Join-Path $source 'LICENSE'),'LaokuaiCloud-AGPL-3.0-or-later.txt'),@((Join-Path $deps 'LICENSE'),'AoO-BSD.txt'),@((Join-Path $deps 'deps/oscpack/LICENSE'),'oscpack.txt'),@((Join-Path $deps 'deps/opus/COPYING'),'Opus-COPYING.txt'),@((Join-Path $deps 'deps/opus/LICENSE_PLEASE_READ.txt'),'Opus-patent-notice.txt'),@((Join-Path $deps 'deps/portaudio/LICENSE.txt'),'PortAudio.txt'))) {
    Copy-Item -LiteralPath $entry[0] -Destination (Join-Path $legal $entry[1])
}
@{protocol='aoo-et-ipv4-v1';bytes=(Get-Item -LiteralPath $exe).Length;sha256=(Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant()} |
    ConvertTo-Json | Set-Content (Join-Path $repo 'components/client/electron/nativeLanAudioAsset.json') -Encoding utf8NoBOM
Write-Output 'Pinned native audio sidecar staged. No microphone, network, firewall or live client used.'

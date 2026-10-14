#requires -Version 7.0
[CmdletBinding()]
param([switch]$Fetch, [switch]$Test)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$deps = Join-Path $repo '.local/native-audio-deps/aoo'
$build = Join-Path $repo '.local/native-audio-build'
$pins = Get-Content (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
function Run([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed: $LASTEXITCODE" }
}
if ($Fetch -and !(Test-Path -LiteralPath $deps)) {
    Run git @('clone', '--no-checkout', $pins.aoo.repository, $deps)
    Run git @('-C', $deps, 'checkout', '--detach', $pins.aoo.commit)
    Run git @('-C', $deps, 'submodule', 'update', '--init', '--depth', '1', 'deps/opus', 'deps/portaudio')
}
foreach ($entry in @(@($deps,$pins.aoo.commit),@((Join-Path $deps 'deps/opus'),$pins.opus.commit),@((Join-Path $deps 'deps/portaudio'),$pins.portaudio.commit))) {
    $head = & git -C $entry[0] rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -ne $entry[1]) { throw "Dependency revision mismatch: $($entry[0])" }
    $dirty = & git -C $entry[0] status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw "Modified dependency: $($entry[0])" }
}
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (!$cmake) { $cmake = 'C:/Program Files/CMake/bin/cmake.exe' }
Run $cmake @('-S',$PSScriptRoot,'-B',$build,'-G','Visual Studio 18 2026','-A','x64')
Run $cmake @('--build',$build,'--config','Release','--parallel','4')
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -RunSelfTest:$Test
if ($Test) {
    Run (Join-Path $build 'Release/native-audio-offline.exe') @()
    Run (Join-Path $build 'Release/laokuai-native-audio.exe') @('--self-test')
    & (Join-Path $PSScriptRoot 'tests/stdio.ps1') -Helper (Join-Path $build 'Release/laokuai-native-audio.exe')
}
$sourceFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    @{path=[IO.Path]::GetRelativePath($PSScriptRoot,$_.FullName);sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}
})
$binaries = @('laokuai-native-audio.exe','唠蒯云-原生语音实验.exe') | ForEach-Object {
    @{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $build "Release/$_")).Hash}
}
@{sources=$sourceFiles;binaries=@($binaries);offlineTestsPassed=[bool]$Test} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $build 'build-inputs.json') -Encoding utf8NoBOM

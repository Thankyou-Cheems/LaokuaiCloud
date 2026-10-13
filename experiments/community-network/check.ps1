# Read-only isolation checks plus offline models. No product/native process is launched.
#requires -Version 7.0
param([switch]$VerifyOriginalIsolation)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$nodePath = Join-Path $repoRoot '.local/toolchains/node24/node.exe'
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Pinned Node 24 is missing.' }
Push-Location $repoRoot
try {
    if ($VerifyOriginalIsolation) {
        $protectedPaths = @('components', 'release', 'tools')
        & git diff --quiet 65432f4f -- @protectedPaths
        if ($LASTEXITCODE -ne 0) { throw 'Production source changed since experimental baseline.' }
        $untracked = @(& git ls-files --others --exclude-standard -- @protectedPaths)
        if ($LASTEXITCODE -ne 0 -or $untracked.Count -ne 0) { throw 'Untracked production files need review.' }
    }
    $tests = @(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File -Filter '*.test.mjs' |
        Sort-Object FullName | ForEach-Object FullName)
    if ($tests.Count -lt 2) { throw 'Both experimental test suites must be present.' }
    & $nodePath --test @tests
    if ($LASTEXITCODE -ne 0) { throw 'Offline experimental checks failed.' }
    $zipPath = Join-Path $repoRoot '.local/artifacts/autojoin-test-20261013/唠蒯云-1.13.22-laokuai.beta.20261013.6-zh-CN-win-x64-green.zip'
    if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
        $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne '77614061c4ab8566f61e541f6b4fefd9127fc75a85f3fd30ed6cbe540f2c7ef7') {
            throw 'Frozen .6 test ZIP hash mismatch.'
        }
        Write-Output 'Frozen .6 ZIP: unchanged.'
    } else {
        Write-Output 'Frozen .6 ZIP: absent on this machine; artifact hash not verified.'
    }
    Write-Output 'Offline reference models passed. This does not validate current product wiring or network activation.'
} finally {
    Pop-Location
}

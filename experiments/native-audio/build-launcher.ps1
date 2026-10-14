[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../.local/native-audio-build/Release'),
    [switch]$RunSelfTest
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Missing Windows .NET Framework 4.x C# compiler.' }
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$exe = Join-Path $outputPath '唠蒯云-原生语音实验.exe'
$source = Join-Path $PSScriptRoot 'launcher/Program.cs'
$manifest = Join-Path $PSScriptRoot 'launcher/app.manifest'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/win32manifest:$manifest" "/out:$exe" $source
if ($LASTEXITCODE -ne 0) { throw "Launcher compile failed: $LASTEXITCODE" }
if ($RunSelfTest) {
    $test = Start-Process -FilePath $exe -ArgumentList '--self-test' -PassThru -Wait -WindowStyle Hidden
    if ($test.ExitCode -ne 0) { throw "Launcher self-test failed: $($test.ExitCode)" }
}
Write-Output $exe

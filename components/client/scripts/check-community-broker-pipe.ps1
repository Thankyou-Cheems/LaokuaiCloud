[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$client = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('laokuai-broker-pipe-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
$binary = Join-Path $fixtureDirectory 'BrokerPipeTests.exe'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
try {
    & $compiler /nologo /target:exe /main:BrokerPipeTests /platform:x64 /utf8output /reference:System.Web.Extensions.dll "/out:$binary" (Join-Path $client 'native/community-lan-broker/Program.cs') (Join-Path $client 'native/community-lan-broker/PipeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Broker pipe fixture compilation failed' }
    & $binary
    if ($LASTEXITCODE -ne 0) { throw 'Broker pipe regression failed' }
} finally {
    # Only the exact files created by this fixture; no recursive removal.
    if (Test-Path -LiteralPath $binary) { Remove-Item -LiteralPath $binary }
    Remove-Item -LiteralPath $fixtureDirectory
}

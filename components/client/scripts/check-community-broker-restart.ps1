# Compiles and runs pure restart validation; never invokes runas or product code.
[CmdletBinding()]
param([string]$ReadOnlyPackageDirectory)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }
$client = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('laokuai-broker-restart-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
$binary = Join-Path $fixtureDirectory 'BrokerRestartTests.exe'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
try {
    & $compiler /nologo /target:exe /platform:x64 /utf8output /reference:System.Web.Extensions.dll /reference:System.Management.dll "/out:$binary" (Join-Path $client 'native/community-lan-broker/Program.cs') (Join-Path $client 'native/community-lan-broker/CommunityDnsPolicy.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Broker restart fixture compilation failed' }
    & $binary --restart-app-self-test
    if ($LASTEXITCODE -ne 0) { throw 'Broker restart validation failed' }
    if ($ReadOnlyPackageDirectory) {
        & $binary --restart-app-path-check (Join-Path $ReadOnlyPackageDirectory '唠蒯云.exe') (Join-Path $ReadOnlyPackageDirectory 'resources/community-lan-helper/laokuai-community-broker.exe')
        if ($LASTEXITCODE -ne 0) { throw 'Restart bundle read-only path validation failed' }
    }
} finally {
    if (Test-Path -LiteralPath $binary) { Remove-Item -LiteralPath $binary }
    Remove-Item -LiteralPath $fixtureDirectory
}

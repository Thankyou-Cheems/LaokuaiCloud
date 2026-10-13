[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$client = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('laokuai-dns-policy-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
$binary = Join-Path $fixtureDirectory 'DnsPolicyTests.exe'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
try {
    & $compiler /nologo /target:exe /platform:x64 /utf8output /reference:System.Web.Extensions.dll /reference:System.Management.dll "/out:$binary" (Join-Path $client 'native/community-lan-broker/Program.cs') (Join-Path $client 'native/community-lan-broker/CommunityDnsPolicy.cs')
    if ($LASTEXITCODE -ne 0) { throw 'DNS policy fixture compilation failed' }
    & $binary --dns-policy-self-test
    if ($LASTEXITCODE -ne 0) { throw 'DNS policy CLR regression failed' }
} finally {
    # Remove only the exact executable created by this fixture, then its empty directory.
    if (Test-Path -LiteralPath $binary) { Remove-Item -LiteralPath $binary }
    Remove-Item -LiteralPath $fixtureDirectory
}

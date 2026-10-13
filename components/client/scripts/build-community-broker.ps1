[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$client = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $client 'native/community-lan-broker/Program.cs'
$dnsSource = Join-Path $client 'native/community-lan-broker/CommunityDnsPolicy.cs'
$output = Join-Path $client 'build/community-lan-helper'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$binary = Join-Path $output 'laokuai-community-broker.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /utf8output /reference:System.Web.Extensions.dll /reference:System.Management.dll "/out:$binary" $source $dnsSource
if ($LASTEXITCODE -ne 0) { throw 'Community broker compilation failed' }
$receipt = @{schemaVersion=1; sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant(); dnsSourceSha256=(Get-FileHash -LiteralPath $dnsSource -Algorithm SHA256).Hash.ToLowerInvariant(); sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=(Get-Item -LiteralPath $binary).Length}
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'broker-build.json') -Encoding utf8NoBOM
Write-Output 'Community broker compiled. No UAC or ET runtime started.'

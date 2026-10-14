#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$node = Join-Path $root '.local/toolchains/node24/node.exe'
$identity = $SourceCommit.Substring(0,12)
$work = Join-Path $root ('.local/native-deployment/' + $identity)
if (Test-Path -LiteralPath $work) { throw 'Keep previous evidence; preparation directory already exists' }
& git -C $root diff --quiet $SourceCommit -- components/server
if ($LASTEXITCODE) { throw 'Server source differs from frozen package commit' }
New-Item -ItemType Directory -Path $work | Out-Null
& git -C $root archive --format=tar "--output=$work/source.tar" $SourceCommit components/server
if ($LASTEXITCODE) { throw 'Source archive failed' }
Push-Location (Join-Path $root 'components/server')
try {
    & $node node_modules/typescript/bin/tsc
    if ($LASTEXITCODE) { throw 'Server compile failed' }
    & $node node_modules/esbuild/bin/esbuild dist/index.js --bundle --platform=node --target=node22 --format=cjs --outfile=dist/bundle.js --external:sharp --external:jsdom
    if ($LASTEXITCODE) { throw 'Server bundle failed' }
} finally { Pop-Location }
& git -C $root diff --quiet $SourceCommit -- components/server
if ($LASTEXITCODE) { throw 'Server source changed during build' }
Copy-Item -LiteralPath (Join-Path $root 'components/server/dist/bundle.js') -Destination $work
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'operator.py') -Destination $work
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../community-network-v2/operator.py') -Destination (Join-Path $work 'base_operator.py')
$artifacts = [ordered]@{}
foreach ($name in @('source.tar','bundle.js','operator.py','base_operator.py')) {
    $path = Join-Path $work $name
    $artifacts[$name] = @{sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $path).Length}
}
@{sourceCommit=$SourceCommit;sourceWorkingTree=$false;artifacts=$artifacts} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $work 'input.json') -Encoding utf8NoBOM
$remote = '/opt/stacks/gryt/native-lan-voice-' + $identity
$create = "python3 -c 'import os; os.umask(0o077); os.mkdir(`"$remote`")'"
& 'C:/Windows/System32/OpenSSH/ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 TencentCloudPublic $create
if ($LASTEXITCODE) { throw 'Remote preparation directory failed' }
$upload = @('input.json','source.tar','bundle.js','operator.py','base_operator.py') | ForEach-Object { Join-Path $work $_ }
& 'C:/Windows/System32/OpenSSH/scp.exe' -o BatchMode=yes -o ConnectTimeout=8 @upload ('TencentCloudPublic:' + $remote + '/')
if ($LASTEXITCODE) { throw 'Upload failed' }
& 'C:/Windows/System32/OpenSSH/ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 TencentCloudPublic "python3 -I $remote/operator.py inspect --work $remote"
if ($LASTEXITCODE) { throw 'Baseline inspection failed' }

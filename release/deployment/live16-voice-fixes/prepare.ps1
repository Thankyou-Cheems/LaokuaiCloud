#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$SshHost = 'TencentCloudPublic',
    [ValidatePattern('^$|^r[1-9][0-9]*$')][string]$PreparationSuffix = ''
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$node = Join-Path $root '.local/toolchains/node24/node.exe'
$ssh = 'C:/Windows/System32/OpenSSH/ssh.exe'
$scp = 'C:/Windows/System32/OpenSSH/scp.exe'
$head = (& git -C $root rev-parse "$SourceCommit^{commit}").Trim()
if ($LASTEXITCODE -or $head -ne $SourceCommit) { throw 'Frozen commit unavailable' }
& git -C $root diff --quiet $SourceCommit -- components/server components/sfu
if ($LASTEXITCODE) { throw 'Server/SFU working source differs from frozen commit' }
$identity = $SourceCommit.Substring(0,12) + $(if ($PreparationSuffix) { '-' + $PreparationSuffix } else { '' })
$work = Join-Path $root ('.local/live16-deployment/' + $identity)
if (Test-Path -LiteralPath $work) {
    if (@(Get-ChildItem -LiteralPath $work -Force).Count) { throw 'Preparation evidence already exists; keep it and use its remote phase commands' }
} else { New-Item -ItemType Directory -Path $work | Out-Null }
$archivePath = Join-Path $work 'source.tar'
& git -C $root archive --format=tar "--output=$archivePath" $SourceCommit components/server components/sfu
if ($LASTEXITCODE) { throw 'Frozen source archive failed' }
Push-Location (Join-Path $root 'components/server')
try {
    & $node node_modules/typescript/bin/tsc
    if ($LASTEXITCODE) { throw 'Server compilation failed' }
    & $node node_modules/esbuild/bin/esbuild dist/index.js --bundle --platform=node --target=node22 --format=cjs --outfile=dist/bundle.js --external:sharp --external:jsdom
    if ($LASTEXITCODE) { throw 'Server bundle failed' }
} finally { Pop-Location }
& git -C $root diff --quiet $SourceCommit -- components/server components/sfu
if ($LASTEXITCODE) { throw 'Source changed during build' }
Copy-Item -LiteralPath (Join-Path $root 'components/server/dist/bundle.js') -Destination (Join-Path $work 'bundle.js')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'operator.py') -Destination (Join-Path $work 'operator.py')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../community-network-v2/operator.py') -Destination (Join-Path $work 'base_operator.py')
$artifacts = [ordered]@{}
foreach ($name in @('source.tar','bundle.js','operator.py','base_operator.py')) {
    $path = Join-Path $work $name
    $artifacts[$name] = [ordered]@{sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $path).Length}
}
$record = [ordered]@{sourceCommit=$SourceCommit;sourceWorkingTree=$false;artifacts=$artifacts;node=(& $node --version).Trim();operatorSource='release/deployment/live16-voice-fixes/operator.py';operatorFrozenSeparately=$true}
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $work 'input.json') -Encoding utf8NoBOM
$remote = '/opt/stacks/gryt/live16-voice-fixes-' + $identity
$create = "python3 -c 'import os; os.umask(0o077); os.mkdir(`"$remote`")'"
& $ssh -o BatchMode=yes -o ConnectTimeout=8 $SshHost $create
if ($LASTEXITCODE) { throw 'New private remote preparation directory failed' }
$upload = @('input.json','source.tar','bundle.js','operator.py','base_operator.py') | ForEach-Object { Join-Path $work $_ }
& $scp -o BatchMode=yes -o ConnectTimeout=8 @upload ($SshHost + ':' + $remote + '/')
if ($LASTEXITCODE) { throw 'Private preparation upload failed' }
& $ssh -o BatchMode=yes -o ConnectTimeout=8 $SshHost ("python3 -I $remote/operator.py inspect --work $remote")
if ($LASTEXITCODE) { throw 'Read-only remote baseline check failed' }
[ordered]@{sourceCommit=$SourceCommit;localWork=$work;remoteWork=$remote;productionStarted=$false;nextPhase='build-test'} | ConvertTo-Json

#requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (!$IsLinux -or $env:GITHUB_ACTIONS -ne 'true') {
    throw 'SFU Go/ICE checks run only in an isolated Linux GitHub runner, never the user desktop.'
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = [IO.Path]::GetFullPath((Join-Path $root 'components/sfu'))
$cacheName = 'laokuai-sfu-ci-' + [Guid]::NewGuid().ToString('N')
$created = $false
try {
    & docker pull golang:1.25-alpine
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Go toolchain download failed.' }
    $toolImage = (& docker image inspect --format '{{.Id}}' golang:1.25-alpine).Trim()
    if ($LASTEXITCODE -ne 0 -or $toolImage -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Go toolchain image identity unavailable.' }
    & docker volume create $cacheName
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Go cache allocation failed.' }
    $created = $true
    $common = @('run', '--rm', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--cpus', '2', '--memory', '2g', '--pids-limit', '512',
        '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=1024m', '--workdir', '/src',
        '--mount', "type=bind,source=$source,target=/src,readonly",
        '-e', 'GOTOOLCHAIN=local', '-e', 'CGO_ENABLED=0', '-e', 'GOMODCACHE=/gomod',
        '-e', 'GOCACHE=/tmp/go-cache')
    & docker @common --network bridge --mount "type=volume,source=$cacheName,target=/gomod" $toolImage go mod download
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Go dependency download failed.' }
    Write-Host "[SFU] toolchain $toolImage; source readonly; tests network=none; /tmp executable."
    & docker @common --network none -e GOPROXY=off --mount "type=volume,source=$cacheName,target=/gomod,readonly" $toolImage go test -count=1 -timeout=90s ./internal/svc ./internal/track ./internal/room ./internal/websocket ./internal/webrtc ./internal/config
    if ($LASTEXITCODE -ne 0) { throw 'Isolated SFU six-package regression failed.' }
    Write-Host '[SFU] PASS: six packages include initial, renegotiated and staged SDP policy; isolated loopback transport only.'
    Write-Host 'Actual WAN, user device and 12-client capacity acceptance NOT RUN.'
} finally {
    if ($created) {
        & docker volume rm $cacheName
        if ($LASTEXITCODE -ne 0) { Write-Warning "CI-owned Go cache was not removed: $cacheName" }
    }
}

param(
    [string]$CandidatePath = (Join-Path $PSScriptRoot 'candidate.env.example'),
    [string]$RollbackPath = (Join-Path $PSScriptRoot 'rollback.env.example')
)

$ErrorActionPreference = 'Stop'

function Read-EnvExample([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Missing env example: $Path"
    }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $values[$Matches[1]] = $Matches[2]
        }
    }
    return $values
}

function Assert-Value($Values, [string]$Name, [string]$Expected, [string]$File) {
    if (-not $Values.ContainsKey($Name) -or $Values[$Name] -ne $Expected) {
        throw "$File must set $Name=$Expected"
    }
}

$candidate = Read-EnvExample $CandidatePath
$rollback = Read-EnvExample $RollbackPath

foreach ($pair in @{
    MAX_PEERS = '12'
    SFU_HYBRID_ENABLED = 'true'
    SFU_AUDIO_ONLY = 'true'
    SFU_REQUIRE_CLIENT_TOKEN = 'true'
    SFU_MICROPHONE_OPUS20 = 'true'
    SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS = '16000'
    SFU_MICROPHONE_OPUS_PTIME_MS = '60'
}.GetEnumerator()) {
    Assert-Value $candidate $pair.Key $pair.Value 'candidate.env.example'
}

foreach ($pair in @{
    MAX_PEERS = '6'
    SFU_HYBRID_ENABLED = 'true'
    SFU_AUDIO_ONLY = 'true'
    SFU_REQUIRE_CLIENT_TOKEN = 'true'
}.GetEnumerator()) {
    Assert-Value $rollback $pair.Key $pair.Value 'rollback.env.example'
}

foreach ($name in @('SFU_MICROPHONE_OPUS20', 'SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS', 'SFU_MICROPHONE_OPUS_PTIME_MS')) {
    if ($rollback.ContainsKey($name)) {
        throw "rollback.env.example must remove candidate-only key $name"
    }
}

[ordered]@{
    valid = $true
    productionExecuted = $false
    dockerInvoked = $false
    candidate = (Resolve-Path -LiteralPath $CandidatePath).Path
    rollback = (Resolve-Path -LiteralPath $RollbackPath).Path
    maxPeers = [int]$candidate.MAX_PEERS
    microphoneBitrateBps = [int]$candidate.SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS
    microphonePacketTimeMs = [int]$candidate.SFU_MICROPHONE_OPUS_PTIME_MS
} | ConvertTo-Json -Compress

param([Parameter(Mandatory=$true)][uint32]$TargetPid,[Parameter(Mandatory=$true)][string]$EvidenceFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'owned-tun-socket-evidence.ps1')
if(!$TargetPid -or !(Split-Path $EvidenceFile -IsAbsolute) -or (Test-Path -LiteralPath $EvidenceFile)){throw 'fresh-absolute-evidence-file-required'}
# Observation only. This file never attaches a native owned-process adapter or stops any PID.
$result=ReadOwnedSocketEvidence $TargetPid
$json=ConvertTo-Json -InputObject @{schema=1;readonly=$true;nativeProcessStarted=$false;nativeProcessStopped=$false;osMutation=$false;socketEvidence=$result} -Depth 14
$stream=[IO.File]::Open($EvidenceFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @{complete=$result.complete;identityBinding=$result.identityBinding;tcpRows=@($result.endpoints | Where-Object protocol -eq 'TCP').Count;udpRows=@($result.endpoints | Where-Object protocol -eq 'UDP').Count;unknownRows=$result.unknownRows;truncated=$result.truncated} -Compress))

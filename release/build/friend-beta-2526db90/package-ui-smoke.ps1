$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$profile=Join-Path $root 'profiles/laokuai-ui-check-final-package'
if(Test-Path -LiteralPath $profile){throw 'fresh-profile-required'}
New-Item -ItemType Directory -Path $profile | Out-Null
$exe=Join-Path $root 'payload-complete/唠蒯云.exe'
$audit=Get-Content -LiteralPath (Join-Path $root 'PACKAGE-FINAL-AUDIT.json') -Raw|ConvertFrom-Json
if((Get-FileHash -LiteralPath (Join-Path $root 'payload-complete/resources/app.asar')).Hash.ToLower() -ne $audit.appAsarSha256){throw 'asar-pin-mismatch'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class BetaSmokeJob {
 [StructLayout(LayoutKind.Sequential)] public struct Basic {public long PerProcess,PerJob;public uint Flags;public UIntPtr Min,Max;public uint Active;public UIntPtr Affinity;public uint Priority,Schedule;}
 [StructLayout(LayoutKind.Sequential)] public struct Io {public ulong A,B,C,D,E,F;}
 [StructLayout(LayoutKind.Sequential)] public struct Extended {public Basic Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr sa,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int cls,ref Extended info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
}
'@
$job=[BetaSmokeJob]::CreateJobObject([IntPtr]::Zero,$null)
if($job -eq [IntPtr]::Zero){throw 'job-create-failed'}
$limits=[BetaSmokeJob+Extended]::new();$limits.Basic.Flags=0x2000 -bor 0x10 -bor 0x20
$limits.Basic.Affinity=[UIntPtr]::new(3);$limits.Basic.Priority=0x4000
if(-not[BetaSmokeJob]::SetInformationJobObject($job,9,[ref]$limits,[Runtime.InteropServices.Marshal]::SizeOf($limits))){[BetaSmokeJob]::CloseHandle($job)|Out-Null;throw 'job-limit-failed'}
$samples=@();$seen=[Collections.Generic.HashSet[int]]::new();$app=$null;$timedOut=$false
try {
 $env:ELECTRON_RUN_AS_NODE=$null;$env:VITE_DEV_SERVER_URL=$null
 $app=Start-Process -FilePath $exe -ArgumentList ('--laokuai-ui-check-dir="'+$profile+'"') -WorkingDirectory (Split-Path $exe) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'logs/package-ui.stdout.log') -RedirectStandardError (Join-Path $root 'logs/package-ui.stderr.log')
 if(-not[BetaSmokeJob]::AssignProcessToJobObject($job,$app.Handle)){$app.Kill();throw 'job-assignment-failed'}
 [void]$seen.Add($app.Id);$clock=[Diagnostics.Stopwatch]::StartNew()
 while(-not $app.HasExited -and $clock.Elapsed.TotalSeconds -lt 35){
  $processes=Get-CimInstance Win32_Process -Filter "Name='唠蒯云.exe'"
  foreach($p in $processes){if($seen.Contains([int]$p.ParentProcessId)){[void]$seen.Add([int]$p.ProcessId)}}
  $tcpOK=$false;$udpOK=$false;$tcp=@();$udp=@()
  try{$tcp=@(Get-NetTCPConnection -ErrorAction Stop|Where-Object {$seen.Contains([int]$_.OwningProcess)});$tcpOK=$true}catch{}
  try{$udp=@(Get-NetUDPEndpoint -ErrorAction Stop|Where-Object {$seen.Contains([int]$_.OwningProcess)});$udpOK=$true}catch{}
  [uint32]$foregroundPid=0;$window=[BetaSmokeJob]::GetForegroundWindow();[void][BetaSmokeJob]::GetWindowThreadProcessId($window,[ref]$foregroundPid)
  $samples+=@{elapsed=$clock.Elapsed.TotalSeconds;endpointQueriesSucceeded=$tcpOK -and $udpOK;tcpCount=$tcp.Count;udpCount=$udp.Count;ownedForeground=$seen.Contains([int]$foregroundPid);foregroundQuerySucceeded=$window -ne [IntPtr]::Zero}
  Start-Sleep -Milliseconds 600
 }
 if(-not $app.HasExited){$timedOut=$true;[BetaSmokeJob]::TerminateJobObject($job,124)|Out-Null}
 $app.WaitForExit();$code=$app.ExitCode
}finally{[BetaSmokeJob]::CloseHandle($job)|Out-Null}
Start-Sleep -Milliseconds 400
$residual=@(foreach($id in $seen){if(Get-Process -Id $id -ErrorAction SilentlyContinue){$id}})
$evidence=Join-Path $profile 'ui-evidence'
if(-not(Test-Path -LiteralPath (Join-Path $evidence 'dom.json'))){
 [IO.File]::WriteAllText((Join-Path $root 'PACKAGE-UI-START-FAILURE.json'),(@{exitCode=$code;timeout=$timedOut;residual=$residual;samples=$samples;ownedProcessCount=$seen.Count}|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false));throw 'missing-dom-evidence'
}
$dom=Get-Content -LiteralPath (Join-Path $evidence 'dom.json') -Raw|ConvertFrom-Json
$events=Get-Content -LiteralPath (Join-Path $evidence 'events.json') -Raw|ConvertFrom-Json
$bad=@($events|Where-Object {$_.kind -in @('unexpected-window-show','unexpected-window-focus','snapshot-failed','preload-error','did-fail-load','render-process-gone')})
$receipt=@{sourceCommit='2526db9081567da13f246be801a3b4662cb38102';exactAsar=$audit.appAsarSha256;mainPid=$app.Id;exitCode=$code;hardTimeoutTriggered=$timedOut;residual=$residual;samples=$samples;ownedProcessCount=$seen.Count;dom=$dom;badEvents=$bad;scope='exact-payload-hidden-offline-empty-profile-bootstrap-only';normalModeOrNativeExecuted=$false}
[IO.File]::WriteAllText((Join-Path $root 'PACKAGE-UI-SMOKE.json'),($receipt|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
if($code -ne 0 -or $timedOut -or $residual.Count -ne 0 -or $bad.Count -ne 0 -or $samples.Count -eq 0 -or @($samples|Where-Object {-not $_.endpointQueriesSucceeded -or $_.tcpCount -ne 0 -or $_.udpCount -ne 0 -or $_.ownedForeground}).Count -ne 0){throw 'package-smoke-not-passed'}
Write-Output ('PASS exact packaged hidden bootstrap; samples='+$samples.Count+' exit='+$code+' residual='+$residual.Count)

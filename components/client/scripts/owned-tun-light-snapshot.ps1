param([switch]$Persistent)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'owned-tun-socket-evidence.ps1')
$identity=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'snapshot-requires-administrator' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrialLightReadOnlyIpHelper {
 [DllImport("iphlpapi.dll")] public static extern uint ConvertInterfaceIndexToLuid(uint index, out ulong luid);
}
'@
function Fingerprint($Value) {
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 9 -Compress))))).Replace('-','').ToLowerInvariant() }
 finally { $algorithm.Dispose() }
}
function IsV4($Family) { [string]$Family -in @('IPv4','2') }
function Sample([uint32]$OwnedPid) {
 $clock=[Diagnostics.Stopwatch]::StartNew()
 $all=@(Get-NetAdapter -IncludeHidden)
 $selected=@($all | Where-Object { ([string]$_.InterfaceGuid).Trim('{}') -ieq '4226cc04-7343-4caa-bfd6-55d097487583' -or $_.Name -ieq 'lk_trial_20261011_a' })
 $adapters=@(foreach($n in $selected) {
  [uint64]$luid=0
  if([TrialLightReadOnlyIpHelper]::ConvertInterfaceIndexToLuid([uint32]$n.ifIndex,[ref]$luid) -ne 0) { throw 'luid-read-failed' }
  $ips=@(Get-NetIPAddress -InterfaceIndex $n.ifIndex)
  $new=$n.Name -ieq 'lk_trial_20261011_a'
  $routes=if($new){@(Get-NetRoute -InterfaceIndex $n.ifIndex)}else{@()}
  $safe=$true
  foreach($r in $routes) {
   if($r.NextHop -notin @('0.0.0.0','::')){$safe=$false}
   if((IsV4 $r.AddressFamily) -and $r.DestinationPrefix -notin @('10.253.253.0/30','10.253.253.1/32','10.253.253.3/32','224.0.0.0/4','255.255.255.255/32')){$safe=$false}
   if(!(IsV4 $r.AddressFamily) -and $r.DestinationPrefix -notmatch '^(fe80:|ff00:|ff02:)'){$safe=$false}
  }
  [ordered]@{guid=([string]$n.InterfaceGuid).Trim('{}').ToLowerInvariant();ifIndex=$n.ifIndex;luid=$luid.ToString();alias=if($new){$n.Name}else{'protected'};status=[string]$n.Status;
   addresses=@(foreach($a in $ips){[ordered]@{family=if(IsV4 $a.AddressFamily){4}else{6};ip=if($a.IPAddress -eq '10.126.126.2' -or ($new -and $a.IPAddress -eq '10.253.253.1')){$a.IPAddress}else{'redacted'};prefix=$a.PrefixLength}});
   hasDefault=[bool]@($routes | Where-Object DestinationPrefix -in @('0.0.0.0/0','::/0')).Count;safeTrialRoutes=$safe}
 })
 $socketEvidence=ReadOwnedSocketEvidence $OwnedPid
 $gui=Get-Process -Id 6424 -ErrorAction SilentlyContinue
 $guiFingerprint=$null
 if($gui){try{if(!$gui.StartTime){throw 'protected-gui-start-time-unavailable'};$guiFingerprint=Fingerprint @($gui.Id,$gui.ProcessName,$gui.StartTime.ToUniversalTime().ToString('o'))}catch{}}
 $driverKnown=$true;$driverRunning=$false
 try{$driverRunning=[bool]@(Get-CimInstance Win32_SystemDriver -Filter "Name='wintun'" | Where-Object State -eq 'Running').Count}catch{$driverKnown=$false}
 $ownedIdentity=if($socketEvidence.identityBinding -eq 'matched-across-query'){$socketEvidence.identityBefore.fingerprint}else{$null}
 [ordered]@{lightSchema=1;complete=($socketEvidence.complete -and $driverKnown -and [bool]$guiFingerprint);socketEvidence=$socketEvidence;elapsedMs=$clock.ElapsedMilliseconds;guiAlive=[bool]($gui -and $gui.ProcessName -eq 'easytier-gui');guiFingerprint=$guiFingerprint;ownedIdentity=$ownedIdentity;
  adapterGuids=@($all | ForEach-Object {([string]$_.InterfaceGuid).Trim('{}').ToLowerInvariant()});adapters=$adapters;
  nonLoopbackRpc=$socketEvidence.nonLoopbackRpc;portalOwnerPids=$socketEvidence.portalOwnerPids;ownedForbiddenSocketCount=$socketEvidence.ownedForbiddenSocketCount;
  driverRunning=$driverRunning}
}
do {
 $line=[Console]::ReadLine()
 if($null -eq $line){break}
 $request=$null
 try {
  $request=ConvertFrom-Json -InputObject $line
  if($request.id -notmatch '^\d{1,9}$' -or $request.pid -lt 0 -or $request.pid -gt 4294967295){throw 'invalid-light-request'}
  $value=Sample ([uint32]$request.pid)
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{id=$request.id;value=$value} -Depth 12 -Compress))
 } catch {
  # No provider exception text or raw endpoints.
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{id=$request.id;failure='light-read-unavailable'} -Compress))
 }
} while($Persistent)

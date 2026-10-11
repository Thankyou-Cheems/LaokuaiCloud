param([uint32]$OwnedPid=0)
$ErrorActionPreference = 'Stop'
# Read-only observation, invoked only by the approved runner. No Wintun/driver API load.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrialReadOnlyIpHelper {
  [DllImport("iphlpapi.dll")] public static extern uint ConvertInterfaceIndexToLuid(uint index, out ulong luid);
}
'@
function Fingerprint($Value) {
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 9 -Compress))))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
function Range([string]$cidr) {
  $parts=$cidr.Split('/'); $bytes=[Net.IPAddress]::Parse($parts[0]).GetAddressBytes()
  if($bytes.Length -ne 4) { throw 'ipv4-required' }
  $prefix=[int]$parts[1]; if($prefix -lt 0 -or $prefix -gt 32) { throw 'invalid-prefix' }
  $number=[uint64]$bytes[0]*16777216+[uint64]$bytes[1]*65536+[uint64]$bytes[2]*256+[uint64]$bytes[3]
  $size=[uint64][Math]::Pow(2,32-$prefix); $start=[uint64]([Math]::Floor($number/$size)*$size)
  @($start,($start+$size-1))
}
function IsV4($Family) { [string]$Family -in @('IPv4','2') }
$identity=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$allAdapters=@(Get-NetAdapter -IncludeHidden | Sort-Object ifIndex)
$ips=@(Get-NetIPAddress)
$routes=@(Get-NetRoute)
$dns=@(Get-DnsClientServerAddress)
$target=Range '10.253.253.0/30'
$conflict=$false
foreach($route in $routes | Where-Object { (IsV4 $_.AddressFamily) -and $_.DestinationPrefix -ne '0.0.0.0/0' }) {
  if($route.InterfaceAlias -eq 'lk_trial_20261011_a') { continue }
  $r=Range $route.DestinationPrefix
  if($target[0] -le $r[1] -and $r[0] -le $target[1]) { $conflict=$true }
}
foreach($ip in $ips | Where-Object { (IsV4 $_.AddressFamily) -and $_.InterfaceAlias -ne 'lk_trial_20261011_a' }) {
  $r=Range ($ip.IPAddress+'/'+$ip.PrefixLength)
  if($target[0] -le $r[1] -and $r[0] -le $target[1]) { $conflict=$true }
}
$adapters=@(foreach($n in $allAdapters) {
  $addressRows=@($ips | Where-Object InterfaceIndex -eq $n.ifIndex | Sort-Object AddressFamily,IPAddress | Select-Object IPAddress,PrefixLength,AddressFamily,PrefixOrigin,SuffixOrigin)
  $routeRows=@($routes | Where-Object InterfaceIndex -eq $n.ifIndex | Sort-Object AddressFamily,DestinationPrefix,NextHop | Select-Object AddressFamily,DestinationPrefix,NextHop,RouteMetric,InterfaceMetric,Protocol)
  $dnsRows=@($dns | Where-Object InterfaceIndex -eq $n.ifIndex | Sort-Object AddressFamily | Select-Object AddressFamily,ServerAddresses)
  [uint64]$luid=0
  if([TrialReadOnlyIpHelper]::ConvertInterfaceIndexToLuid([uint32]$n.ifIndex,[ref]$luid) -ne 0) { throw 'luid-read-failed' }
  $new=($n.Name -eq 'lk_trial_20261011_a')
  $safe=$true
  foreach($r in $routeRows) {
    if($r.NextHop -notin @('0.0.0.0','::')) { $safe=$false }
    if((IsV4 $r.AddressFamily) -and $r.DestinationPrefix -notin @('10.253.253.0/30','10.253.253.1/32','10.253.253.3/32','224.0.0.0/4','255.255.255.255/32')) { $safe=$false }
    if(!(IsV4 $r.AddressFamily) -and $r.DestinationPrefix -notmatch '^(fe80:|ff00:|ff02:)') { $safe=$false }
  }
  [ordered]@{ guid=([string]$n.InterfaceGuid).Trim('{}').ToLowerInvariant(); alias=if($new -or $n.ifIndex -eq 30){$n.Name}else{'redacted'}; ifIndex=$n.ifIndex; luid=$luid.ToString(); status=[string]$n.Status;
    addresses=@(foreach($a in $addressRows){[ordered]@{family=if(IsV4 $a.AddressFamily){4}else{6};ip=if($new -and (IsV4 $a.AddressFamily)){$a.IPAddress}elseif($a.IPAddress -eq '10.126.126.2'){$a.IPAddress}else{'redacted'};prefix=$a.PrefixLength}});
    fingerprint=Fingerprint @($n.ifIndex,[string]$n.InterfaceGuid,[string]$n.Status,$addressRows,$routeRows,$dnsRows);
    hasDefault=[bool]@($routeRows | Where-Object DestinationPrefix -in @('0.0.0.0/0','::/0')).Count; safeTrialRoutes=$safe }
})
$rules=@(Get-NetFirewallRule -PolicyStore ActiveStore | Sort-Object Name | Select-Object Name,Enabled,Direction,Action,Profile,PolicyStoreSourceType)
$profiles=@(Get-NetFirewallProfile | Sort-Object Name | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction,AllowLocalFirewallRules)
$filters=@(
  @(Get-NetFirewallAddressFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,LocalAddress,RemoteAddress),
  @(Get-NetFirewallPortFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Protocol,LocalPort,RemotePort,IcmpType,DynamicTarget),
  @(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Program,Package),
  @(Get-NetFirewallServiceFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Service),
  @(Get-NetFirewallInterfaceFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,InterfaceAlias),
  @(Get-NetFirewallInterfaceTypeFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,InterfaceType),
  @(Get-NetFirewallSecurityFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Authentication,Encryption,OverrideBlockRules,LocalUser,RemoteUser,RemoteMachine)
)
$categories=@(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles' | Sort-Object PSChildName | ForEach-Object { $p=Get-ItemProperty -LiteralPath $_.PSPath; [ordered]@{id=$_.PSChildName;category=$p.Category} })
$drivers=@(Get-ChildItem -LiteralPath 'C:\Windows\System32\DriverStore\FileRepository' -Directory -Filter 'wintun.inf_*')
$driverVer=$null; $sysHash=$null
if($drivers.Count -eq 1) {
  $driverVer=(Select-String -LiteralPath (Join-Path $drivers[0].FullName 'wintun.inf') -Pattern '^DriverVer\s*=').Line.Trim()
  $sysHash=(Get-FileHash -LiteralPath (Join-Path $drivers[0].FullName 'wintun.sys') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$listening=@(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 15897 })
if(@($listening | Where-Object LocalAddress -ne '127.0.0.1').Count) { throw 'non-loopback-rpc-binding' }
$gui=Get-Process -Id 6424 -ErrorAction SilentlyContinue
$forbiddenSockets=0
if($OwnedPid -gt 0) {
  $forbiddenSockets=@(Get-NetTCPConnection | Where-Object { $_.OwningProcess -eq $OwnedPid -and ($_.LocalAddress -ne '127.0.0.1' -or $_.LocalPort -ne 15897 -or $_.RemoteAddress -notin @('0.0.0.0','127.0.0.1')) }).Count
  $forbiddenSockets+=@(Get-NetUDPEndpoint | Where-Object OwningProcess -eq $OwnedPid).Count
}
[ordered]@{ complete=$true;capturedAtUtc=[DateTime]::UtcNow.ToString('o');administrator=$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
  guiAlive=[bool]($gui -and $gui.ProcessName -eq 'easytier-gui');guiFingerprint=if($gui){Fingerprint @($gui.Id,$gui.ProcessName,$gui.StartTime.ToUniversalTime().ToString('o'))}else{$null};ownedForbiddenSocketCount=$forbiddenSockets;adapters=$adapters;aliasConflict=[bool]@($allAdapters | Where-Object {$_.Name -ieq 'lk_trial_20261011_a'}).Count;
  addressOrRouteConflict=$conflict;portalOwnerPids=@($listening | Select-Object -ExpandProperty OwningProcess -Unique);
  default4Sha256=Fingerprint @($routes | Where-Object DestinationPrefix -eq '0.0.0.0/0' | Sort-Object InterfaceIndex,NextHop | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric);
  default6Sha256=Fingerprint @($routes | Where-Object DestinationPrefix -eq '::/0' | Sort-Object InterfaceIndex,NextHop | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric);
  firewallSha256=Fingerprint @($rules,$profiles,$filters);categories=$categories;driverCount=$drivers.Count;driverVer=$driverVer;driverSysSha256=$sysHash;
  driverRunning=[bool]@(Get-CimInstance Win32_SystemDriver -Filter "Name='wintun'" | Where-Object State -eq 'Running').Count
} | ConvertTo-Json -Depth 10 -Compress

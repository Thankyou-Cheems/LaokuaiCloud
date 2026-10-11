param([uint32]$OwnedPid=0)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'owned-tun-socket-evidence.ps1')
# Read-only observation, invoked only by the approved runner. No Wintun/driver API load.
$clock=[Diagnostics.Stopwatch]::StartNew()
$script:phase=$null
function Mark([string]$Stage) {
  $row=[ordered]@{schema=1;phase=$script:phase;stage=$Stage;elapsedMs=$clock.ElapsedMilliseconds}
  [Console]::Error.WriteLine('LAOKUAI_READONLY_V1 '+(ConvertTo-Json -InputObject $row -Compress))
}
function StartPhase([string]$Name) {
  if($script:phase) { Mark 'ok' }
  $script:phase=$Name; Mark 'start'
}
try {
StartPhase 'administrator'
$identity=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'snapshot-requires-administrator' }
StartPhase 'helper'
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
# Explicit primitive configuration projection. Strings stay only as equality tokens;
# no provider objects, lifetimes, counters, timestamps, paths or physical endpoints.
$script:semanticCache=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
$script:semanticAlgorithm=[Security.Cryptography.SHA256]::Create()
function SemanticValue($Value,[bool]$AsSet=$false) {
  if($null -eq $Value) { return 'z:null' }
  if($Value -is [array]) {
    $items=[string[]]@(foreach($v in $Value){SemanticValue $v})
    if($AsSet) { [Array]::Sort($items,[StringComparer]::Ordinal) }
    return ,$items
  }
  if($Value -is [bool]) { return 'b:'+([string]$Value).ToLowerInvariant() }
  if($Value -is [Enum]) { return 'n:'+([Convert]::ToInt64($Value)).ToString([Globalization.CultureInfo]::InvariantCulture) }
  if($Value -is [byte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64]) {
    return 'n:'+$Value.ToString([Globalization.CultureInfo]::InvariantCulture)
  }
  if($Value -isnot [string]) { throw 'unsupported-semantic-field-type' }
  if(!$script:semanticCache.ContainsKey($Value)) {
    $token=([BitConverter]::ToString($script:semanticAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant()
    $script:semanticCache.Add($Value,'s:'+$token)
  }
  $script:semanticCache[$Value]
}
function SemanticTable($Rows,[string[]]$Fields,[string[]]$SetFields=@()) {
  $records=@(foreach($r in $Rows){
    $cells=@(foreach($field in $Fields){
      if(!$r.PSObject.Properties[$field]) { throw 'semantic-field-unavailable' }
      $value=SemanticValue $r.$field ($field -in $SetFields)
      ,$value
    })
    ,$cells
  })
  [ordered]@{columns=$Fields;rows=$records}
}
function EncodeSemanticFacts($Facts) {
  $bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Facts -Depth 12 -Compress))
  $memory=[IO.MemoryStream]::new()
  try {
    $gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    try { $gzip.Write($bytes,0,$bytes.Length) } finally { $gzip.Dispose() }
    [ordered]@{schema=1;encoding='gzip-base64';data=[Convert]::ToBase64String($memory.ToArray())}
  } finally { $memory.Dispose() }
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
StartPhase 'adapters'
$allAdapters=@(Get-NetAdapter -IncludeHidden | Sort-Object ifIndex)
StartPhase 'addresses'
$ips=@(Get-NetIPAddress)
StartPhase 'routes'
$routes=@(Get-NetRoute)
StartPhase 'dns'
$dns=@(Get-DnsClientServerAddress)
StartPhase 'interface-fingerprints'
$interfaceFacts=[ordered]@{}
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
  $interfaceFacts[([string]$n.InterfaceGuid).Trim('{}').ToLowerInvariant()]=[ordered]@{
    addresses=SemanticTable $addressRows @('IPAddress','PrefixLength','AddressFamily','PrefixOrigin','SuffixOrigin');
    routes=SemanticTable $routeRows @('AddressFamily','DestinationPrefix','NextHop','RouteMetric','InterfaceMetric','Protocol');
    dns=SemanticTable $dnsRows @('AddressFamily','ServerAddresses')
  }
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
    addresses=@(foreach($a in $addressRows){[ordered]@{family=if(IsV4 $a.AddressFamily){4}else{6};ip=if($new -and $a.IPAddress -eq '10.253.253.1'){$a.IPAddress}elseif($a.IPAddress -eq '10.126.126.2'){$a.IPAddress}else{'redacted'};prefix=$a.PrefixLength}});
    fingerprint=Fingerprint @($n.ifIndex,[string]$n.InterfaceGuid,[string]$n.Status,$addressRows,$routeRows,$dnsRows);
    hasDefault=[bool]@($routeRows | Where-Object DestinationPrefix -in @('0.0.0.0/0','::/0')).Count; safeTrialRoutes=$safe }
})
StartPhase 'fw-rules'
$rules=@(Get-NetFirewallRule -PolicyStore ActiveStore | Sort-Object Name | Select-Object Name,Enabled,Direction,Action,Profile,PolicyStoreSourceType)
StartPhase 'fw-profiles'
$profiles=@(Get-NetFirewallProfile | Sort-Object Name | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction,AllowLocalFirewallRules)
StartPhase 'fw-address'
$addressFilters=@(Get-NetFirewallAddressFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,LocalAddress,RemoteAddress)
StartPhase 'fw-port'
$portFilters=@(Get-NetFirewallPortFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Protocol,LocalPort,RemotePort,IcmpType,DynamicTarget)
StartPhase 'fw-application'
$applicationFilters=@(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Program,Package)
StartPhase 'fw-service'
$serviceFilters=@(Get-NetFirewallServiceFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Service)
StartPhase 'fw-interface'
$interfaceFilters=@(Get-NetFirewallInterfaceFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,InterfaceAlias)
StartPhase 'fw-interface-type'
$interfaceTypeFilters=@(Get-NetFirewallInterfaceTypeFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,InterfaceType)
StartPhase 'fw-security'
$securityFilters=@(Get-NetFirewallSecurityFilter -PolicyStore ActiveStore | Sort-Object InstanceID | Select-Object InstanceID,Authentication,Encryption,OverrideBlockRules,LocalUser,RemoteUser,RemoteMachine)
$filters=@($addressFilters,$portFilters,$applicationFilters,$serviceFilters,$interfaceFilters,$interfaceTypeFilters,$securityFilters)
StartPhase 'categories'
$categories=@(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles' | Sort-Object PSChildName | ForEach-Object { $p=Get-ItemProperty -LiteralPath $_.PSPath; [ordered]@{id=$_.PSChildName;category=$p.Category} })
StartPhase 'driver-package'
$drivers=@(Get-ChildItem -LiteralPath 'C:\Windows\System32\DriverStore\FileRepository' -Directory -Filter 'wintun.inf_*')
$driverVer=$null; $sysHash=$null
if($drivers.Count -eq 1) {
  $driverVer=(Select-String -LiteralPath (Join-Path $drivers[0].FullName 'wintun.inf') -Pattern '^DriverVer\s*=').Line.Trim()
  $stream=[IO.File]::OpenRead((Join-Path $drivers[0].FullName 'wintun.sys'))
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try { $sysHash=([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
StartPhase 'tcp-listeners'
$socketEvidence=ReadOwnedSocketEvidence $OwnedPid
StartPhase 'gui-identity'
$gui=Get-Process -Id 6424 -ErrorAction SilentlyContinue
$guiFingerprint=$null
if($gui) {
  if(!$gui.StartTime) { throw 'protected-gui-start-time-unavailable' }
  $guiFingerprint=Fingerprint @($gui.Id,$gui.ProcessName,$gui.StartTime.ToUniversalTime().ToString('o'))
}
StartPhase 'owned-sockets'
$forbiddenSockets=$socketEvidence.ownedForbiddenSocketCount
StartPhase 'driver-running'
$driverRunning=[bool]@(Get-CimInstance Win32_SystemDriver -Filter "Name='wintun'" | Where-Object State -eq 'Running').Count
StartPhase 'serialize'
$semanticFacts=[ordered]@{schema=1;interfaces=$interfaceFacts;tables=[ordered]@{
  rules=SemanticTable $rules @('Name','Enabled','Direction','Action','Profile','PolicyStoreSourceType');
  profiles=SemanticTable $profiles @('Name','Enabled','DefaultInboundAction','DefaultOutboundAction','AllowLocalFirewallRules');
  address=SemanticTable $addressFilters @('InstanceID','LocalAddress','RemoteAddress') @('LocalAddress','RemoteAddress');
  port=SemanticTable $portFilters @('InstanceID','Protocol','LocalPort','RemotePort','IcmpType','DynamicTarget') @('LocalPort','RemotePort','IcmpType');
  application=SemanticTable $applicationFilters @('InstanceID','Program','Package');
  service=SemanticTable $serviceFilters @('InstanceID','Service');
  interface=SemanticTable $interfaceFilters @('InstanceID','InterfaceAlias') @('InterfaceAlias');
  interfaceType=SemanticTable $interfaceTypeFilters @('InstanceID','InterfaceType');
  security=SemanticTable $securityFilters @('InstanceID','Authentication','Encryption','OverrideBlockRules','LocalUser','RemoteUser','RemoteMachine');
  default4=SemanticTable @($routes | Where-Object DestinationPrefix -eq '0.0.0.0/0' | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric) @('InterfaceIndex','NextHop','RouteMetric','InterfaceMetric');
  default6=SemanticTable @($routes | Where-Object DestinationPrefix -eq '::/0' | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric) @('InterfaceIndex','NextHop','RouteMetric','InterfaceMetric')
}}
$output=[ordered]@{ snapshotSchema=1;complete=$socketEvidence.complete;socketEvidence=$socketEvidence;nonLoopbackRpc=$socketEvidence.nonLoopbackRpc;capturedAtUtc=[DateTime]::UtcNow.ToString('o');administrator=$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
  semanticEncoded=EncodeSemanticFacts $semanticFacts;
  guiAlive=[bool]($gui -and $gui.ProcessName -eq 'easytier-gui');guiFingerprint=$guiFingerprint;ownedForbiddenSocketCount=$forbiddenSockets;adapters=$adapters;aliasConflict=[bool]@($allAdapters | Where-Object {$_.Name -ieq 'lk_trial_20261011_a'}).Count;
  addressOrRouteConflict=$conflict;portalOwnerPids=$socketEvidence.portalOwnerPids;
  default4Sha256=Fingerprint @($routes | Where-Object DestinationPrefix -eq '0.0.0.0/0' | Sort-Object InterfaceIndex,NextHop | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric);
  default6Sha256=Fingerprint @($routes | Where-Object DestinationPrefix -eq '::/0' | Sort-Object InterfaceIndex,NextHop | Select-Object InterfaceIndex,NextHop,RouteMetric,InterfaceMetric);
  firewallSha256=Fingerprint @($rules,$profiles,$filters);categories=$categories;driverCount=$drivers.Count;driverVer=$driverVer;driverSysSha256=$sysHash;
  driverRunning=$driverRunning
} | ConvertTo-Json -Depth 10 -Compress
Mark 'ok'
$output
} catch {
  # Preserve collected safe endpoints even if a later full-snapshot phase fails.
  if($null -ne $socketEvidence) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{snapshotSchema=1;complete=$false;capturedAtUtc=[DateTime]::UtcNow.ToString('o');failedPhase=$script:phase;socketEvidence=$socketEvidence;ownedForbiddenSocketCount=$socketEvidence.ownedForbiddenSocketCount;nonLoopbackRpc=$socketEvidence.nonLoopbackRpc;portalOwnerPids=$socketEvidence.portalOwnerPids}) -Depth 12 -Compress))
  }
  $reason='other'
  if($_.FullyQualifiedErrorId -eq 'snapshot-requires-administrator') { $reason='requires-administrator' }
  elseif($_.CategoryInfo.Category -eq 'PermissionDenied' -or $_.Exception -is [Security.SecurityException]) { $reason='access-denied' }
  elseif($_.Exception -is [Management.Automation.CommandNotFoundException]) { $reason='cmdlet-unavailable' }
  # No exception message, target object, invocation text, raw paths or network fields.
  $errorRow=[ordered]@{schema=1;phase=$script:phase;stage='error';elapsedMs=$clock.ElapsedMilliseconds;
    exceptionType=$_.Exception.GetType().FullName;category=[string]$_.CategoryInfo.Category;hresult=$_.Exception.HResult;
    fullyQualifiedErrorId=$_.FullyQualifiedErrorId;reason=$reason}
  [Console]::Error.WriteLine('LAOKUAI_READONLY_V1 '+(ConvertTo-Json -InputObject $errorRow -Compress))
  exit 1
} finally {
  if($script:semanticAlgorithm) { $script:semanticAlgorithm.Dispose() }
}

# Read-only collector. Dot-sourcing defines functions only; no process/socket is started.
function SocketFingerprint($Value) {
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 9 -Compress))))).Replace('-','').ToLowerInvariant() }
 finally { $algorithm.Dispose() }
}
function ReadSocketProcessIdentity([uint32]$TargetPid) {
 $at=[DateTime]::UtcNow.ToString('o')
 if(!$TargetPid){return [ordered]@{pid=0;status='not-requested';fingerprint=$null;observedAtUtc=$at}}
 try {
  $p=Get-Process -Id $TargetPid -ErrorAction Stop
  if(!$p.StartTime){throw 'unknown-creation-time'}
  [ordered]@{pid=$TargetPid;status='observed';fingerprint=(SocketFingerprint @($p.Id,$p.ProcessName,$p.StartTime.ToUniversalTime().ToString('o')));observedAtUtc=$at}
 } catch { [ordered]@{pid=$TargetPid;status='unknown';fingerprint=$null;observedAtUtc=$at} }
}
function SafeSocketAddress($Value) {
 $ip=$null
 if($Value -isnot [string] -or ![Net.IPAddress]::TryParse($Value,[ref]$ip)){return [ordered]@{family=$null;kind='unknown';value=$null;token=$null}}
 $family=if($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork){4}else{6}
 $kind='other-unicast'
 $bytes=$ip.GetAddressBytes()
 if($Value -in @('0.0.0.0','::')){$kind='wildcard'}
 elseif([Net.IPAddress]::IsLoopback($ip)){$kind='loopback'}
 elseif($family -eq 4 -and ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))){$kind='private'}
 elseif(($family -eq 4 -and $bytes[0] -eq 169 -and $bytes[1] -eq 254) -or ($family -eq 6 -and $ip.IsIPv6LinkLocal)){$kind='link-local'}
 elseif(($family -eq 4 -and $bytes[0] -ge 224 -and $bytes[0] -le 239) -or ($family -eq 6 -and $ip.IsIPv6Multicast)){$kind='multicast'}
 elseif($family -eq 6 -and ($bytes[0] -band 254) -eq 252){$kind='private'}
 # Only loopback/wildcard and the two approved virtual addresses can be plaintext.
 $plain=$kind -in @('wildcard','loopback') -or $Value -in @('10.126.126.2','10.253.253.1')
 [ordered]@{family=$family;kind=$kind;value=if($plain){$Value}else{$null};token=if($plain){$null}else{SocketFingerprint $Value}}
}
function SafeSocketPort($Value) {
 if($null -eq $Value -or $Value -is [string] -or $Value -is [bool]){return $null}
 try { $number=[double]$Value;if($number -ge 0 -and $number -le 65535 -and [Math]::Floor($number) -eq $number){return [int]$number} } catch {}
 return $null
}
function ProjectSocketEvidence($Tcp,$Udp,[uint32]$TargetPid,$Before,$After,$Queries,[bool]$ReadsComplete=$true,[int]$Limit=256) {
 $stable=$TargetPid -gt 0 -and $Before.status -eq 'observed' -and $After.status -eq 'observed' -and $Before.pid -eq $TargetPid -and $After.pid -eq $TargetPid -and $Before.fingerprint -eq $After.fingerprint
 $binding=if($stable){'matched-across-query'}elseif(!$TargetPid){'not-requested'}else{'unknown-or-changed'}
 $rows=@();$forbidden=0;$unknown=0;$portal=@();$nonLoopback=$false;$total=0
 foreach($protocol in @('TCP','UDP')) {
  $inputRows=if($protocol -eq 'TCP'){@($Tcp)}else{@($Udp)}
  foreach($r in $inputRows) {
   $rpc=$protocol -eq 'TCP' -and $r.State -eq 'Listen' -and $r.LocalPort -eq 15897
   $owned=$TargetPid -gt 0 -and $r.OwningProcess -eq $TargetPid
   if(!$rpc -and !$owned){continue}
   if($rpc){$portal+=@([uint32]$r.OwningProcess);if($r.LocalAddress -ne '127.0.0.1'){$nonLoopback=$true}}
   $local=SafeSocketAddress $r.LocalAddress
   $remote=if($protocol -eq 'TCP'){SafeSocketAddress $r.RemoteAddress}else{$null}
   $lp=SafeSocketPort $r.LocalPort;$rp=if($protocol -eq 'TCP'){SafeSocketPort $r.RemotePort}else{$null}
   $state=if($protocol -eq 'UDP'){'not-exposed'}elseif([string]$r.State -in @('Closed','Listen','SynSent','SynReceived','Established','FinWait1','FinWait2','CloseWait','Closing','LastAck','TimeWait','DeleteTCB','Bound')){[string]$r.State}else{'unknown'}
   $known=$local.kind -ne 'unknown' -and $null -ne $lp -and ($protocol -eq 'UDP' -or ($remote.kind -ne 'unknown' -and $null -ne $rp -and $state -ne 'unknown'))
   # Preserve the frozen predicate exactly. Known purpose is never an exception.
   $deny=$owned -and ($protocol -eq 'UDP' -or $r.LocalAddress -ne '127.0.0.1' -or $r.LocalPort -ne 15897 -or $r.RemoteAddress -notin @('0.0.0.0','127.0.0.1'))
   if($deny){$forbidden++}
   if(!$known -or ($owned -and !$stable)){$unknown++}
   $total++
   if($rows.Count -lt $Limit){$rows+=@([ordered]@{protocol=$protocol;localAddress=$local;localPort=$lp;remoteAddress=$remote;remotePort=$rp;remoteAvailability=if($protocol -eq 'UDP'){'not-exposed-by-Get-NetUDPEndpoint'}else{'provider-snapshot'};state=$state;owningPid=[uint32]$r.OwningProcess;ownerIdentity=if($owned){$Before.fingerprint}else{$null};identityBinding=if($owned){$binding}else{'foreign-unverified'};query=$Queries[$protocol.ToLowerInvariant()];knownFields=$known;forbiddenByFrozenRule=[bool]$deny;classification=if(!$known){'unknown'}elseif($owned -and !$stable){'unknown-owner'}elseif($deny){'forbidden'}elseif($owned){'rpc-server-side'}else{'foreign-rpc-listener'}})}
  }
 }
 [ordered]@{schema=1;complete=($ReadsComplete -and $total -le $Limit -and !$unknown -and (!$TargetPid -or $stable));capturedAtUtc=[DateTime]::UtcNow.ToString('o');targetPid=$TargetPid;identityBefore=$Before;identityAfter=$After;identityBinding=$binding;queries=$Queries;totalRows=$total;retainedRows=$rows.Count;truncated=($total -gt $Limit);unknownRows=$unknown;ownedForbiddenSocketCount=$forbidden;nonLoopbackRpc=$nonLoopback;portalOwnerPids=@($portal | Select-Object -Unique);endpoints=$rows}
}
function ReadOwnedSocketEvidence([uint32]$TargetPid) {
 $before=ReadSocketProcessIdentity $TargetPid
 $queries=[ordered]@{};$tcp=@();$udp=@();$ok=$true
 foreach($protocol in @('tcp','udp')) {
  $start=[DateTime]::UtcNow.ToString('o');$status='complete'
  try { if($protocol -eq 'tcp'){$tcp=@(Get-NetTCPConnection -ErrorAction Stop)}elseif($TargetPid -gt 0){$udp=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object OwningProcess -eq $TargetPid)}else{$status='not-requested'} }
  catch {$ok=$false;$status='unavailable'}
  $queries[$protocol]=[ordered]@{startedAtUtc=$start;finishedAtUtc=[DateTime]::UtcNow.ToString('o');status=$status}
 }
 $after=ReadSocketProcessIdentity $TargetPid
 ProjectSocketEvidence $tcp $udp $TargetPid $before $after $queries $ok
}

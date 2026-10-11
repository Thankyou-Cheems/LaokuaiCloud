# Pure fake-data projection only. Does not invoke ReadOwnedSocketEvidence or OS cmdlets.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'owned-tun-socket-evidence.ps1')
foreach($file in @('owned-tun-socket-evidence.ps1','owned-tun-light-snapshot.ps1','owned-tun-trial-snapshot.ps1','check-owned-tun-sockets.ps1','observe-existing-et-sockets.ps1')){
 $tokens=$null;$parseErrors=@()
 [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$tokens,[ref]$parseErrors) | Out-Null
 if($parseErrors.Count){throw 'powershell5-parse-error'}
}
$at='2026-10-11T00:00:00.000Z'
$identity=@{pid=123;status='observed';fingerprint=('a'*64);observedAtUtc=$at}
$queries=@{tcp=@{startedAtUtc=$at;finishedAtUtc=$at;status='complete'};udp=@{startedAtUtc=$at;finishedAtUtc=$at;status='complete'}}
$rpc=@{LocalAddress='127.0.0.1';LocalPort=15897;RemoteAddress='0.0.0.0';RemotePort=0;State='Listen';OwningProcess=123}
$results=@()
function Case($Name,$Tcp,$Udp,$After=$identity,$Read=$true,$Limit=256) {
 $e=ProjectSocketEvidence $Tcp $Udp 123 $identity $After $queries $Read $Limit
 $script:results+=@([ordered]@{name=$Name;evidence=$e})
 return $e
}
function Changed($Fields) { $row=$rpc.Clone();foreach($key in $Fields.Keys){$row[$key]=$Fields[$key]};return $row }
$e=Case 'rpc-listen' @($rpc) @();if(!$e.complete -or $e.ownedForbiddenSocketCount){throw 'rpc-listen-failed'}
$e=Case 'rpc-accepted' @((Changed @{State='Established';RemoteAddress='127.0.0.1';RemotePort=51000})) @();if(!$e.complete -or $e.ownedForbiddenSocketCount){throw 'rpc-accepted-failed'}
foreach($item in @(
 @{name='tcp-client-ephemeral';fields=@{State='Established';LocalPort=51000;RemoteAddress='127.0.0.1';RemotePort=15897}},
 @{name='tcp-ipv6-loopback';fields=@{LocalAddress='::1';RemoteAddress='::'}},
 @{name='tcp-public-remote';fields=@{State='SynSent';RemoteAddress='203.0.113.77';RemotePort=80}},
 @{name='tcp-other-listener';fields=@{LocalPort=9000}},
 @{name='tcp-timewait';fields=@{State='TimeWait';LocalPort=51000}},
 @{name='tcp-wildcard';fields=@{LocalAddress='0.0.0.0'}}
)){$e=Case $item.name @((Changed $item.fields)) @();if(!$e.complete -or $e.ownedForbiddenSocketCount -ne 1){throw 'frozen-tcp-rule-changed'}}
foreach($address in @('0.0.0.0','127.0.0.1','::','::1','10.253.253.1','203.0.113.77')){
 $e=Case ('udp-'+$address.Replace(':','-').Replace('.','-')) @() @(@{LocalAddress=$address;LocalPort=52000;OwningProcess=123})
 if(!$e.complete -or $e.ownedForbiddenSocketCount -ne 1 -or $null -ne $e.endpoints[0].remoteAddress -or $null -ne $e.endpoints[0].remotePort){throw 'udp-rule-or-unknown-remote-changed'}
}
$e=Case 'pid-reused' @($rpc) @() @{pid=123;status='observed';fingerprint=('b'*64);observedAtUtc=$at};if($e.complete -or $e.endpoints[0].identityBinding -ne 'unknown-or-changed'){throw 'pid-reuse-passed'}
$e=Case 'pid-missing' @($rpc) @() @{pid=123;status='unknown';fingerprint=$null;observedAtUtc=$at};if($e.complete){throw 'unknown-pid-passed'}
$e=Case 'query-unavailable' @($rpc) @() $identity $false;if($e.complete){throw 'unknown-query-passed'}
$e=Case 'unknown-address' @((Changed @{LocalAddress='provider-error-with-private-data'})) @();if($e.complete){throw 'unknown-address-passed'}
$e=Case 'unknown-state' @((Changed @{State='unexpected-provider-state'})) @();if($e.complete){throw 'unknown-state-passed'}
$e=Case 'truncated' @($rpc,$rpc) @() $identity $true 1;if($e.complete -or !$e.truncated -or $e.totalRows -ne 2 -or $e.retainedRows -ne 1){throw 'truncation-passed'}
$e=Case 'foreign-rpc-v6' @((Changed @{LocalAddress='::';OwningProcess=6424})) @();if(!$e.nonLoopbackRpc -or $e.endpoints[0].ownerIdentity){throw 'foreign-ownership-asserted'}
$e=Case 'foreign-rpc-v4' @((Changed @{OwningProcess=6424})) @();if($e.endpoints[0].identityBinding -ne 'foreign-unverified'){throw 'foreign-ownership-asserted'}
$text=ConvertTo-Json -InputObject $results -Depth 14 -Compress
if($text.Contains('203.0.113.77') -or $text.Contains('provider-error-with-private-data') -or $text.Contains('unexpected-provider-state')){throw 'raw-address-or-provider-data-leaked'}
[Console]::Out.WriteLine($text)

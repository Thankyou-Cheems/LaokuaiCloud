#requires -Version 7.0
param([Parameter(Mandatory)][string]$SelfExtractor,
      [Parameter(Mandatory)][string]$AuditJson)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $root 'tools/incremental-update-lib.ps1')
$exe=(Resolve-Path -LiteralPath $SelfExtractor).Path
$audit=Get-Content -LiteralPath $AuditJson -Raw | ConvertFrom-Json -AsHashtable
if($audit.status -ne 'passed'){throw 'Passed payload audit required'}
$work=Join-Path $root ('.local/self-extract-test-'+[Guid]::NewGuid().ToString('N'))
$temp=Join-Path $work 'system-temp'
$destination=Join-Path $work '中文 空目录'
New-Item -ItemType Directory -Path $temp | Out-Null
$savedTemp=$env:TEMP;$savedTmp=$env:TMP
$watcher=[IO.FileSystemWatcher]::new($temp);$watcher.IncludeSubdirectories=$true
$eventId='self-extract-'+[Guid]::NewGuid().ToString('N')
$subscription=Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier $eventId
$watcher.EnableRaisingEvents=$true
function Invoke-Extract([string]$Target) {
 $child=Start-Process -FilePath $exe -ArgumentList "/S /D=$Target" -WindowStyle Hidden -PassThru
 if(!$child.WaitForExit(45000)){Stop-Process -Id $child.Id -Force;throw 'Owned test extractor timed out'}
 return $child.ExitCode
}
try {
 $env:TEMP=$temp;$env:TMP=$temp
 $freshCode=Invoke-Extract $destination
 if($freshCode -ne 0){throw "Fresh destination extraction failed: $freshCode"}
 $files=@(Get-ChildItem -LiteralPath $destination -File -Recurse -Force)
 if($files.Count -ne $audit.payloadFiles.Count+1){throw 'Unexpected self-extractor payload count'}
 foreach($relative in $audit.payloadFiles.Keys){
  if((Get-UpdateHash (Join-Path $destination $relative)) -ne $audit.payloadFiles[$relative].sha256){throw 'Self-extracted program differs from audited package'}
 }
 $license=Join-Path $destination 'resources/legal/SELF-EXTRACTOR-LICENSE.txt'
 $compilerLicense=Join-Path $root '.local/toolchains/electron-builder/cache/nsis/nsis-3.0.4.1-nsis-3.0.4.1/COPYING'
 if((Get-UpdateHash $license) -ne (Get-UpdateHash $compilerLicense)){throw 'NSIS license mismatch'}
 $sentinel=Join-Path $destination 'laokuai-chat-data/test-profile.txt'
 New-Item -ItemType Directory -Path (Split-Path -Parent $sentinel) | Out-Null
 [IO.File]::WriteAllText($sentinel,'synthetic profile: preserve',[Text.UTF8Encoding]::new($false))
 $hashes=@{};foreach($file in Get-ChildItem -LiteralPath $destination -Recurse -File -Force){$hashes[$file.FullName]=Get-UpdateHash $file.FullName}
 if((Invoke-Extract $destination) -ne 2){throw 'Existing directory was not rejected'}
 foreach($file in $hashes.Keys){if((Get-UpdateHash $file) -ne $hashes[$file]){throw 'Existing file changed'}}
 if(@(Get-ChildItem -LiteralPath $destination -Recurse -File -Force).Count -ne $hashes.Count){throw 'Existing directory gained files'}
 $forbidden=Join-Path $temp 'forbidden'
 if((Invoke-Extract $forbidden) -ne 2 -or (Test-Path -LiteralPath $forbidden)){throw 'TEMP destination not rejected'}
 Start-Sleep -Milliseconds 250
 $tempEvents=@(Get-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue)
 $tempEvents | ForEach-Object { $_.SourceEventArgs.FullPath } | Set-Content -LiteralPath (Join-Path $work 'temp-created.txt') -Encoding utf8NoBOM
 # NSIS 3.0.4 Main.c ValidateTempDir creates/deletes one empty ns*.tmp
 # writability probe per invocation before script execution; no payload staging.
 $unexpected=@($tempEvents | Where-Object {
   $path=$_.SourceEventArgs.FullPath
   [IO.Path]::GetDirectoryName($path) -ne $temp -or [IO.Path]::GetFileName($path) -notmatch '^ns[A-Za-z0-9]+\.tmp$'
 })
 if($tempEvents.Count -ne 3 -or $unexpected.Count -or @(Get-ChildItem -LiteralPath $temp -Recurse -Force).Count){throw 'Unexpected temporary payload or residual files'}
 $result=[ordered]@{status='passed';verifiedProgramFiles=$audit.payloadFiles.Count;licenseVerified=$true;unicodeAndSpaceDirectory=$true;nonemptyDirectoryRefused=$true;existingProfileUnchanged=$true;temporaryDestinationRefused=$true;observedTempProbes=$tempEvents.Count;temporaryPayloadObserved=$false;temporaryResidualFiles=0;programLaunched=$false;realUserDataAccessed=$false;sha256=Get-UpdateHash $exe}
 $result | ConvertTo-Json | Set-Content -LiteralPath ($exe+'.validation.json') -Encoding utf8NoBOM
 $result | ConvertTo-Json
} finally {
 $env:TEMP=$savedTemp;$env:TMP=$savedTmp
 $watcher.EnableRaisingEvents=$false
 Unregister-Event -SourceIdentifier $eventId
 Get-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue | Remove-Event
 $watcher.Dispose()
}

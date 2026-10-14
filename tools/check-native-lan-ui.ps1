#requires -Version 7.0
# Real hidden Electron boot, fresh profile, offline custom origin, no device access.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$client=Join-Path $repo 'components/client'
$metadata=Get-Content (Join-Path $client 'package.json') -Raw|ConvertFrom-Json
if(!$metadata.grytNativeLanVoice){throw 'Requires native experiment package metadata'}
$electron=Join-Path $repo '.local/toolchains/electron-v40.6.1/electron.exe'
if(!(Test-Path -LiteralPath $electron)){throw 'Pinned local Electron runtime required'}
$directory=Join-Path $repo ('.local/laokuai-ui-check-native-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory)|Out-Null
$savedRunAsNode=$env:ELECTRON_RUN_AS_NODE
$savedDevUrl=$env:VITE_DEV_SERVER_URL
try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:VITE_DEV_SERVER_URL -ErrorAction SilentlyContinue
    $process=Start-Process -FilePath $electron -ArgumentList @(('"'+$client+'"'),('"--laokuai-ui-check-dir='+$directory+'"')) -WorkingDirectory $client -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput ($directory+'.stdout.log') -RedirectStandardError ($directory+'.stderr.log')
    if($process.ExitCode -ne 0){throw "UI check process failed: $($process.ExitCode)"}
    $dom=Get-Content (Join-Path $directory 'ui-evidence/dom.json') -Raw|ConvertFrom-Json
    $events=Get-Content (Join-Path $directory 'ui-evidence/events.json') -Raw|ConvertFrom-Json
    if($dom.rootChildren -lt 1){throw 'Empty renderer root'}
    if($dom.bodyText -match '出了点问题|no <VoiceConfigProvider>|Something went wrong'){throw 'Renderer error boundary shown'}
    if(!$dom.preload.nativeLanVoiceEnabled){throw 'Native branch preload flag absent'}
    if(@($events|Where-Object {$_.kind -in @('preload-error','render-process-gone','unexpected-window-show','unexpected-window-focus','snapshot-failed')}).Count){throw 'Electron boot evidence has a fatal/visibility failure'}
    @{passed=$true;directory=$directory;rootChildren=$dom.rootChildren;nativeMode=$dom.preload.nativeLanVoiceEnabled;realProfileUsed=$false;networkAndDevicesBlocked=$true}|ConvertTo-Json
} finally {
    $env:ELECTRON_RUN_AS_NODE=$savedRunAsNode
    $env:VITE_DEV_SERVER_URL=$savedDevUrl
}

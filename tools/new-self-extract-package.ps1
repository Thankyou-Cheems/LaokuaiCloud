#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$VerifiedPayload,
      [Parameter(Mandatory)][string]$AuditJson,
      [Parameter(Mandatory)][string]$OutputExe)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $root 'tools/incremental-update-lib.ps1')
$payload=(Resolve-Path -LiteralPath $VerifiedPayload).Path
$output=[IO.Path]::GetFullPath($OutputExe)
if([IO.Path]::GetExtension($output) -ne '.exe' -or (Test-Path -LiteralPath $output)){throw 'A fresh .exe output is required'}
if($output.StartsWith($payload+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Output must be outside payload'}
$audit=Get-Content -LiteralPath $AuditJson -Raw | ConvertFrom-Json -AsHashtable
if($audit.status -ne 'passed' -or !$audit.zip.sha256 -or $audit.payloadFiles.Count -lt 1){throw 'Passed package audit required'}
Assert-UpdatePlainPath $payload
foreach($entry in Get-ChildItem -LiteralPath $payload -Recurse -Force){Assert-UpdatePlainPath $entry.FullName}
$files=@(Get-ChildItem -LiteralPath $payload -Recurse -File -Force)
if($files.Count -ne $audit.payloadFiles.Count){throw 'Payload count mismatch'}
foreach($file in $files){
 $relative=[IO.Path]::GetRelativePath($payload,$file.FullName).Replace('\','/')
 if(!$audit.payloadFiles.ContainsKey($relative) -or (Get-UpdateHash $file.FullName) -ne $audit.payloadFiles[$relative].sha256){throw 'Payload hash mismatch'}
}
$compiler=Join-Path $root '.local/toolchains/electron-builder/cache/nsis/nsis-3.0.4.1-nsis-3.0.4.1/Bin/makensis.exe'
if(!(Test-Path -LiteralPath $compiler)){throw 'Prepare the pinned electron-builder NSIS toolchain first'}
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
$process=[Diagnostics.Process]::GetCurrentProcess();$process.PriorityClass='BelowNormal';$process.ProcessorAffinity=3
& $compiler /NOCONFIG /INPUTCHARSET UTF8 "/DAPP_VERSION=$($audit.version)" "/DPAYLOAD_DIR=$payload" "/DOUTPUT_EXE=$output" "/DAPP_ICON=$root/components/client/private-brand/icon.ico" (Join-Path $root 'tools/self-extract-green.nsi') *> ($output+'.build.log')
if($LASTEXITCODE){throw 'Self-extractor build failed; see build log'}
$receipt=[ordered]@{schemaVersion=1;version=$audit.version;file=[IO.Path]::GetFileName($output);bytes=(Get-Item -LiteralPath $output).Length;sha256=Get-UpdateHash $output;baseZipSha256=$audit.zip.sha256;payloadFiles=$audit.payloadFiles.Count;compression='per-file LZMA, non-solid';elevation='asInvoker';pluginsUsed=$false;runtimeTestPassed=$false;extraLicense='resources/legal/SELF-EXTRACTOR-LICENSE.txt';compilerSha256=Get-UpdateHash $compiler;scriptSha256=Get-UpdateHash (Join-Path $root 'tools/self-extract-green.nsi')}
$receipt | ConvertTo-Json | Set-Content -LiteralPath ($output+'.build.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json

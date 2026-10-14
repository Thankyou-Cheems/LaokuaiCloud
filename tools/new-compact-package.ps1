#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$VerifiedPayload,
      [Parameter(Mandatory)][string]$AuditJson,
      [Parameter(Mandatory)][string]$OutputArchive)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $root 'tools/incremental-update-lib.ps1')
$payload=(Resolve-Path -LiteralPath $VerifiedPayload).Path
$archive=[IO.Path]::GetFullPath($OutputArchive)
if([IO.Path]::GetExtension($archive) -ne '.7z' -or (Test-Path -LiteralPath $archive)){throw 'A fresh .7z output is required'}
if($archive.StartsWith($payload+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive must be outside payload'}
$audit=Get-Content -LiteralPath $AuditJson -Raw | ConvertFrom-Json -AsHashtable
if($audit.status -ne 'passed' -or !$audit.zip.sha256 -or $audit.payloadFiles.Count -lt 1){throw 'A passed final package audit is required'}
Assert-UpdatePlainPath $payload
foreach($entry in Get-ChildItem -LiteralPath $payload -Recurse -Force){Assert-UpdatePlainPath $entry.FullName}
function Confirm-Payload([string]$Directory) {
 $files=@(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force)
 if($files.Count -ne $audit.payloadFiles.Count){throw 'Payload file count mismatch'}
 foreach($file in $files){
  $relative=[IO.Path]::GetRelativePath($Directory,$file.FullName).Replace('\','/')
  if(!$audit.payloadFiles.ContainsKey($relative) -or (Get-UpdateHash $file.FullName) -ne $audit.payloadFiles[$relative].sha256){throw 'Payload hash mismatch'}
 }
}
Confirm-Payload $payload
$work=Join-Path $root ('.local/compact-package-check-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
$zipTool=Join-Path $root 'components/client/node_modules/7zip-bin/win/x64/7za.exe'
$process=[Diagnostics.Process]::GetCurrentProcess();$process.PriorityClass='BelowNormal';$process.ProcessorAffinity=3
Push-Location -LiteralPath $payload
try {
 & $zipTool a -t7z $archive '.\*' -mx=9 -m0=LZMA2 -md=64m -ms=on -mmt=2 -bd *> (Join-Path $work 'compress.log')
 if($LASTEXITCODE){throw 'Compression failed'}
} finally {Pop-Location}
$extracted=Join-Path $work 'extracted'
& $zipTool x $archive "-o$extracted" -y -bd *> (Join-Path $work 'extract.log')
if($LASTEXITCODE){throw 'Archive verification extraction failed'}
Confirm-Payload $extracted
$receipt=[ordered]@{schemaVersion=1;version=$audit.version;file=[IO.Path]::GetFileName($archive);bytes=(Get-Item -LiteralPath $archive).Length;sha256=Get-UpdateHash $archive;baseZipSha256=$audit.zip.sha256;baseZipBytes=$audit.zip.bytes;verifiedFiles=$audit.payloadFiles.Count;payloadByteIdentical=$true;programExecuted=$false;desktopModified=$false}
$receipt | ConvertTo-Json | Set-Content -LiteralPath ($archive+'.receipt.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json

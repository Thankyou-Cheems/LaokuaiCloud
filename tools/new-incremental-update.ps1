[CmdletBinding()]
param([Parameter(Mandatory)][string]$BaseZip, [Parameter(Mandatory)][string]$TargetZip,
    [Parameter(Mandatory)][string]$OutputZip, [Parameter(Mandatory)][string]$BaseVersion,
    [Parameter(Mandatory)][string]$TargetVersion)
. (Join-Path $PSScriptRoot 'incremental-update-lib.ps1')
New-LaokuaiIncrementalUpdate @PSBoundParameters | ConvertTo-Json -Depth 10

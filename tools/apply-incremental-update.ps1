[CmdletBinding()]
param([Parameter(Mandatory)][string]$UpdateZip, [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][string]$ExpectedPackageSha256)
. (Join-Path $PSScriptRoot 'incremental-update-lib.ps1')
Invoke-LaokuaiIncrementalUpdate @PSBoundParameters | ConvertTo-Json -Depth 10

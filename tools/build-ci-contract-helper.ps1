#requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (!$IsWindows -or $env:GITHUB_ACTIONS -ne 'true') {
    throw 'This build is for an isolated Windows GitHub runner; it must not replace a local frozen helper.'
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& (Join-Path $root 'components/client/scripts/build-community-broker.ps1')
if ($LASTEXITCODE -ne 0) { throw 'CI contract helper compilation failed.' }
# The build only emits the helper. Checks execute its self-test entrypoints,
# never normal permission, firewall/DNS installation, ET or UAC entrypoints.
Write-Host 'CI CLR helper built; no installation, elevation or product startup.'

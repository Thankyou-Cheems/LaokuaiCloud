# Dot-source this file to prepare this terminal. It does not start any server/app.
$ErrorActionPreference = 'Stop'
$laokuaiRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$laokuaiNode = Join-Path $laokuaiRoot '.local/toolchains/node24'
$laokuaiYarn = Join-Path $laokuaiRoot '.local/toolchains/yarn-classic/bin'
if (!(Test-Path -LiteralPath (Join-Path $laokuaiNode 'node.exe'))) { throw 'Local Node24 material is missing; see HANDOFF.md.' }
$env:Path = "$laokuaiNode;$laokuaiYarn;$env:Path"
Set-Location -LiteralPath (Join-Path $laokuaiRoot 'components/client')
Write-Host 'Local tools prepared. No app/server/build was started. Read HANDOFF.md before runtime testing.'

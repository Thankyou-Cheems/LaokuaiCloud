[CmdletBinding()]
param(
    [ValidateSet('Prepare','SourceUpdate','PatchSet')][string]$Stage = 'Prepare',
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$BaselineCommit,
    [Parameter(Mandatory)][string]$FrozenSource,
    [string]$CandidateOutput,
    [string]$ProducerReceipt,
    [string]$StageDirectory,
    [string]$NodePath
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required' }
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$NodePath) { $NodePath = Join-Path $root '.local/toolchains/node24/node.exe' }
if ($Stage -eq 'PatchSet') {
    if (!$BaselineCommit) { throw 'PatchSet requires BaselineCommit' }
    & $NodePath (Join-Path $root 'components/client/scripts/prepare-easytier-candidate.cjs') --patch-set-only --repo $root --source-commit $SourceCommit --baseline-commit $BaselineCommit --frozen-source $FrozenSource
} elseif ($Stage -eq 'SourceUpdate') {
    & $NodePath (Join-Path $root 'components/client/scripts/prepare-easytier-candidate.cjs') --source-update-only --repo $root --source-commit $SourceCommit --frozen-source $FrozenSource
} else {
    if (!$BaselineCommit -or !$CandidateOutput -or !$ProducerReceipt -or !$StageDirectory) { throw 'Prepare requires BaselineCommit, CandidateOutput, ProducerReceipt and StageDirectory' }
    & $NodePath (Join-Path $root 'components/client/scripts/prepare-easytier-candidate.cjs') --repo $root --source-commit $SourceCommit --baseline-commit $BaselineCommit --frozen-source $FrozenSource --candidate-output $CandidateOutput --producer-receipt $ProducerReceipt --stage-directory $StageDirectory
}
if ($LASTEXITCODE -ne 0) { throw 'Candidate source/static verification failed; old product bytes and receipts were not modified' }
if ($Stage -in @('SourceUpdate','PatchSet')) { Write-Output 'Source-only materials prepared from exact frozen blobs. Native runtime remains unaccepted; production payload unchanged.' }
else { Write-Output 'Candidate staged with immutable source/blob and normal/delay PE evidence. Native runtime remains unaccepted; production payload unchanged.' }

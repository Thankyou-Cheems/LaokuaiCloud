#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][ValidateSet('inspect','build-test','stage','activate','rollback')][string]$Phase,
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$SshHost = 'TencentCloudPublic',
    [ValidatePattern('^$|^r[1-9][0-9]*$')][string]$PreparationSuffix = '',
    [switch]$UseOfflineWrapper,
    [ValidatePattern('^$|^[0-9a-f]{64}$')][string]$CacheManifestSha256 = '',
    [ValidatePattern('^$|^[0-9a-f]{64}$')][string]$ExpectedWrapperSha256 = ''
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$identity = $SourceCommit.Substring(0,12) + $(if ($PreparationSuffix) { '-' + $PreparationSuffix } else { '' })
$remote = '/opt/stacks/gryt/live16-voice-fixes-' + $identity
if ($UseOfflineWrapper) {
    if (!$CacheManifestSha256 -or !$ExpectedWrapperSha256 -or $Phase -eq 'inspect') { throw 'Offline wrapper requires exact hashes and a supported explicit phase' }
    $runner = @'
import hashlib,runpy,sys
path=sys.argv[1]
assert hashlib.sha256(open(path,'rb').read()).hexdigest()==sys.argv[2], 'wrapper-pin-mismatch'
sys.argv=[path,*sys.argv[3:]]
runpy.run_path(path,run_name='__main__')
'@
    # Pass only validated path/phase/hashes; no credentials enter the command.
    $oneLine = $runner.Replace("`n", ';')
    $command = "python3 -I -c `"$oneLine`" $remote/resume-offline.py $ExpectedWrapperSha256 --work $remote --cache-manifest-sha256 $CacheManifestSha256 --phase $Phase"
} else { $command = "python3 -I $remote/operator.py $Phase --work $remote" }
& 'C:/Windows/System32/OpenSSH/ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 $SshHost $command
if ($LASTEXITCODE) { throw "Remote $Phase failed; preserve its private evidence" }

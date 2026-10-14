#requires -Version 7.0
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][ValidateSet('inspect','build','activate','rollback')][string]$Phase
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$remote = '/opt/stacks/gryt/native-lan-voice-' + $SourceCommit.Substring(0,12)
& 'C:/Windows/System32/OpenSSH/ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 TencentCloudPublic "python3 -I $remote/operator.py $Phase --work $remote"
if ($LASTEXITCODE) { throw "Remote $Phase failed; private evidence retained" }

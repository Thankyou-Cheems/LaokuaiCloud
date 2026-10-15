[CmdletBinding()]
param([string]$RealBaseZip, [string]$RealTargetZip,
    [string]$OutputDirectory = 'D:/Dev/LaokuaiCloud/.local/handoff13-20261014/incremental-tests')
. (Join-Path $PSScriptRoot '../incremental-update-lib.ps1')
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
Assert-UpdatePlainPath $OutputDirectory
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Test output already exists; choose a fresh directory.' }
[void][IO.Directory]::CreateDirectory($OutputDirectory)
$results = [Collections.Generic.List[object]]::new()
function Check([string]$Name, [scriptblock]$Action) {
    & $Action
    $results.Add(@{ name = $Name; status = 'passed' }); Write-Host "PASS $Name"
}
function Expect-Rejection([scriptblock]$Action, [string]$Pattern) {
    $failed = $false
    try { & $Action | Out-Null } catch { if ($_.Exception.Message -notmatch $Pattern) { throw }; $failed = $true }
    if (!$failed) { throw "Expected rejection: $Pattern" }
}
function Write-FixtureZip([string]$Path, [System.Collections.IDictionary]$Entries) {
    $zip = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries.Keys) {
            $entry = $zip.CreateEntry($name); $stream = $entry.Open()
            try { $bytes = [byte[]]$Entries[$name]; $stream.Write($bytes) } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
}
function New-FixtureInstall([string]$Name) {
    $dir = Join-Path $OutputDirectory $Name; [void][IO.Directory]::CreateDirectory($dir)
    $zip = [IO.Compression.ZipFile]::OpenRead($baseZip)
    try { Expand-UpdateEntries (Read-UpdateZipIndex $zip -Program) $dir } finally { $zip.Dispose() }
    [void][IO.Directory]::CreateDirectory((Join-Path $dir 'profile/nested'))
    [IO.File]::WriteAllText((Join-Path $dir 'profile/nested/account.json'), 'fixture-only private account', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $dir 'unknown.bin'), 'keep unknown', [Text.UTF8Encoding]::new($false))
    return $dir
}
function Assert-ProtectedFiles([string]$Dir) {
    if ([IO.File]::ReadAllText((Join-Path $Dir 'profile/nested/account.json')) -cne 'fixture-only private account') { throw 'Profile changed.' }
    if ([IO.File]::ReadAllText((Join-Path $Dir 'unknown.bin')) -cne 'keep unknown') { throw 'Unknown file changed.' }
}
function Assert-FixtureBaseline([string]$Dir) {
    foreach ($path in $baseline.Keys) { $file = Get-UpdatePath $Dir $path; if ((Get-UpdateHash $file) -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$baseline[$path])).ToLowerInvariant()) { throw "Baseline restoration failed: $path" } }
    if (Test-Path -LiteralPath (Join-Path $Dir 'locales/zh-CN.pak')) { throw 'Addition was not rolled back.' }
    Assert-ProtectedFiles $Dir
}
function Rewrite-Package([string]$Name, [scriptblock]$Change) {
    $dir = Join-Path $OutputDirectory ($Name + '-contents'); [void][IO.Directory]::CreateDirectory($dir)
    $zip = [IO.Compression.ZipFile]::OpenRead($updateZip)
    try { Expand-UpdateEntries (Read-UpdateZipIndex $zip) $dir } finally { $zip.Dispose() }
    & $Change $dir
    $newZip = Join-Path $OutputDirectory ($Name + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($dir, $newZip)
    return $newZip
}
$exe = [byte[]]::new(2MB); [Random]::new(88).NextBytes($exe)
$newExe = $exe.Clone(); $newExe[100] = $newExe[100] -bxor 1; $newExe[1500000] = $newExe[1500000] -bxor 2
$baseline = [ordered]@{ '唠蒯云.exe' = $exe; 'resources/app.asar' = [Text.Encoding]::UTF8.GetBytes('old application'); 'chrome_100_percent.pak' = [byte[]](1,2,3) }
$targetEntries = [ordered]@{ '唠蒯云.exe' = $newExe; 'resources/app.asar' = [Text.Encoding]::UTF8.GetBytes('new application'); 'locales/zh-CN.pak' = [byte[]](4,5,6) }
$baseZip = Join-Path $OutputDirectory 'base.zip'; $targetZip = Join-Path $OutputDirectory 'target.zip'; $updateZip = Join-Path $OutputDirectory 'update.zip'
Write-FixtureZip $baseZip $baseline; Write-FixtureZip $targetZip $targetEntries
$build = New-LaokuaiIncrementalUpdate -BaseZip $baseZip -TargetZip $targetZip -OutputZip $updateZip -BaseVersion fixture.1 -TargetVersion fixture.2
$packageHash = Get-UpdateHash $updateZip
Check '64KiB binary blocks reduce payload' {
    $c = @($build.changes | Where-Object path -EQ '唠蒯云.exe')[0]
    if ($c.kind -ne 'blocks' -or $c.offsets.Count -ne 2 -or $c.payloadSize -ne 131072) { throw 'Unexpected block patch.' }
}
Check 'complete target, declared add/delete, protected files' {
    $dir = New-FixtureInstall 'success'
    $applied = Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 $packageHash
    foreach ($path in $targetEntries.Keys) { if ((Get-UpdateHash (Get-UpdatePath $dir $path)) -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$targetEntries[$path])).ToLowerInvariant()) { throw 'Target mismatch.' } }
    if (Test-Path -LiteralPath (Join-Path $dir 'chrome_100_percent.pak')) { throw 'Deletion failed.' }; Assert-ProtectedFiles $dir
    if ((Get-Content -LiteralPath $applied.reportPath -Raw | ConvertFrom-Json).status -ne 'complete') { throw 'Missing completion report.' }
}
Check 'baseline mismatch rejected without touching protected data' {
    $dir = New-FixtureInstall 'bad-base'; [IO.File]::WriteAllText((Join-Path $dir 'resources/app.asar'), 'wrong baseline')
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 $packageHash } 'Baseline mismatch'; Assert-ProtectedFiles $dir
}
Check 'trusted package hash rejects tampering' {
    $dir = New-FixtureInstall 'bad-checksum'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 ('0' * 64) } 'checksum mismatch'; Assert-FixtureBaseline $dir
}
Check 'payload corruption rejected after package checksum verified' {
    $corrupt = Rewrite-Package 'bad-payload' { param($dir) [IO.File]::WriteAllBytes((Join-Path $dir 'payload/0001.bin'), [byte[]]::new(131072)) }
    $dir = New-FixtureInstall 'corrupt-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $corrupt -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $corrupt) } 'Payload hash mismatch|Payload size mismatch'; Assert-FixtureBaseline $dir
}
Check 'replacement failure restores baseline and profile' {
    $dir = New-FixtureInstall 'rollback'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 $packageHash -TestFailAfterReplacement 3 } 'Injected test replacement failure'; Assert-FixtureBaseline $dir
}
Check 'path traversal archive refused' {
    $evil = Join-Path $OutputDirectory 'traversal.zip'; Write-FixtureZip $evil ([ordered]@{ '../profile/account.json' = [byte[]](1) })
    $dir = New-FixtureInstall 'traversal-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $evil -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $evil) } 'Unsafe relative path'; Assert-FixtureBaseline $dir
}
Check 'absolute, alternate-stream, reserved and backslash paths refused' {
    foreach ($path in @('C:/profile.json','/profile.json','profile\\x.json','a/../b','a:stream','a/NUL.txt','a/b.')) { Expect-Rejection { Assert-UpdateRelativePath $path } 'Unsafe relative path' }
}
Check 'case duplicate archive refused' {
    $evil = Join-Path $OutputDirectory 'duplicate.zip'
    $duplicateEntries = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    $duplicateEntries.Add('resources/app.asar', [byte[]](1)); $duplicateEntries.Add('RESOURCES/APP.ASAR', [byte[]](2))
    Write-FixtureZip $evil $duplicateEntries
    $dir = New-FixtureInstall 'duplicate-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $evil -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $evil) } 'Duplicate archive path'; Assert-FixtureBaseline $dir
}
Check 'profile manifest path refused' {
    $evil = Rewrite-Package 'profile-path' { param($dir)
        $m = Get-Content -LiteralPath (Join-Path $dir 'update.json') -Raw | ConvertFrom-Json; $m.targetFiles[0].path = 'profile/account.json'; Write-UpdateJson (Join-Path $dir 'update.json') $m
    }
    $dir = New-FixtureInstall 'profile-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $evil -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $evil) } 'outside the fixed program whitelist'; Assert-FixtureBaseline $dir
}
Check 'native audio program and six licenses have exact whitelist entries' {
    foreach ($path in @('resources/native-lan-audio/laokuai-native-audio.exe',
        'resources/native-lan-audio/licenses/AoO-BSD.txt',
        'resources/native-lan-audio/licenses/LaokuaiCloud-AGPL-3.0-or-later.txt',
        'resources/native-lan-audio/licenses/Opus-COPYING.txt',
        'resources/native-lan-audio/licenses/Opus-patent-notice.txt',
        'resources/native-lan-audio/licenses/oscpack.txt',
        'resources/native-lan-audio/licenses/PortAudio.txt')) { Assert-UpdateProgramPath $path }
    foreach ($path in @('resources/native-lan-audio/profile.json',
        'resources/native-lan-audio/licenses/unknown.txt',
        'resources/native-lan-audio/laokuai-native-audio.exe.config')) {
        Expect-Rejection { Assert-UpdateProgramPath $path } 'outside the fixed program whitelist'
    }
}
Check 'out of range block patch rejected before replacement' {
    $evil = Rewrite-Package 'bad-offset' { param($dir)
        $m = Get-Content -LiteralPath (Join-Path $dir 'update.json') -Raw | ConvertFrom-Json
        $blocks = @($m.changes | Where-Object kind -EQ 'blocks')[0]; $blocks.offsets = @(0, 999999999)
        Write-UpdateJson (Join-Path $dir 'update.json') $m
    }
    $dir = New-FixtureInstall 'offset-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $evil -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $evil) } 'Invalid patch offset'; Assert-FixtureBaseline $dir
}
Check 'staged target hash rejects valid-range corrupt result' {
    $evil = Rewrite-Package 'bad-target-hash' { param($dir)
        $m = Get-Content -LiteralPath (Join-Path $dir 'update.json') -Raw | ConvertFrom-Json
        $m.targetFiles[0].sha256 = '0' * 64; Write-UpdateJson (Join-Path $dir 'update.json') $m
    }
    $dir = New-FixtureInstall 'target-hash-install'
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $evil -InstallDirectory $dir -ExpectedPackageSha256 (Get-UpdateHash $evil) } 'Staged target mismatch'; Assert-FixtureBaseline $dir
}
Check 'existing unknown file blocks declared addition' {
    $dir = New-FixtureInstall 'unknown-add'; [void][IO.Directory]::CreateDirectory((Join-Path $dir 'locales')); [IO.File]::WriteAllText((Join-Path $dir 'locales/zh-CN.pak'), 'user-owned existing file')
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 $packageHash } 'overwrite an unknown file'
    if ([IO.File]::ReadAllText((Join-Path $dir 'locales/zh-CN.pak')) -ne 'user-owned existing file') { throw 'Unknown addition clobbered.' }; Assert-ProtectedFiles $dir
}
Check 'cloud family allowed, redirect/unknown tags refused' {
    foreach ($tag in @([uint32]0x9000001aL,[uint32]0x9000601aL,[uint32]0x9000f01aL)) { if (!(Test-UpdateAllowedReparseTag $tag)) { throw 'Cloud tag rejected.' } }
    foreach ($tag in @([uint32]0xa0000003L,[uint32]0xa000000cL,[uint32]0x8000001bL,[uint32]0x90001000L)) { if (Test-UpdateAllowedReparseTag $tag) { throw 'Unsafe tag allowed.' } }
}
Check 'junction installation directory refused' {
    $dir = New-FixtureInstall 'junction-source'; $link = Join-Path $OutputDirectory 'junction-install'
    New-Item -ItemType Junction -Path $link -Target $dir | Out-Null
    Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $link -ExpectedPackageSha256 $packageHash } 'reparse point refused'; Assert-FixtureBaseline $dir
}
Check 'running executable rejected without automatic termination' {
    $dir = New-FixtureInstall 'running'; $node = Join-Path $dir 'fixture-process.exe'
    [IO.File]::Copy('D:/Dev/LaokuaiCloud/.local/toolchains/node24/node.exe', $node)
    $js = Join-Path $dir 'fixture.js'; [IO.File]::WriteAllText($js, 'setInterval(() => {}, 1000);')
    $running = Start-Process -FilePath $node -ArgumentList ('"' + $js + '"') -WindowStyle Hidden -PassThru
    try {
        Expect-Rejection { Invoke-LaokuaiIncrementalUpdate -UpdateZip $updateZip -InstallDirectory $dir -ExpectedPackageSha256 $packageHash } 'is running'; if ($running.HasExited) { throw 'Updater stopped process.' }; Assert-FixtureBaseline $dir
    } finally { if (!$running.HasExited) { $running.Kill(); $running.WaitForExit() }; $running.Dispose() }
}
if ($RealBaseZip -and $RealTargetZip) {
    Check 'real archived ZIP delta and complete target verification' {
        $realUpdate = Join-Path $OutputDirectory 'real-update.zip'
        $receipt = New-LaokuaiIncrementalUpdate -BaseZip $RealBaseZip -TargetZip $RealTargetZip -OutputZip $realUpdate -BaseVersion archive-base -TargetVersion archive-target
        $realInstall = Join-Path $OutputDirectory 'real-install'; [void][IO.Directory]::CreateDirectory($realInstall)
        $archive = [IO.Compression.ZipFile]::OpenRead($RealBaseZip)
        try { Expand-UpdateEntries (Read-UpdateZipIndex $archive -Program) $realInstall } finally { $archive.Dispose() }
        [void][IO.Directory]::CreateDirectory((Join-Path $realInstall 'profile'))
        [IO.File]::WriteAllText((Join-Path $realInstall 'profile/test-account.json'), 'retain fixture profile')
        $profileHash = Get-UpdateHash (Join-Path $realInstall 'profile/test-account.json')
        $applied = Invoke-LaokuaiIncrementalUpdate -UpdateZip $realUpdate -InstallDirectory $realInstall -ExpectedPackageSha256 $receipt.updateZipSha256
        if ($profileHash -ne (Get-UpdateHash (Join-Path $realInstall 'profile/test-account.json'))) { throw 'Real fixture profile changed.' }
        Write-UpdateJson (Join-Path $OutputDirectory 'real-result.json') @{ updateBytes = $receipt.updateZipBytes; updateSha256 = $receipt.updateZipSha256; targetFiles = $applied.targetFiles; status = 'complete' }
    }
}
Write-UpdateJson (Join-Path $OutputDirectory 'results.json') @{ passed = $results.Count; tests = @($results.ToArray()) }
Write-Host "Passed $($results.Count) checks. Results: $(Join-Path $OutputDirectory 'results.json')"

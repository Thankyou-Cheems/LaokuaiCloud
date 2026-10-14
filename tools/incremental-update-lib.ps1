# Shared implementation for fixed-baseline portable updates. PowerShell 7 only.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }
$script:UpdateMaxFile = 1GB
$script:UpdateMaxTotal = 4GB
$script:UpdateToolNames = @('apply-incremental-update.ps1','apply-incremental-update.cmd','incremental-update-lib.ps1','incremental-program-paths.json')
$script:UpdateWhitelist = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'incremental-program-paths.json') -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($p in $policy.paths) { [void]$script:UpdateWhitelist.Add($p) }

function Assert-UpdateRelativePath([string]$Path) {
    if (!$Path -or $Path.Length -gt 240 -or $Path.Contains('\') -or $Path.StartsWith('/') -or $Path.Contains(':') -or $Path -match '[\x00-\x1f<>"|?*]') { throw "Unsafe relative path: $Path" }
    foreach ($part in $Path.Split('/')) {
        if (!$part -or $part -in @('.', '..') -or $part.TrimEnd(' ', '.') -ne $part -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') { throw "Unsafe relative path: $Path" }
    }
}
function Assert-UpdateProgramPath([string]$Path) {
    Assert-UpdateRelativePath $Path
    if (!$script:UpdateWhitelist.Contains($Path)) { throw "Path is outside the fixed program whitelist: $Path" }
}
function Get-UpdateHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-UpdateHash([string]$Hash) { if ($Hash -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid SHA256.' } }
function Test-UpdateAllowedReparseTag([uint32]$Tag) { return ($Tag -band [uint32]0xffff0fffL) -eq [uint32]0x9000001aL }
function Assert-UpdatePlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                # OneDrive cloud tags are not path redirects. Reading files hydrates
                # them normally; every other tag, including name surrogates, fails.
                $tag = [LaokuaiReparseTag]::Read($current)
                if (!(Test-UpdateAllowedReparseTag $tag)) { throw "Redirect/unknown reparse point refused: $current" }
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }; $current = $parent
    }
}
function Get-UpdatePath([string]$Root, [string]$Relative) {
    Assert-UpdateRelativePath $Relative
    $result = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (!$result.StartsWith([IO.Path]::GetFullPath($Root).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped root.' }
    Assert-UpdatePlainPath $result
    return $result
}
function Read-UpdateZipIndex($Archive, [switch]$Program) {
    $index = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    if ($Archive.Entries.Count -gt 1024) { throw 'Too many archive entries.' }
    foreach ($entry in $Archive.Entries) {
        $dir = $entry.FullName.EndsWith('/')
        $path = if ($dir) { $entry.FullName.TrimEnd('/') } else { $entry.FullName }
        Assert-UpdateRelativePath $path
        if (!$seen.Add($path)) { throw "Duplicate archive path: $path" }
        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xf000
        if ($unixType -eq 0xa000 -or ($entry.ExternalAttributes -band 0x400)) { throw "Archive reparse/symlink entry refused: $path" }
        if ($dir) { if ($entry.Length -ne 0) { throw 'Directory contains data.' }; continue }
        if ($Program) { Assert-UpdateProgramPath $path }
        if ($entry.Length -gt $script:UpdateMaxFile) { throw 'Archive file exceeds limit.' }
        $total += $entry.Length; if ($total -gt $script:UpdateMaxTotal) { throw 'Archive exceeds expanded-size limit.' }
        $index.Add($path, $entry)
    }
    # Reject file/directory collisions even if the colliding directory is implicit.
    foreach ($path in $index.Keys) {
        $parent = $path
        while ($parent.Contains('/')) { $parent = $parent.Substring(0, $parent.LastIndexOf('/')); if ($index.ContainsKey($parent)) { throw 'Archive file/directory collision.' } }
    }
    foreach ($path in $seen) {
        if (!$index.ContainsKey($path)) {
            $hasFile = $false
            foreach ($filePath in $index.Keys) { if ($filePath.StartsWith($path + '/', [StringComparison]::OrdinalIgnoreCase)) { $hasFile = $true; break } }
            if (!$hasFile) { throw "Undeclared empty archive directory: $path" }
        }
    }
    return ,$index
}
function Expand-UpdateEntries($Index, [string]$Root) {
    foreach ($path in $Index.Keys) {
        $destination = Get-UpdatePath $Root $path
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $source = $Index[$path].Open(); $output = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
        try { $source.CopyTo($output) } finally { $output.Dispose(); $source.Dispose() }
    }
}
function Add-UpdateZipFile($Archive, [string]$Source, [string]$Path) {
    $entry = $Archive.CreateEntry($Path, [IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [IO.File]::OpenRead($Source); $output = $entry.Open()
    try { $inputStream.CopyTo($output) } finally { $output.Dispose(); $inputStream.Dispose() }
}
function Write-UpdateJson([string]$Path, $Object) {
    $Object | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
if (!('LaokuaiBlockPatch' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class LaokuaiReparseTag {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, uint inputSize, byte[] output, uint outputSize, out uint returned, IntPtr overlapped);
    public static uint Read(string path) {
        using var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        byte[] buffer = new byte[16384];
        if (!DeviceIoControl(handle, 0x000900a8, IntPtr.Zero, 0, buffer, (uint)buffer.Length, out uint returned, IntPtr.Zero) || returned < 8)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return BitConverter.ToUInt32(buffer,0);
    }
}
public static class LaokuaiBlockPatch {
    public static long[] Create(string baseline, string target, string payload) {
        var offsets = new List<long>();
        using var a = File.OpenRead(baseline); using var b = File.OpenRead(target); using var p = File.Create(payload);
        if (a.Length != b.Length) throw new InvalidDataException("Patch lengths differ.");
        byte[] x = new byte[65536], y = new byte[65536];
        long position = 0;
        while (position < a.Length) {
            int n = (int)Math.Min(65536, a.Length-position); a.ReadExactly(x.AsSpan(0,n)); b.ReadExactly(y.AsSpan(0,n));
            if (!x.AsSpan(0,n).SequenceEqual(y.AsSpan(0,n))) { offsets.Add(position); p.Write(y,0,n); }
            position += n;
        }
        return offsets.ToArray();
    }
    public static void Apply(string staged, string payload, long[] offsets) {
        using var f = new FileStream(staged, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        using var p = File.OpenRead(payload); byte[] block = new byte[65536];
        long previous = -1;
        if (offsets.Length > 16384) throw new InvalidDataException("Too many patch blocks.");
        foreach (long offset in offsets) {
            if (offset < 0 || offset % 65536 != 0 || offset <= previous || offset >= f.Length) throw new InvalidDataException("Invalid patch offset.");
            int n = (int)Math.Min(65536, f.Length-offset); p.ReadExactly(block.AsSpan(0,n)); f.Position = offset; f.Write(block,0,n); previous = offset;
        }
        if (p.Position != p.Length) throw new InvalidDataException("Unexpected patch bytes.");
        f.Flush(true);
    }
}
'@
}
function Assert-UpdateAppStopped([string]$InstallDirectory) {
    $prefix = $InstallDirectory.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    $names = @($script:UpdateWhitelist | Where-Object { $_.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [IO.Path]::GetFileName($_) })
    foreach ($process in Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) {
        $exe = [string]$process.ExecutablePath
        if (($exe -and $exe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -or (!$exe -and $process.Name -in $names)) {
            throw "Application/helper is running (PID $($process.ProcessId)); exit the application first. No process was stopped."
        }
    }
}
function New-LaokuaiIncrementalUpdate {
    param([Parameter(Mandatory)][string]$BaseZip, [Parameter(Mandatory)][string]$TargetZip,
        [Parameter(Mandatory)][string]$OutputZip, [Parameter(Mandatory)][string]$BaseVersion,
        [Parameter(Mandatory)][string]$TargetVersion)
    $BaseZip = [IO.Path]::GetFullPath($BaseZip); $TargetZip = [IO.Path]::GetFullPath($TargetZip); $OutputZip = [IO.Path]::GetFullPath($OutputZip)
    Assert-UpdatePlainPath $BaseZip; Assert-UpdatePlainPath $TargetZip; Assert-UpdatePlainPath $OutputZip
    if (Test-Path -LiteralPath $OutputZip) { throw 'Output already exists; refusing overwrite.' }
    $baseZipHash = Get-UpdateHash $BaseZip; $targetZipHash = Get-UpdateHash $TargetZip
    $work = Join-Path ([IO.Path]::GetTempPath()) ('laokuai-delta-build-' + [Guid]::NewGuid().ToString('N'))
    Assert-UpdatePlainPath $work; [void][IO.Directory]::CreateDirectory($work)
    $baseRoot = Join-Path $work 'base'; $targetRoot = Join-Path $work 'target'; $packageRoot = Join-Path $work 'package'
    foreach ($dir in @($baseRoot, $targetRoot, $packageRoot)) { [void][IO.Directory]::CreateDirectory($dir) }
    $baseArchive = [IO.Compression.ZipFile]::OpenRead($BaseZip); $targetArchive = [IO.Compression.ZipFile]::OpenRead($TargetZip)
    try {
        $baseIndex = Read-UpdateZipIndex $baseArchive -Program; $targetIndex = Read-UpdateZipIndex $targetArchive -Program
        if (!$baseIndex.ContainsKey('唠蒯云.exe') -or !$targetIndex.ContainsKey('唠蒯云.exe')) { throw 'Expected portable application executable.' }
        Expand-UpdateEntries $baseIndex $baseRoot; Expand-UpdateEntries $targetIndex $targetRoot
        $baseFiles = @(); $targetFiles = @(); $changes = @(); $id = 0
        foreach ($path in @($baseIndex.Keys | Sort-Object)) {
            $file = Get-UpdatePath $baseRoot $path
            $baseFiles += @{ path = $path; size = [long]$baseIndex[$path].Length; sha256 = Get-UpdateHash $file }
        }
        foreach ($path in @($targetIndex.Keys | Sort-Object)) {
            $file = Get-UpdatePath $targetRoot $path
            $record = @{ path = $path; size = [long]$targetIndex[$path].Length; sha256 = Get-UpdateHash $file }; $targetFiles += $record
            $old = @($baseFiles | Where-Object path -CEQ $path)
            if ($old.Count -eq 1 -and $old[0].sha256 -eq $record.sha256) { continue }
            $payload = 'payload/' + (++$id).ToString('D4') + '.bin'; $payloadFile = Get-UpdatePath $packageRoot $payload
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($payloadFile))
            $kind = 'replace'; $offsets = @()
            if ($old.Count -eq 1 -and $old[0].size -eq $record.size -and $record.size -ge 1MB -and $path -match '\.(exe|dll)$') {
                $offsets = @([LaokuaiBlockPatch]::Create((Get-UpdatePath $baseRoot $path), $file, $payloadFile))
                if ((Get-Item -LiteralPath $payloadFile).Length -lt $record.size / 2) { $kind = 'blocks' }
            }
            if ($kind -eq 'replace') { [IO.File]::Copy($file, $payloadFile, $true); $offsets = @() }
            $changes += @{ path = $path; kind = $kind; payload = $payload; payloadSize = (Get-Item -LiteralPath $payloadFile).Length; payloadSha256 = Get-UpdateHash $payloadFile; offsets = $offsets }
        }
        foreach ($path in $baseIndex.Keys) { if (!$targetIndex.ContainsKey($path)) { $changes += @{ path = $path; kind = 'delete' } } }
        $updaterFiles = @()
        foreach ($name in $script:UpdateToolNames) {
            $path = 'updater/' + $name; $file = Get-UpdatePath $packageRoot $path
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
            [IO.File]::Copy((Join-Path $PSScriptRoot $name), $file)
            $updaterFiles += @{ path = $path; size = (Get-Item -LiteralPath $file).Length; sha256 = Get-UpdateHash $file }
        }
        $manifest = @{ schema = 1; format = 'laokuai-fixed-blocks-v1'; blockSize = 65536; baseVersion = $BaseVersion; targetVersion = $TargetVersion; baseZipSha256 = $baseZipHash; targetZipSha256 = $targetZipHash; baseFiles = $baseFiles; targetFiles = $targetFiles; changes = $changes; updaterFiles = $updaterFiles }
        Write-UpdateJson (Join-Path $packageRoot 'update.json') $manifest
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputZip))
        $outArchive = [IO.Compression.ZipFile]::Open($OutputZip, [IO.Compression.ZipArchiveMode]::Create)
        try { foreach ($file in Get-ChildItem -LiteralPath $packageRoot -Recurse -File) { Add-UpdateZipFile $outArchive $file.FullName ([IO.Path]::GetRelativePath($packageRoot, $file.FullName).Replace('\','/')) } } finally { $outArchive.Dispose() }
        $receipt = @{ baseZipSha256 = $baseZipHash; targetZipSha256 = $targetZipHash; updateZipSha256 = Get-UpdateHash $OutputZip; updateZipBytes = (Get-Item -LiteralPath $OutputZip).Length; baselineFiles = $baseFiles.Count; targetFiles = $targetFiles.Count; changes = $changes }
        Write-UpdateJson ($OutputZip + '.receipt.json') $receipt
        return $receipt
    } catch { if (Test-Path -LiteralPath $OutputZip) { Remove-Item -LiteralPath $OutputZip }; throw }
    finally {
        $baseArchive.Dispose(); $targetArchive.Dispose()
        # The fixed, newly created absolute work directory is checked before deletion.
        Assert-UpdatePlainPath $work
        if ([IO.Path]::GetFileName($work) -notlike 'laokuai-delta-build-*' -or [IO.Path]::GetDirectoryName($work).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\')) { throw 'Build cleanup escaped temporary directory.' }
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}

function Invoke-LaokuaiIncrementalUpdate {
    param([Parameter(Mandatory)][string]$UpdateZip, [Parameter(Mandatory)][string]$InstallDirectory,
        [Parameter(Mandatory)][string]$ExpectedPackageSha256, [int]$TestFailAfterReplacement = 0)
    Assert-UpdateHash $ExpectedPackageSha256
    $UpdateZip = [IO.Path]::GetFullPath($UpdateZip); $InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\','/')
    Assert-UpdatePlainPath $UpdateZip; Assert-UpdatePlainPath $InstallDirectory
    if (!(Test-Path -LiteralPath $InstallDirectory -PathType Container)) { throw 'Installation directory does not exist.' }
    # Keep the verified archive open with write/delete excluded throughout use.
    $packageStream = [IO.File]::Open($UpdateZip, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $packageHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($packageStream)).ToLowerInvariant()
        if ($packageHash -ne $ExpectedPackageSha256) { throw 'Update ZIP checksum mismatch.' }
        $packageStream.Position = 0
    } catch { $packageStream.Dispose(); throw }
    $mutexId = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($InstallDirectory.ToLowerInvariant())))
    $mutex = [Threading.Mutex]::new($false, ('Local\LaokuaiUpdate-' + $mutexId)); $locked = $false
    $archive = $null; $work = $null; $report = $null; $committed = @(); $guards = @()
    try {
        try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (!$locked) { throw 'An update is already in progress.' }
        Assert-UpdateAppStopped $InstallDirectory
        $archive = [IO.Compression.ZipArchive]::new($packageStream, [IO.Compression.ZipArchiveMode]::Read, $true); $index = Read-UpdateZipIndex $archive
        if (!$index.ContainsKey('update.json') -or $index['update.json'].Length -gt 2MB) { throw 'Missing/oversized update manifest.' }
        $reader = [IO.StreamReader]::new($index['update.json'].Open(), [Text.Encoding]::UTF8)
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($manifest.schema -ne 1 -or $manifest.format -cne 'laokuai-fixed-blocks-v1' -or $manifest.blockSize -ne 65536) { throw 'Unsupported update format.' }
        Assert-UpdateHash $manifest.baseZipSha256; Assert-UpdateHash $manifest.targetZipSha256
        $sets = @{}
        foreach ($setName in @('baseFiles','targetFiles')) {
            $set = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase); [long]$total = 0
            foreach ($entry in $manifest.$setName) {
                Assert-UpdateProgramPath $entry.path; Assert-UpdateHash $entry.sha256
                if ($entry.size -isnot [long] -and $entry.size -isnot [int]) { throw 'Invalid file size type.' }
                if ($entry.size -lt 0 -or $entry.size -gt $script:UpdateMaxFile) { throw 'File size limit.' }
                $total += $entry.size; if ($total -gt $script:UpdateMaxTotal) { throw 'Target size limit.' }
                if (!$set.TryAdd($entry.path, $entry)) { throw 'Duplicate program manifest path.' }
            }
            if (!$set.ContainsKey('唠蒯云.exe') -or !$set.ContainsKey('resources/app.asar')) { throw 'Incomplete portable manifest.' }
            $sets[$setName] = $set
        }
        $base = $sets.baseFiles; $target = $sets.targetFiles
        $changes = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
        $payloads = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); [void]$payloads.Add('update.json')
        if (@($manifest.updaterFiles).Count -ne $script:UpdateToolNames.Count) { throw 'Incomplete updater files.' }
        foreach ($entry in $manifest.updaterFiles) {
            if ($entry.path -cnotin @($script:UpdateToolNames | ForEach-Object { 'updater/' + $_ }) -or !$payloads.Add($entry.path) -or !$index.ContainsKey($entry.path)) { throw 'Invalid/duplicate updater file.' }
            Assert-UpdateHash $entry.sha256
            if ($entry.size -ne $index[$entry.path].Length -or $entry.size -gt 2MB) { throw 'Invalid updater file size.' }
        }
        foreach ($change in $manifest.changes) {
            Assert-UpdateProgramPath $change.path
            if (!$changes.TryAdd($change.path, $change)) { throw 'Duplicate change path.' }
            if ($change.kind -ceq 'delete') {
                if (!$base.ContainsKey($change.path) -or $target.ContainsKey($change.path)) { throw 'Invalid deletion.' }; continue
            }
            if ($change.kind -cnotin @('replace','blocks') -or !$target.ContainsKey($change.path)) { throw 'Invalid change.' }
            if ($change.payload -cnotmatch '^payload/[0-9]{4}\.bin$' -or !$payloads.Add($change.payload) -or !$index.ContainsKey($change.payload)) { throw 'Invalid/duplicate payload.' }
            Assert-UpdateHash $change.payloadSha256
            if ($change.payloadSize -ne $index[$change.payload].Length) { throw 'Payload size mismatch.' }
            if ($change.kind -ceq 'blocks' -and (!$base.ContainsKey($change.path) -or $base[$change.path].size -ne $target[$change.path].size)) { throw 'Invalid block baseline.' }
        }
        foreach ($path in $index.Keys) { if (!$payloads.Contains($path)) { throw 'Undeclared archive file.' } }
        foreach ($path in $base.Keys) { if (!$target.ContainsKey($path) -and !$changes.ContainsKey($path)) { throw 'Undeclared deletion.' } }
        foreach ($path in $target.Keys) {
            $different = !$base.ContainsKey($path) -or $base[$path].sha256 -ne $target[$path].sha256 -or $base[$path].size -ne $target[$path].size
            if ($different -ne $changes.ContainsKey($path)) { throw 'Change set does not match the target manifest.' }
        }
        # Verify every baseline program file and keep write/delete-excluding handles
        # until staging is complete. User files are never enumerated or opened.
        foreach ($path in $base.Keys) {
            $file = Get-UpdatePath $InstallDirectory $path
            $guard = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            $guards += $guard
            if ($guard.Length -ne $base[$path].size -or (Get-UpdateHash $file) -ne $base[$path].sha256) { throw "Baseline mismatch: $path" }
        }
        foreach ($path in $target.Keys) {
            $file = Get-UpdatePath $InstallDirectory $path
            if (!$base.ContainsKey($path) -and (Test-Path -LiteralPath $file)) { throw "Addition would overwrite an unknown file: $path" }
        }
        $work = Join-Path ([IO.Path]::GetDirectoryName($InstallDirectory)) ('.laokuai-update-' + [Guid]::NewGuid().ToString('N'))
        Assert-UpdatePlainPath $work; [void][IO.Directory]::CreateDirectory($work)
        $stage = Join-Path $work 'stage'; $backup = Join-Path $work 'backup'; $payloadRoot = Join-Path $work 'payloads'
        foreach ($dir in @($stage,$backup,$payloadRoot)) { [void][IO.Directory]::CreateDirectory($dir) }
        $report = @{ schema = 1; status = 'staging'; baseVersion = $manifest.baseVersion; targetVersion = $manifest.targetVersion; updateZipSha256 = $ExpectedPackageSha256; targetZipSha256 = $manifest.targetZipSha256; targetFiles = @($manifest.targetFiles); changedFiles = @($manifest.changes | ForEach-Object path); backupDirectory = $backup; userFiles = 'not enumerated or modified'; failure = $null }
        Write-UpdateJson (Join-Path $work 'report.json') $report
        Expand-UpdateEntries $index $payloadRoot
        foreach ($entry in $manifest.updaterFiles) { if ((Get-UpdateHash (Get-UpdatePath $payloadRoot $entry.path)) -ne $entry.sha256) { throw 'Updater file hash mismatch.' } }
        foreach ($change in $manifest.changes) { if ($change.kind -cne 'delete' -and (Get-UpdateHash (Get-UpdatePath $payloadRoot $change.payload)) -ne $change.payloadSha256) { throw 'Payload hash mismatch.' } }
        foreach ($path in $target.Keys) {
            $staged = Get-UpdatePath $stage $path; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($staged))
            if (!$changes.ContainsKey($path) -or $changes[$path].kind -ceq 'blocks') { [IO.File]::Copy((Get-UpdatePath $InstallDirectory $path), $staged) }
            if ($changes.ContainsKey($path)) {
                $change = $changes[$path]; $payload = Get-UpdatePath $payloadRoot $change.payload
                if ($change.kind -ceq 'replace') { [IO.File]::Copy($payload, $staged) }
                elseif ($change.kind -ceq 'blocks') { [LaokuaiBlockPatch]::Apply($staged, $payload, [long[]]$change.offsets) }
            }
            if ((Get-Item -LiteralPath $staged).Length -ne $target[$path].size -or (Get-UpdateHash $staged) -ne $target[$path].sha256) { throw "Staged target mismatch: $path" }
        }
        Assert-UpdateAppStopped $InstallDirectory
        foreach ($guard in $guards) { $guard.Dispose() }; $guards = @()
        $report.status = 'replacing'; Write-UpdateJson (Join-Path $work 'report.json') $report
        foreach ($change in $manifest.changes) {
            Assert-UpdateAppStopped $InstallDirectory
            $file = Get-UpdatePath $InstallDirectory $change.path; $saved = Get-UpdatePath $backup $change.path
            if ($base.ContainsKey($change.path)) {
                if ((Get-UpdateHash $file) -ne $base[$change.path].sha256) { throw 'Baseline changed during update.' }
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($saved)); [IO.File]::Move($file, $saved)
            } elseif (Test-Path -LiteralPath $file) { throw 'Unknown file appeared during update.' }
            # Journal the successful backup before the next operation can fail.
            $committed += $change; Write-UpdateJson (Join-Path $work 'journal.json') @($committed | ForEach-Object path)
            if ($change.kind -cne 'delete') { [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)); [IO.File]::Move((Get-UpdatePath $stage $change.path), $file) }
            if ($TestFailAfterReplacement -gt 0 -and $committed.Count -ge $TestFailAfterReplacement) { throw 'Injected test replacement failure.' }
        }
        foreach ($path in $target.Keys) { $file = Get-UpdatePath $InstallDirectory $path; if ((Get-Item -LiteralPath $file).Length -ne $target[$path].size -or (Get-UpdateHash $file) -ne $target[$path].sha256) { throw "Installed target mismatch: $path" } }
        foreach ($path in $base.Keys) { if (!$target.ContainsKey($path) -and (Test-Path -LiteralPath (Get-UpdatePath $InstallDirectory $path))) { throw 'Deleted program file still present.' } }
        $report.status = 'complete'; Write-UpdateJson (Join-Path $work 'report.json') $report
        return @{ status = 'complete'; targetVersion = $manifest.targetVersion; targetFiles = $target.Count; reportPath = (Join-Path $work 'report.json'); backupDirectory = $backup }
    } catch {
        $originalFailure = $_
        foreach ($guard in $guards) { $guard.Dispose() }; $guards = @()
        $rollbackFailures = @()
        for ($i = $committed.Count - 1; $i -ge 0; $i--) {
            $change = $committed[$i]
            try {
                $file = Get-UpdatePath $InstallDirectory $change.path; $saved = Get-UpdatePath $backup $change.path
                if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
                if ($base.ContainsKey($change.path)) { [IO.File]::Move($saved, $file); if ((Get-UpdateHash $file) -ne $base[$change.path].sha256) { throw 'Restored hash mismatch.' } }
            } catch { $rollbackFailures += "$($change.path): $($_.Exception.Message)" }
        }
        if ($committed.Count -gt 0 -and !$rollbackFailures.Count) {
            try {
                foreach ($path in $base.Keys) {
                    $restored = Get-UpdatePath $InstallDirectory $path
                    if ((Get-Item -LiteralPath $restored).Length -ne $base[$path].size -or (Get-UpdateHash $restored) -ne $base[$path].sha256) { throw "Restored complete baseline mismatch: $path" }
                }
            } catch { $rollbackFailures += $_.Exception.Message }
        }
        if ($report) {
            $report.status = if ($rollbackFailures.Count) { 'rollback-failed' } elseif ($committed.Count) { 'rolled-back' } else { 'rejected' }
            $report.failure = $originalFailure.Exception.Message; $report.rollbackFailures = $rollbackFailures
            Write-UpdateJson (Join-Path $work 'report.json') $report
        }
        if ($rollbackFailures.Count) { throw "Update failed; rollback needs manual recovery from $work. $($rollbackFailures -join '; ')" }
        if ($work) { throw "Update rejected/rolled back: $($originalFailure.Exception.Message). Report: $(Join-Path $work 'report.json')" }
        throw $originalFailure
    } finally { foreach ($guard in $guards) { $guard.Dispose() }; if ($archive) { $archive.Dispose() }; $packageStream.Dispose(); if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}

#requires -Version 7.0
param([Parameter(Mandatory)][string]$Helper)
$ErrorActionPreference = 'Stop'
$key = '0123456789abcdef' * 4 # Synthetic fixture; never a real experimental key.
$prefix = "LAOKUAI_NATIVE_AUDIO_V1`n10.203.217.20`n39177`n10.203.217.21:39177`n$key`nduplex`n-1`n-1`n"
# No case contains the start command. This exercises the actual stdin process
# boundary without reaching Winsock initialization or PortAudio initialization.
$cases = @('', 'not-a-protocol', $prefix, ($prefix + "stop`n"))
foreach ($inputText in $cases) {
    $info = [Diagnostics.ProcessStartInfo]::new([IO.Path]::GetFullPath($Helper), '--stdio')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $child = [Diagnostics.Process]::new()
    $child.StartInfo = $info
    try {
        if (!$child.Start()) { throw 'Could not start helper stdin test' }
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        $child.StandardInput.Write($inputText)
        $child.StandardInput.Close()
        if (!$child.WaitForExit(3000)) { $child.Kill(); throw 'Helper did not reject incomplete configuration within deadline' }
        $out = $stdout.GetAwaiter().GetResult()
        $err = $stderr.GetAwaiter().GetResult()
        if ($child.ExitCode -ne 2 -or $out.Trim() -ne '{"event":"error","code":"invalid-config"}' -or $err.Contains($key) -or $out.Contains($key)) {
            throw 'Helper startup rejection or secret redaction failed'
        }
    } finally { $child.Dispose() }
}
Write-Output '{"stdioRejectionChecks":4,"passed":true,"startCommandSent":false}'

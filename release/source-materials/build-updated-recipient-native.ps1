[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RestoredDirectory,
    [Parameter(Mandatory)][string]$SourceUpdateManifest,
    [Parameter(Mandatory)][string]$ProtocExecutable,
    [string]$NodeExecutable = 'node'
)
# Rebuild recipe only. Run solely in an explicitly scheduled native build slot.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required' }
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$restoreRoot = (Resolve-Path -LiteralPath $RestoredDirectory).Path
$sourceRoot = Join-Path $restoreRoot 'source'
& $NodeExecutable (Join-Path $PSScriptRoot 'apply-native-source-update.cjs') $restoreRoot --check $SourceUpdateManifest
if ($LASTEXITCODE -ne 0) { throw 'Updated recipient exact source/lock verification failed' }
if ($env:LIB -match '(?i)VC[-_ ]?LTL|YY[-_ ]?Thunks') { throw 'Compatibility LIB path in toolchain' }
foreach ($name in @('CARGO_ENCODED_RUSTFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS','CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER','CL','_CL_','LINK','_LINK_','VC_LTL','YY_THUNKS')) { Remove-Item -LiteralPath ('Env:'+ $name) -ErrorAction SilentlyContinue }
$env:CARGO_HOME = Join-Path $restoreRoot 'cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $restoreRoot 'recipient-build-target'
$env:CARGO_NET_OFFLINE = 'true'
$env:RUSTUP_AUTO_INSTALL = '0'
$env:PROTOC = (Resolve-Path -LiteralPath $ProtocExecutable).Path
if ((Get-FileHash -LiteralPath $env:PROTOC -Algorithm SHA256).Hash.ToLowerInvariant() -ne '9a4fe52db00facbf858dc5af9addb50b551429004044e8a24f137de38c5b209f') { throw 'Use the pinned protoc36 executable; see actual tool receipt' }
$env:CARGO_BUILD_JOBS = '1'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '1'
$env:NUM_JOBS = '1'
$env:RUSTFLAGS = '-C target-feature=+crt-static'
$features = 'cli,wireguard,websocket,smoltcp,tun,socks5,kcp,quic,magic-dns,zstd,upnp,icmp-proxy,management,endpoint-discovery,extended-services,linux-netlink,tcp-hole-punch'
Push-Location -LiteralPath $sourceRoot
try {
    foreach ($name in @('thunk-rs','service-manager')) {
        $proof = @(& cargo +1.95.0 tree --locked --offline -p easytier --target x86_64-pc-windows-msvc --no-default-features --features $features --edges normal,build --prefix none --invert $name --format '{p} features=[{f}]')
        if ($LASTEXITCODE -ne 0 -or $proof[0] -notmatch 'features=\[\]$') { throw 'Unexpected compatibility or encoding features' }
        $proof | Set-Content -LiteralPath (Join-Path $restoreRoot "$name-updated-recipient-features.txt") -Encoding utf8NoBOM
    }
    & cargo +1.95.0 build --locked --offline --release -p easytier --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc --no-default-features --features $features -j 1
    if ($LASTEXITCODE -ne 0) { throw "Updated recipient build failed: $LASTEXITCODE" }
} finally { Pop-Location }

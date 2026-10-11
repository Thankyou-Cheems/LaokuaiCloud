param(
    [Parameter(Mandatory=$true)][string]$RestoredDirectory,
    [Parameter(Mandatory=$true)][string]$VcLtlDirectory,
    [Parameter(Mandatory=$true)][string]$YyThunksDirectory,
    [Parameter(Mandatory=$true)][string]$ProtocExecutable
)
# Prepared command only. Execute solely as a parent-coordinated heavy build
# from a Visual Studio 2022 x64 developer shell. No product is launched here.
$ErrorActionPreference = 'Stop'
$restoreRoot = (Resolve-Path -LiteralPath $RestoredDirectory).Path
$sourceRoot = Join-Path $restoreRoot 'source'
$env:CARGO_HOME = Join-Path $restoreRoot 'cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $restoreRoot 'build-target'
$env:CARGO_NET_OFFLINE = 'true'
$env:RUSTUP_AUTO_INSTALL = '0'
$env:VC_LTL = (Resolve-Path -LiteralPath $VcLtlDirectory).Path
$env:YY_THUNKS = (Resolve-Path -LiteralPath $YyThunksDirectory).Path
$env:PROTOC = (Resolve-Path -LiteralPath $ProtocExecutable).Path
if (!(Test-Path -LiteralPath (Join-Path $env:VC_LTL 'TargetPlatform/6.0.6000.0/lib/x64'))) { throw 'Wrong VC-LTL extracted directory' }
if (!(Test-Path -LiteralPath (Join-Path $env:YY_THUNKS 'objs/x64/YY_Thunks_for_Win7.obj'))) { throw 'Wrong YY-Thunks extracted directory' }
$env:CARGO_BUILD_JOBS = '1'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '1'
$env:NUM_JOBS = '1'
$env:RUSTFLAGS = '-C target-feature=+crt-static'
$nativeFeatures = 'cli,wireguard,websocket,smoltcp,tun,socks5,kcp,quic,magic-dns,zstd,upnp,icmp-proxy,management,endpoint-discovery,extended-services,linux-netlink,tcp-hole-punch'
Push-Location -LiteralPath $sourceRoot
try {
    & cargo +1.95.0 build --locked --offline --release -p easytier --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc --no-default-features --features $nativeFeatures -j 1
    if ($LASTEXITCODE -ne 0) { throw "Native build failed: $LASTEXITCODE" }
} finally { Pop-Location }

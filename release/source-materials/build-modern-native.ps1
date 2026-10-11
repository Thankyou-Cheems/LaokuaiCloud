param(
    [Parameter(Mandatory=$true)][string]$RestoredDirectory,
    [Parameter(Mandatory=$true)][string]$ProtocExecutable
)
# Prepared command only. Execute solely as a parent-coordinated heavy build
# from a Visual Studio 2022 x64 developer shell. No product is launched here.
$ErrorActionPreference = 'Stop'
$restoreRoot = (Resolve-Path -LiteralPath $RestoredDirectory).Path
$sourceRoot = Join-Path $restoreRoot 'source'
$receipt = Get-Content -LiteralPath (Join-Path $restoreRoot 'NEXT-SOURCE-RESTORATION-RECEIPT.json') -Raw | ConvertFrom-Json
if ($receipt.sourceCommit -ne '089b6182c603c8ab60044b673effe0cf614cc28a' -or $receipt.windowsNormalBuildPackages -ne 504 -or !$receipt.lockUnchanged -or !$receipt.crtStatic -or @($receipt.thunkFeatures).Count -ne 0) { throw 'Unverified modern source restoration' }
if ((Get-FileHash -LiteralPath (Join-Path $sourceRoot 'easytier/Cargo.toml') -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4bd7cccf1477b8a82c8f374a23502853dc22c166ff630cee890dd27d4413a7a6') { throw 'Modern Cargo source differs' }
if ((Get-FileHash -LiteralPath (Join-Path $sourceRoot 'Cargo.lock') -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2') { throw 'Lock differs' }
& node (Join-Path $PSScriptRoot 'verify-modern-restored-source.cjs') $restoreRoot
if ($LASTEXITCODE -ne 0) { throw 'Modern source byte verification failed' }
if ($env:LIB -match '(?i)VC[-_ ]?LTL|YY[-_ ]?Thunks') { throw 'Compatibility library path in toolchain LIB' }
$env:CARGO_ENCODED_RUSTFLAGS = $null
$env:RUSTC_WRAPPER = $null
$env:RUSTC_WORKSPACE_WRAPPER = $null
$env:CL = $null
$env:_CL_ = $null
$env:LINK = $null
$env:_LINK_ = $null
$env:VC_LTL = $null
$env:YY_THUNKS = $null
$env:CARGO_HOME = Join-Path $restoreRoot 'cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $restoreRoot 'build-target'
if (Test-Path -LiteralPath $env:CARGO_TARGET_DIR) { throw 'Use a fresh modern target; preserve old/partial build outputs' }
$env:CARGO_NET_OFFLINE = 'true'
$env:RUSTUP_AUTO_INSTALL = '0'
$env:PROTOC = (Resolve-Path -LiteralPath $ProtocExecutable).Path
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

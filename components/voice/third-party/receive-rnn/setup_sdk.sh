#!/usr/bin/env bash
# Directory-local official Emscripten, no system packages or shell profile edits.
set -euo pipefail
cd "$(dirname "$0")"
sha256sum -c source-archive-sha256.txt
if [[ ! -f emsdk-4.0.20.tar.gz ]]; then
 curl -fL https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.20.tar.gz -o emsdk-4.0.20.tar.gz
fi
echo '2a8a70eb1c0a47883272a001feb4c7209db6e9bcc36774dd9770050e7ac64fa0  emsdk-4.0.20.tar.gz' | sha256sum -c -
[[ -d emsdk-4.0.20 ]] || tar -xzf emsdk-4.0.20.tar.gz
(cd emsdk-4.0.20 && EMSDK_KEEP_DOWNLOADS=1 python3 emsdk.py install 4.0.20)
sha256sum -c sdk-download-sha256.txt
(cd emsdk-4.0.20 && python3 emsdk.py activate 4.0.20)
[[ -d webrtc-audio-processing-2.1 ]] || tar -xJf webrtc-audio-processing-2.1.tar.xz
[[ -d abseil-cpp-20240722.1 ]] || tar -xzf abseil-cpp-20240722.1.tar.gz

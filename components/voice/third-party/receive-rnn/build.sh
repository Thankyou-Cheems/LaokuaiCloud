#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
SDK="${EMSDK_DIR:-$PWD/emsdk-4.0.20}"
export EM_CONFIG="$SDK/.emscripten"
export EM_CACHE="$SDK/upstream/emscripten/cache"
CXX="$SDK/upstream/emscripten/em++"
CC="$SDK/upstream/emscripten/emcc"
W="$PWD/webrtc-audio-processing-2.1/webrtc"
A="$PWD/abseil-cpp-20240722.1"
B="${BUILD_DIR:-build}"
mkdir -p "$B" dist results
FLAGS=(-std=c++17 -O2 -ffp-contract=off -ffunction-sections -fdata-sections -DWEBRTC_POSIX -DWEBRTC_APM_DEBUG_DUMP=0 -DRTC_DISABLE_LOGGING -DPFFFT_SIMD_DISABLE -I"$W" -I"$A")
SOURCES=(
 modules/audio_processing/agc2/rnn_vad/auto_correlation.cc
 modules/audio_processing/agc2/rnn_vad/features_extraction.cc
 modules/audio_processing/agc2/rnn_vad/lp_residual.cc
 modules/audio_processing/agc2/rnn_vad/pitch_search.cc
 modules/audio_processing/agc2/rnn_vad/pitch_search_internal.cc
 modules/audio_processing/agc2/rnn_vad/rnn.cc
 modules/audio_processing/agc2/rnn_vad/rnn_fc.cc
 modules/audio_processing/agc2/rnn_vad/rnn_gru.cc
 modules/audio_processing/agc2/rnn_vad/spectral_features.cc
 modules/audio_processing/agc2/rnn_vad/spectral_features_internal.cc
 modules/audio_processing/agc2/cpu_features.cc
 modules/audio_processing/agc2/biquad_filter.cc
 modules/audio_processing/agc2/noise_level_estimator.cc
 modules/audio_processing/agc2/speech_level_estimator.cc
 modules/audio_processing/agc2/vad_wrapper.cc
 modules/audio_processing/utility/pffft_wrapper.cc
 modules/audio_processing/logging/apm_data_dumper.cc
 common_audio/resampler/push_resampler.cc
 common_audio/resampler/push_sinc_resampler.cc
 common_audio/resampler/sinc_resampler.cc
 common_audio/audio_util.cc
 rtc_base/checks.cc
 rtc_base/memory/aligned_malloc.cc
 rtc_base/strings/string_builder.cc
 system_wrappers/source/cpu_features.cc
 third_party/rnnoise/src/rnn_vad_weights.cc
)
OBJECTS=()
for src in "${SOURCES[@]}"; do
 obj="$B/${src//\//_}.o"; OBJECTS+=("$obj")
 echo "Compile $src"
 "$CXX" "${FLAGS[@]}" -c "$W/$src" -o "$obj"
done
"$CC" -std=c11 -D_GNU_SOURCE -O2 -ffp-contract=off -DPFFFT_SIMD_DISABLE -I"$W" -c "$W/third_party/pffft/src/pffft.c" -o "$B/pffft.o"
"$CXX" "${FLAGS[@]}" src/analyzer.cc src/allocation_audit.cc "${OBJECTS[@]}" "$B/pffft.o" \
 --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 \
 -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=262144 -sASSERTIONS=1 -sMALLOC=emmalloc \
 -sEXPORTED_FUNCTIONS='["_gryt_create","_gryt_reset","_gryt_destroy","_gryt_input","_gryt_output","_gryt_frame_size","_gryt_process10ms","_gryt_allocation_calls","_gryt_free_calls","_gryt_live_states","_gryt_heap_used"]' \
 -Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=free \
 -Wl,--gc-sections -o dist/gryt-rnn.wasm
"$CXX" --version > results/compiler.txt
sha256sum dist/gryt-rnn.wasm

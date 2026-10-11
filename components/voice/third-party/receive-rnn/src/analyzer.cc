// SPDX-License-Identifier: BSD-3-Clause
// Adapter only. DSP sources, weights and checks are unchanged upstream files.
#include "analyzer.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include "common_audio/include/audio_util.h"
#include "common_audio/resampler/push_sinc_resampler.h"
#include "modules/audio_processing/agc2/agc2_common.h"
#include "modules/audio_processing/agc2/cpu_features.h"
#include "modules/audio_processing/agc2/noise_level_estimator.h"
#include "modules/audio_processing/agc2/rnn_vad/features_extraction.h"
#include "modules/audio_processing/agc2/rnn_vad/rnn.h"
#include "modules/audio_processing/agc2/speech_level_estimator.h"
#include "modules/audio_processing/agc2/vad_wrapper.h"
#include "modules/audio_processing/logging/apm_data_dumper.h"
static_assert(sizeof(float)==4 && sizeof(GrytResult)==32);
static_assert(RTC_DCHECK_IS_ON, "Keep genuine upstream numeric checks enabled");
namespace {
auto Config() {
  webrtc::AudioProcessing::Config::GainController2::AdaptiveDigital c;
  c.enabled=true; return c;
}
struct State {
  const int rate, mode, frame_size;
  webrtc::ApmDataDumper dumper{0};
  std::unique_ptr<webrtc::VoiceActivityDetectorWrapper> vad;
  std::unique_ptr<webrtc::PushSincResampler> resampler;
  std::unique_ptr<webrtc::rnn_vad::FeaturesExtractor> features;
  std::unique_ptr<webrtc::rnn_vad::RnnVad> rnn;
  std::unique_ptr<webrtc::NoiseLevelEstimator> noise;
  webrtc::SpeechLevelEstimator speech;
  std::array<float,480> input{};
  std::array<float,240> resampled{};
  std::array<float,webrtc::rnn_vad::kFeatureVectorSize> feature{};
  GrytResult output{};
  uint32_t frame=0;
  State(int r,int m):rate(r),mode(m),frame_size(r/100),
    noise(webrtc::CreateNoiseFloorEstimator(&dumper)),
    speech(&dumper,Config(),webrtc::kAdjacentSpeechFramesThreshold) {
    const auto cpu=webrtc::NoAvailableCpuFeatures();
    if(mode==0) vad=std::make_unique<webrtc::VoiceActivityDetectorWrapper>(cpu,rate);
    else {
      resampler=std::make_unique<webrtc::PushSincResampler>(frame_size,240);
      features=std::make_unique<webrtc::rnn_vad::FeaturesExtractor>(cpu);
      rnn=std::make_unique<webrtc::rnn_vad::RnnVad>(cpu);
    }
  }
};
struct Slot { uint32_t generation=1; std::unique_ptr<State> state; };
std::array<Slot,32> slots;
State* Find(uint32_t h) {
  const uint32_t idx=h&63, generation=h>>6;
  if(idx==0 || idx>slots.size() || !generation) return nullptr;
  Slot& s=slots[idx-1];
  return s.generation==generation ? s.state.get():nullptr;
}
}
extern "C" {
uint32_t gryt_create(int rate,int mode) {
  if(rate<8000 || rate>48000 || rate%100 || (mode!=0 && mode!=1)) return 0;
  for(uint32_t i=0;i<slots.size();++i) if(!slots[i].state && slots[i].generation) {
    slots[i].state=std::make_unique<State>(rate,mode);
    return slots[i].generation*64+i+1;
  }
  return 0;
}
int gryt_reset(uint32_t h) {
  State* s=Find(h); if(!s) return -1;
  auto replacement=std::make_unique<State>(s->rate,s->mode);
  slots[(h&63)-1].state=std::move(replacement); return 0;
}
int gryt_destroy(uint32_t h) {
  if(!Find(h)) return -1;
  Slot& s=slots[(h&63)-1]; s.state.reset();
  // Never reuse a generation on wraparound: retire this slot for module life.
  s.generation++; if(s.generation>0x3ffffff) s.generation=0;
  return 0;
}
float* gryt_input(uint32_t h) { State* s=Find(h);return s?s->input.data():nullptr; }
GrytResult* gryt_output(uint32_t h) { State* s=Find(h);return s?&s->output:nullptr; }
int gryt_frame_size(uint32_t h) {State* s=Find(h);return s?s->frame_size:0;}
int gryt_process10ms(uint32_t h,int n) {
  State* s=Find(h); if(!s) return -1;
  if(n!=s->frame_size) return -2;
  float energy=0,peak=0;
  for(int i=0;i<n;++i) {
    float x=s->input[i];
    if(!std::isfinite(x)||x < -32768.f || x > 32767.f) return -3;
    energy+=x*x; peak=std::max(peak,std::abs(x));
  }
  webrtc::DeinterleavedView<const float> view(s->input.data(),n,1);
  float p;
  if(s->mode==0) p=s->vad->Analyze(view);
  else {
    s->resampler->Resample(s->input.data(),n,s->resampled.data(),240);
    const bool silence=s->features->CheckSilenceComputeFeatures(s->resampled,s->feature);
    p=s->rnn->ComputeVadProbability(s->feature,silence);
  }
  float rms=webrtc::FloatS16ToDbfs(std::sqrt(energy/n));
  float peak_dbfs=webrtc::FloatS16ToDbfs(peak);
  s->speech.Update(rms,peak_dbfs,p);
  s->output={p,rms,peak_dbfs,s->speech.level_dbfs(),s->noise->Analyze(view),
             uint32_t(s->speech.is_confident()),s->frame++,0};
  return 0;
}
uint32_t gryt_live_states(){uint32_t n=0;for(auto& s:slots)n+=bool(s.state);return n;}
}

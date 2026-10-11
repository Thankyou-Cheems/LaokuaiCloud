// SPDX-License-Identifier: BSD-3-Clause
#ifndef GRYT_ANALYZER_H
#define GRYT_ANALYZER_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// A single-threaded module owns up to 32 independent speakers. Handles include
// a generation; destroyed handles are rejected. 0 always means invalid.
// All creation/reset/destruction must happen off the real-time process path.
// rate: integral Hz, 8000..48000 divisible by 100. mode: 0 production, 1 golden.
uint32_t gryt_create(int sample_rate, int mode);
int gryt_reset(uint32_t handle);
int gryt_destroy(uint32_t handle);
// 32-byte ABI, FloatS16 input range [-32768,32767], exactly rate/100 samples.
// confidence is confidence in historical speech level, NOT current activity.
typedef struct {
  float speech_probability, rms_dbfs, peak_dbfs, speech_level_dbfs, noise_dbfs;
  uint32_t speech_level_confident, frame_index, reserved;
} GrytResult;
float* gryt_input(uint32_t handle);
GrytResult* gryt_output(uint32_t handle);
int gryt_frame_size(uint32_t handle);
// Returns 0 success, -1 invalid handle, -2 length, -3 nonfinite/range.
// Invalid input leaves state and prior output unchanged.
int gryt_process10ms(uint32_t handle, int sample_count);
uint32_t gryt_allocation_calls(void);
uint32_t gryt_free_calls(void);
uint32_t gryt_live_states(void);
// Slow diagnostic: heap payload plus allocator overhead. Never call in process.
uint32_t gryt_heap_used(void);
#ifdef __cplusplus
}
#endif
#endif

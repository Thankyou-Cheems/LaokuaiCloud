// SPDX-License-Identifier: BSD-3-Clause
#include <stddef.h>
#include <stdint.h>
#include <emscripten/emmalloc.h>
// Linker wrappers measure calls made anywhere in linked DSP/C++ allocation.
// Counters are diagnostics, not a substitute for browser GC/scheduling tests.
static uint32_t allocations=0, frees=0;
extern "C" {
void* __real_malloc(size_t);
void* __real_calloc(size_t,size_t);
void* __real_realloc(void*,size_t);
void __real_free(void*);
void* __wrap_malloc(size_t n){++allocations;return __real_malloc(n);}
void* __wrap_calloc(size_t n,size_t s){++allocations;return __real_calloc(n,s);}
void* __wrap_realloc(void* p,size_t n){++allocations;return __real_realloc(p,n);}
void __wrap_free(void* p){++frees;__real_free(p);}
uint32_t gryt_allocation_calls(){return allocations;}
uint32_t gryt_free_calls(){return frees;}
uint32_t gryt_heap_used(){return emmalloc_dynamic_heap_size()-emmalloc_free_dynamic_memory();}
}

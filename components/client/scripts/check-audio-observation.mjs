import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync('src/packages/settings/src/components/audioObservation.ts', 'utf8');
const { readAnalyserDbfs, hasLiveAudioInput } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const analyser = values => ({ fftSize: values.length, getFloatTimeDomainData(out) { out.set(values); } });
assert.equal(readAnalyserDbfs(undefined), null);
assert.equal(readAnalyserDbfs(analyser([0, 0])), null);
assert.equal(readAnalyserDbfs(analyser([NaN, 1])), null);
assert.ok(Math.abs(readAnalyserDbfs(analyser([.1, -.1])) + 20) < .001);
assert.ok(Math.abs(readAnalyserDbfs(analyser([.01, -.01])) + 40) < .001);
assert.ok(readAnalyserDbfs(analyser([2, -2])) > 0, 'overload must remain observable');
const live = { readyState: 'live', enabled: true, muted: false };
const stream = track => ({ getAudioTracks: () => [track] });
assert.equal(hasLiveAudioInput({ state: 'running' }, stream(live)), true);
for (const state of ['suspended', 'closed']) assert.equal(hasLiveAudioInput({ state }, stream(live)), false);
assert.equal(hasLiveAudioInput({ state: 'running' }, undefined), false);
for (const track of [{ ...live, readyState: 'ended' }, { ...live, enabled: false }, { ...live, muted: true }]) {
  assert.equal(hasLiveAudioInput({ state: 'running' }, stream(track)), false);
}
console.log('Audio observations: PCM RMS, overload, zero/invalid input, absent/ended/disabled/muted input and suspended context passed.');

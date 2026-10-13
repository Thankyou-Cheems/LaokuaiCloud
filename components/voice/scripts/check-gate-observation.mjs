import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const load = source => import('data:text/javascript;base64,' + Buffer.from(compile(source)).toString('base64'));
const { TRANSMIT_SPEECH_CORE_CODE } = await load(readFileSync('src/audio/processors/transmitSpeechCode.ts', 'utf8'));
const source = readFileSync('src/audio/processors/noiseGateProcessor.ts', 'utf8').replace(/^import[^\n]*\n/, 'const TRANSMIT_SPEECH_CORE_CODE=' + JSON.stringify(TRANSMIT_SPEECH_CORE_CODE) + ';\n');
const { NOISE_GATE_WORKLET_CODE } = await load(source);
let Gate;
vm.runInNewContext(NOISE_GATE_WORKLET_CODE, { Float32Array, Math, Number, sampleRate: 48000, currentTime: 0,
  AudioWorkletProcessor: class { constructor() { this.port = { sent: [], postMessage(value) { this.sent.push(value); } }; } },
  registerProcessor: (_, type) => { Gate = type; } });
const gate = new Gate({});
const parameters = { threshold: [40], release: [300], smoothing: [.8], automatic: [1], eligible: [1], evidenceEnabled: [1] };
let sequence = 0;
const run = (probability, rmsDbfs, valid = true) => {
  for (let block = 0; block < 8; block++) {
    const evidence = [probability, rmsDbfs, valid ? 1 : 0, ++sequence].map(value => new Float32Array(128).fill(value));
    gate.process([[new Float32Array(128).fill(.1)], [new Float32Array(128).fill(.2)], evidence],
      [[new Float32Array(128)], [new Float32Array(128), new Float32Array(128)]], parameters);
  }
  return gate.port.sent.filter(value => value.type === 'automatic-gate').at(-1);
};
let state = run(.01, -60);
assert.equal(state.rmsDbfs, -60, 'automatic observation must use model evidence, not the raw manual detector');
assert.equal(state.openThresholdDbfs, null, 'unlearnt threshold remains unknown');
state = run(.01, -60);
assert.equal(state.openThresholdDbfs, -50);
assert.equal(state.holdThresholdDbfs, -54);
state = run(.99, -85);
assert.equal(state.open, true, 'strong speech can bypass the SNR threshold');
assert.equal(state.rmsDbfs, -85, 'quiet speech is not clamped to the manual meter range');
state = run(0, -120);
assert.equal(state.rmsDbfs, null, 'all-zero evidence must not invent a measured floor');
assert.equal(state.probability, null);
state = run(.9, -20, false);
assert.equal(state.rmsDbfs, null, 'invalid evidence must not reuse the last sample');
assert.equal(state.open, false, 'invalid current frame is not an open gate observation');
console.log('Gate observation: model sampling point, calibration, strong speech, zero and invalid evidence passed.');

import assert from "node:assert/strict";
import { sharedVoicePreset, readVoiceTransportPreset, migrateVoiceTransportPreset, boundedVoiceBitrate } from "../src/lib/voiceTransportPreset.ts";

const base = sharedVoicePreset();
assert.equal(base.maxBitrateBps, 24_000); assert.equal(base.packetTimeMs, 20);
assert.equal(base.channels, 1); assert.equal(base.variableBitrate, true);
assert.equal(base.requestDtx, true); assert.equal(base.requestInbandFec, true);
assert.deepEqual(migrateVoiceTransportPreset(undefined, true), {preset: base, needsPersist: true, legacyEsportsRetained: true, reviewLegacyBandwidth: true});
assert.equal(migrateVoiceTransportPreset(undefined, false).reviewLegacyBandwidth, false);
const custom = {...base, selection: "custom", maxBitrateBps: 32_000, packetTimeMs: 40, requestDtx: false};
assert.deepEqual(migrateVoiceTransportPreset(custom, true).preset, custom);
assert.equal(migrateVoiceTransportPreset(custom, true).needsPersist, false);
for(const value of [null,[],"128000",{...custom,schemaVersion:2},{...custom,maxBitrateBps:NaN},{...custom,maxBitrateBps:Infinity},{...custom,maxBitrateBps:510_000},{...custom,maxBitrateBps:0},{...custom,packetTimeMs:5},{...custom,channels:2},{...custom,requestDtx:1}]){
 assert.equal(readVoiceTransportPreset(value), undefined);
 assert.deepEqual(migrateVoiceTransportPreset(value,true).preset, base);
}
assert.deepEqual(readVoiceTransportPreset({...base,maxBitrateBps:128_000,packetTimeMs:10}),base);
assert.equal(boundedVoiceBitrate(base,128_000),24_000);
assert.equal(boundedVoiceBitrate(base,16_000),16_000);
for(const value of [undefined,null,0,-1,NaN,Infinity,"128000"])assert.equal(boundedVoiceBitrate(base,value),24_000);
const copy=readVoiceTransportPreset(custom);copy.maxBitrateBps=48_000;
assert.equal(custom.maxBitrateBps,32_000);
console.log("Voice transport intent/migration checks passed; no encoder or storage writes exercised");

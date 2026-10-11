import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVoiceQualityReport, VoiceQualityStore } from "./voiceQuality";

test("a local-to-SFU summary preserves unknown directions without inventing quality", () => {
  assert.deepEqual(parseVoiceQualityReport({
    schemaVersion: 1, connectionGeneration: 1, seq: 1,
    iceRttMs: 123, uplink: null, receive: null,
  }), {
    schemaVersion: 1, connectionGeneration: 1, seq: 1,
    iceRttMs: 123, uplink: null, receive: null,
  });
});

test("expiry clears a summary without allowing replay, while a newer media generation can restart seq", () => {
  const store = new VoiceQualityStore("socket");
  const value = { schemaVersion: 1 as const, connectionGeneration: 1, seq: 10, iceRttMs: null, uplink: null, receive: null };
  assert.deepEqual(store.accept(value, 1000), {
    schemaVersion: 1, clientId: "socket", report: value, receivedAt: 1000, expiresAt: 9000,
  });
  assert.deepEqual(store.clear(9000), {
    schemaVersion: 1, clientId: "socket", report: null, receivedAt: 9000, expiresAt: 9000,
  });
  assert.equal(store.accept(value, 9000), null);
  assert.equal(store.accept({ ...value, seq: 9 }, 9000), null);
  assert.notEqual(store.accept({ ...value, connectionGeneration: 2, seq: 1 }, 9000), null);
  assert.equal(store.accept({ ...value, seq: 11 }, 11_000), null);
});

test("the summary rejects identities, raw RTC fields, non-finite numbers and impossible packet deltas", () => {
  const valid = { schemaVersion: 1, connectionGeneration: 1, seq: 1, iceRttMs: null, uplink: null, receive: null };
  for (const invalid of [
    { ...valid, clientId: "someone-else" }, { ...valid, roomId: "private" },
    { ...valid, candidate: { address: "192.0.2.1" } },
    { ...valid, iceRttMs: NaN }, { ...valid, iceRttMs: Infinity },
    { ...valid, iceRttMs: -1 }, { ...valid, iceRttMs: 60_001 },
    { ...valid, seq: 1.5 }, { ...valid, connectionGeneration: 0 },
    { ...valid, receive: { jitterMaxMs: -1, sample: null } },
    { ...valid, uplink: { rttMs: 5, sample: { windowMs: 2000, packetsReceived: 100_000, packetsLost: 0 } } },
    { ...valid, receive: { jitterMaxMs: 10, sample: { windowMs: 2000, packetsReceived: 20, packetsLost: -1 } } },
    { ...valid, receive: { jitterMaxMs: 10, sample: { windowMs: 2000, packetsReceived: 20, packetsLost: 0, raw: {} } } },
    { ...valid, receive: { jitterMaxMs: 10, sample: { windowMs: 0, packetsReceived: 20, packetsLost: 0 } } },
    { ...valid, receive: { jitterMaxMs: 10, sample: { windowMs: 20_000, packetsReceived: 20, packetsLost: 0 } } },
    null, [], { schemaVersion: 1 },
  ]) assert.equal(parseVoiceQualityReport(invalid), null);
});

test("directional audio samples carry interval packet counts rather than an invented loss percentage", () => {
  const report = {
    schemaVersion: 1, connectionGeneration: 2, seq: 1, iceRttMs: null,
    uplink: { rttMs: 200, sample: { windowMs: 2000, packetsReceived: 99, packetsLost: 1 } },
    receive: { jitterMaxMs: 15, sample: { windowMs: 2000, packetsReceived: 300, packetsLost: 0 } },
  };
  assert.deepEqual(parseVoiceQualityReport(report), report);
});

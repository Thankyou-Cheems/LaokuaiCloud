import assert from "node:assert/strict";

const { readReceiveTransportPath, ReceiveTrackStats } = await import("../dist/webrtc/hybrid/receivePathStats.js");
let assertions = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const track = { id: "peer-track" };

function report({ localType = "host", remoteType = "host", pair = "pair-1", state = "succeeded", missingRemote = false,
  missingTypes = false, duplicateTrack = false } = {}) {
  const rows = new Map([
    ["inbound", { id: "inbound", type: "inbound-rtp", kind: "audio", trackIdentifier: track.id, packetsReceived: 2,
      totalSamplesReceived: 960, transportId: "transport" }],
    ["transport", { id: "transport", type: "transport", selectedCandidatePairId: pair }],
    [pair, { id: pair, type: "candidate-pair", state, localCandidateId: "local", remoteCandidateId: "remote", responsesReceived: 2 }],
    ["local", { id: "local", type: "local-candidate", candidateType: missingTypes ? undefined : localType,
      address: "10.0.0.2", port: 40000, protocol: "udp" }],
  ]);
  if (!missingRemote) rows.set("remote", { id: "remote", type: "remote-candidate", candidateType: missingTypes ? undefined : remoteType,
    address: "10.0.0.3", port: 40001, protocol: "udp" });
  if (duplicateTrack) rows.set("inbound-2", { id: "inbound-2", type: "inbound-rtp", kind: "audio", trackIdentifier: track.id,
    packetsReceived: 3, totalSamplesReceived: 1440, transportId: "transport" });
  return rows;
}

{
  const path = readReceiveTransportPath(report(), track.id, 1000);
  eq(path.classification, "non-turn-candidate");
  eq(path.reason, "selected-pair");
  eq(path.pairId, "pair-1");
  eq(path.local.address, "10.0.0.2");
  eq(path.remote.candidateType, "host");
  eq(path.underlay, null);
  const stats = new ReceiveTrackStats();
  const observation = stats.observe(report(), track.id, 1000);
  eq(observation.transportPath.classification, "non-turn-candidate");
  eq(observation.metrics.path.localCandidateType, "host");
  eq(JSON.stringify(observation.metrics.path).includes("10.0.0.2"), false);
}

{
  const path = readReceiveTransportPath(report({ localType: "relay", remoteType: "srflx" }), track.id, 1000);
  eq(path.classification, "turn-relay");
  eq(path.reason, "turn-relay");
  eq(path.local.candidateType, "relay");
}

{
  for (const options of [{ missingTypes: true }, { missingRemote: true }, { state: "checking" }, { duplicateTrack: true }]) {
    const path = readReceiveTransportPath(report(options), track.id, 1000);
    eq(path.classification, "unknown");
  }
}

{
  const stats = new ReceiveTrackStats();
  eq(stats.observe(report(), track.id, 1000).transportPath.classification, "non-turn-candidate");
  eq(stats.observe(report({ pair: "pair-2", localType: "relay" }), track.id, 2000).transportPath.classification, "turn-relay");
  eq(stats.observe(report({ pair: "pair-3", missingTypes: true }), track.id, 3000).transportPath.classification, "unknown");
}

console.log(JSON.stringify({ result: "pass", kind: "exact-track-selected-pair-classification", assertions,
  addressesKeptOnlyInObservation: true, physicalDirectVerified: false }, null, 2));

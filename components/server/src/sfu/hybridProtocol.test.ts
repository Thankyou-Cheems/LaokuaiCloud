import assert from "node:assert/strict";
import { test } from "node:test";
import { SFUClient } from "./client";
import type { SfuHybridCommand } from "./hybridProtocol";

type Message = { event: string; data: string };
function fixture() {
  const client = new SFUClient("fixture-server", "fixture-secret", "fixture.invalid");
  const sent: Message[] = [];
  const control = client as unknown as { ws: unknown; handleMessage(message: Message): void; hybridPending: Map<string, unknown> };
  control.ws = { readyState: 1, send(raw: string) { sent.push(JSON.parse(raw)); }, close() {} };
  const respond = (commandId: string, status: string, extra: object = {}) => control.handleMessage({ event: "hybrid_result", data: JSON.stringify({ command_id: commandId, status, ...extra }) });
  const frame = (index = sent.length - 1) => JSON.parse(sent[index].data);
  return { client, sent, control, respond, frame };
}

test("Hybrid transport preserves scoped forwarding fields and real ACK correlation", async () => {
  const f = fixture();
  try {
    const request: SfuHybridCommand = { phase: "forwarding", room_id: "fixture-room", authority_generation: "generation", pair_connection_id: "pair", source_user_id: "source", source_session_id: "source-session", source_publication_id: "publication", receiver_user_id: "receiver", receiver_session_id: "receiver-session", revision: 1, enabled: false, pause_ms: 1000 };
    let completed = false;
    const pending = f.client.requestHybrid(request).then(value => { completed = true; return value; });
    const frame = f.frame();
    assert.equal(f.sent[0].event, "hybrid_command");
    assert.equal(frame.server_id, "fixture-server");
    assert.equal(frame.server_password, "fixture-secret");
    for (const [key, value] of Object.entries(request)) assert.equal(frame[key], value);
    f.respond("another-command", "applied");
    f.respond(frame.command_id, "unknown");
    await Promise.resolve();
    assert.equal(completed, false);
    f.respond(frame.command_id, "applied", { snapshot: { remaining_ms: 1000, forwarded_packets: 2, held_packets: 3 } });
    assert.deepEqual((await pending).snapshot, { remaining_ms: 1000, forwarded_packets: 2, held_packets: 3 });
    assert.equal(f.control.hybridPending.size, 0);
  } finally { f.client.disconnect(); }
});

test("Hybrid duplicate/old ACK cannot settle a replacement command", async () => {
  const f = fixture();
  try {
    const first = f.client.requestHybrid({ phase: "probe" });
    const old = f.frame().command_id;
    f.respond(old, "supported");
    assert.equal((await first).status, "supported");
    let completed = false;
    const second = f.client.requestHybrid({ phase: "probe" }).then(value => { completed = true; return value; });
    const current = f.frame().command_id;
    assert.notEqual(current, old);
    f.respond(old, "supported");
    await Promise.resolve();
    assert.equal(completed, false);
    f.respond(current, "failed", { error: "hybrid_unsupported" });
    assert.equal((await second).error, "hybrid_unsupported");
  } finally { f.client.disconnect(); }
});

test("Hybrid missing ACK expires without a false supported result", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const rejected = assert.rejects(f.client.requestHybrid({ phase: "probe" }), /hybrid_sfu_ack_timeout/);
    const id = f.frame().command_id;
    context.mock.timers.tick(5000);
    await rejected;
    f.respond(id, "supported");
    assert.equal(f.control.hybridPending.size, 0);
  } finally { f.client.disconnect(); context.mock.timers.reset(); }
});

test("Hybrid send failure and disconnect reject pending commands", async () => {
  const f = fixture();
  f.control.ws = { readyState: 1, send() { throw new Error("fixture-write-failure"); }, close() {} };
  await assert.rejects(f.client.requestHybrid({ phase: "probe" }), /hybrid_sfu_unavailable/);
  assert.equal(f.control.hybridPending.size, 0);
  f.control.ws = { readyState: 1, send(raw: string) { f.sent.push(JSON.parse(raw)); }, close() {} };
  const rejected = assert.rejects(f.client.requestHybrid({ phase: "probe" }), /hybrid_sfu_disconnected/);
  f.client.disconnect();
  await rejected;
  assert.equal(f.control.hybridPending.size, 0);
  await assert.rejects(f.client.requestHybrid({ phase: "probe" }), /hybrid_sfu_unavailable/);
});

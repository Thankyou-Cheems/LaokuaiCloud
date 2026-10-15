import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import type { Server, Socket } from "socket.io";
import type { Clients } from "../../types";
import type { CommunityBindingRequestV1, CommunityBindingProofV1 } from "../../easytier/communityGrantApi";
import { registerNativeVoiceHandlers, type NativeVoiceSnapshot } from "./voiceNative";
import type { HandlerContext, EventHandlerMap } from "./types";
import { reconcileNativeVoice, removeNativeVoice } from "../utils/nativeVoiceLifecycle";
import { publicClientList } from "../utils/clients";
import { registerVoiceHandlers } from "./voice";

class FakeSocket extends EventEmitter {
  connected = true;
  rooms = new Set<string>();
  events: { event: string; payload: unknown }[] = [];
  handlers: EventHandlerMap = {};
  constructor(readonly id = randomUUID()) { super(); }
  override emit(event: string, payload?: unknown): boolean {
    this.events.push({ event, payload }); return super.emit(event, payload);
  }
  join(room: string) { this.rooms.add(room); }
  leave(room: string) { this.rooms.delete(room); }
  to(_room: string) { return { emit: (_event: string, _payload: unknown) => {} }; }
  async call(event: string, payload: object = {}): Promise<Record<string, unknown>> {
    let reply: Record<string, unknown> = {};
    await this.handlers[event](payload, (value: Record<string, unknown>) => { reply = value; }); return reply;
  }
  snapshot(): NativeVoiceSnapshot { return this.events.filter(e => e.event === "voice:native:snapshot").at(-1)?.payload as NativeVoiceSnapshot; }
}
function fixture() {
  let wall = 1_000_000, enabled = true, limit = 12, policyAllowed = true, speak = true, moveAllowed = true;
  let bindingOverride: ((proof: CommunityBindingProofV1) => CommunityBindingProofV1 | Promise<CommunityBindingProofV1>) | undefined;
  let broadcasts = 0;
  const io = Object.assign(new EventEmitter(), {
    sockets: { sockets: new Map<string, Socket>() },
    to: (_room: string) => ({ emit: (_event: string, _payload: unknown) => {} }),
  }) as unknown as Server;
  const clients: Clients = {};
  const devices = new Map<string, { userId: string; accountId: string; ip: string }>();
  function add(userId: string = randomUUID(), ip = `10.77.0.${devices.size + 2}`) {
    const socket = new FakeSocket();
    const body: CommunityBindingRequestV1 = { v: 1, communityId: "community", deviceId: randomUUID(),
      nativeInstanceId: randomUUID(), grantId: randomUUID() };
    const ci = { serverUserId: userId, grytUserId: randomUUID(), nickname: "Member", accessToken: randomUUID(),
      isMuted: false, isDeafened: false, isServerMuted: false, isServerDeafened: false,
      voiceChannelId: "", streamID: "", hasJoinedChannel: false, isConnectedToVoice: false } as Clients[string];
    clients[socket.id] = ci; io.sockets.sockets.set(socket.id, socket as unknown as Socket);
    devices.set(body.deviceId, { userId, accountId: ci.grytUserId!, ip });
    const ctx: HandlerContext = { io, socket: socket as unknown as Socket, clientId: socket.id, serverId: "server",
      clientsInfo: clients, sfuClient: null, getClientIp: () => "127.0.0.1", clientAddressIsOwn: () => true };
    socket.handlers = registerNativeVoiceHandlers(ctx, {
      enabled: () => enabled, now: () => wall, seatLimit: () => limit,
      authenticate: async (s, c, token) => s.connected !== false && clients[s.id] === c && token === c.accessToken,
      policy: async (_ci, room) => policyAllowed && room !== "text" ? { speak, requirePTT: room === "ptt" } : null,
      binding: async (_token, b) => {
        const d = devices.get(b.deviceId)!;
        const proof: CommunityBindingProofV1 = { v: 1, serverUserId: d.userId, scope: { serverInstanceId: "server",
          accountId: d.accountId, communityId: b.communityId, deviceId: b.deviceId, nativeInstanceId: b.nativeInstanceId },
          grantId: b.grantId, credentialId: "credential", revision: 1, peerId: 1, virtualIp: d.ip,
          publicKeyFingerprint: "a".repeat(64), physicalDirectVerified: false };
        return bindingOverride ? bindingOverride(proof) : proof;
      }, moveAllowed: async () => moveAllowed, broadcast: () => { broadcasts++; },
    });
    return { socket, body, ci, ctx, join: (room = "room") => socket.call("voice:native:join", { v: 1, channelId: room, binding: body }),
      heartbeat: () => socket.call("voice:native:heartbeat", { v: 1, binding: body }) };
  }
  return { io, clients, add, broadcasts: () => broadcasts, advance: (ms: number) => { wall += ms; },
    enable: (value: boolean) => { enabled = value; }, seats: (value: number) => { limit = value; },
    allow: (value: boolean) => { policyAllowed = value; }, speak: (value: boolean) => { speak = value; },
    allowMove: (value: boolean) => { moveAllowed = value; },
    proof: (value: typeof bindingOverride) => { bindingOverride = value; } };
}

describe("native ET voice control without sockets, SFU, ET or device media", () => {
  it("joins an empty room with authenticated own-device address and automatic private key", async () => {
    const f = fixture(), a = f.add(); assert.equal((await a.join()).ok, true);
    const snapshot = a.socket.snapshot(); assert.equal(snapshot.localIp, "10.77.0.2");
    assert.deepEqual(snapshot.peers, []); assert.match(snapshot.key, /^[0-9a-f]{64}$/);
    assert.equal(snapshot.expiresAtMs - snapshot.serverTimeMs, 15_000);
    assert.equal(a.ci.hasJoinedChannel, true); assert.equal(a.ci.isConnectedToVoice, false);
    assert.equal(JSON.stringify(publicClientList(f.clients)).includes(snapshot.key), false);
    f.io.emit("close");
  });
  it("discovers only current room members and rekeys join/leave, never the public directory", async () => {
    const f = fixture(), a = f.add(), b = f.add(), c = f.add(); await a.join(); const key = a.socket.snapshot().key;
    await b.join(); await c.join("other"); assert.notEqual(a.socket.snapshot().key, key);
    assert.equal(a.socket.snapshot().key, b.socket.snapshot().key); assert.equal(a.socket.snapshot().peers.length, 1);
    assert.equal(a.socket.snapshot().peers[0].virtualIp, "10.77.0.3");
    const active = a.socket.snapshot().key; await b.socket.call("voice:native:leave", { v: 1 });
    assert.notEqual(a.socket.snapshot().key, active); assert.deepEqual(a.socket.snapshot().peers, []);
    assert.equal(b.ci.hasJoinedChannel, false); f.io.emit("close");
  });
  it("preserves media epoch during authenticated lease refresh", async () => {
    const f = fixture(), a = f.add(); await a.join(); const initial = a.socket.snapshot(); f.advance(5000); await a.heartbeat();
    const refreshed = a.socket.snapshot(); assert.equal(refreshed.epoch, initial.epoch); assert.equal(refreshed.key, initial.key);
    assert.equal(refreshed.revision, initial.revision); assert.equal(refreshed.expiresAtMs, initial.expiresAtMs + 5000); f.io.emit("close");
  });
  it("deduplicates cosmetic media presence and keeps its rate limit separate from heartbeat", async () => {
    const f = fixture(), a = f.add(); await a.join(); const joinedCount = f.broadcasts();
    await a.socket.call("voice:native:media", { v: 1, connected: false }); assert.equal(f.broadcasts(), joinedCount);
    await a.socket.call("voice:native:media", { v: 1, connected: true }); assert.equal(f.broadcasts(), joinedCount + 1);
    for (let i = 0; i < 70; i++) await a.socket.call("voice:native:media", { v: 1, connected: true });
    assert.equal(f.broadcasts(), joinedCount + 1); assert.equal((await a.heartbeat()).ok, true);
    for (let i = 0; i < 40; i++) await a.socket.call("voice:native:media", { v: 1, connected: i % 2 === 0 });
    assert.equal(a.socket.events.some(e => e.event === "voice:native:error"), false);
    assert.equal(a.ci.hasJoinedChannel, true); assert.equal((await a.heartbeat()).ok, true); f.io.emit("close");
  });
  it("does not accept another device proof belonging to the same account", async () => {
    const f = fixture(), a = f.add(); f.proof(p => ({ ...p, scope: { ...p.scope, deviceId: "wrong" } }));
    assert.equal((await a.join()).error, "binding_mismatch"); assert.equal(a.ci.hasJoinedChannel, false); f.io.emit("close");
  });
  it("refuses spoofed member/account, public IP and grant proof", async () => {
    for (const alter of [
      (p: CommunityBindingProofV1) => ({ ...p, serverUserId: "other" }),
      (p: CommunityBindingProofV1) => ({ ...p, scope: { ...p.scope, accountId: "other" } }),
      (p: CommunityBindingProofV1) => ({ ...p, virtualIp: "8.8.8.8" }),
      (p: CommunityBindingProofV1) => ({ ...p, grantId: "other" }),
    ]) { const f = fixture(), a = f.add(); f.proof(alter); assert.equal((await a.join()).error, "binding_mismatch"); f.io.emit("close"); }
  });
  it("refuses manual IP/key fields and serializes the twelve-seat race", async () => {
    const f = fixture(), a = f.add();
    assert.equal((await a.socket.call("voice:native:join", { v: 1, channelId: "room", binding: { ...a.body, virtualIp: "10.0.0.1" } })).ok, false);
    f.seats(1); const b = f.add(); const replies = await Promise.all([a.join(), b.join()]);
    assert.equal(replies.filter(r => r.ok).length, 1); assert.equal(replies.filter(r => r.error === "server_full").length, 1); f.io.emit("close");
  });
  it("refuses ambiguous same-user devices instead of selecting the first device IP", async () => {
    const f = fixture(), a = f.add(), b = f.add(a.ci.serverUserId); await a.join();
    assert.equal((await b.join()).error, "device_in_voice"); assert.deepEqual(a.socket.snapshot().peers, []); f.io.emit("close");
  });
  it("requires current connection authentication and voice permission", async () => {
    const f = fixture(), a = f.add();
    assert.equal((await a.socket.call("voice:native:join", { v: 1, channelId: "room", binding: a.body, accessToken: "other" })).error, "unauthenticated_connection");
    assert.equal((await a.join("text")).error, "forbidden"); f.allow(false); assert.equal((await a.join()).error, "forbidden"); f.io.emit("close");
  });
  it("cannot resurrect a join whose binding returns after leave", async () => {
    const f = fixture(), a = f.add(); let release!: () => void, started!: () => void;
    const began = new Promise<void>(r => { started = r; }), hold = new Promise<void>(r => { release = r; });
    f.proof(async p => { started(); await hold; return p; }); const join = a.join(); await began;
    await a.socket.call("voice:native:leave", { v: 1 }); release(); assert.equal((await join).error, "stale_request");
    assert.equal(a.ci.hasJoinedChannel, false); assert.equal(a.socket.snapshot(), undefined); f.io.emit("close");
  });
  it("revokes expired room authorization and rekeys the remaining member", async () => {
    const f = fixture(), a = f.add(), b = f.add(); await a.join(); f.advance(5000); await b.join();
    const old = b.socket.snapshot().key; f.advance(10_000); reconcileNativeVoice(f.io);
    assert.equal(a.ci.hasJoinedChannel, false); assert.notEqual(b.socket.snapshot().key, old);
    assert.deepEqual(b.socket.snapshot().peers, []); assert.equal((await a.heartbeat()).error, "not_joined"); f.io.emit("close");
  });
  it("updates mute/PTT in place and excludes server deafened devices until restored", async () => {
    const f = fixture(), a = f.add(), b = f.add(); await a.join("ptt"); await b.join("ptt");
    const before = b.socket.snapshot(), key = before.key; a.ci.isServerMuted = true; reconcileNativeVoice(f.io); await b.heartbeat();
    assert.equal(a.socket.snapshot().canPublish, false); assert.equal(a.socket.snapshot().requirePTT, true);
    assert.equal(b.socket.snapshot().peers[0].canPublish, false); assert.equal(b.socket.snapshot().key, key);
    assert.equal(b.socket.snapshot().epoch, before.epoch); assert.ok(b.socket.snapshot().revision > before.revision);
    a.ci.isDeafened = true; reconcileNativeVoice(f.io); await b.heartbeat();
    assert.equal(a.socket.snapshot().canReceive, false); assert.equal(b.socket.snapshot().epoch, before.epoch);
    a.ci.isServerDeafened = true; reconcileNativeVoice(f.io); await b.heartbeat();
    assert.notEqual(b.socket.snapshot().key, key);
    assert.deepEqual(b.socket.snapshot().peers, []); assert.equal(a.ci.hasJoinedChannel, true);
    assert.equal(a.socket.events.at(-1)?.event, "voice:native:stopped");
    a.ci.isServerDeafened = false; reconcileNativeVoice(f.io); await b.heartbeat();
    assert.equal(b.socket.snapshot().peers.length, 1); assert.equal(a.socket.events.at(-1)?.event, "voice:native:snapshot"); f.io.emit("close");
  });
  it("keeps channel speak authority separate from self mute, deafen and moderation gates", async () => {
    const f = fixture(), a = f.add(undefined, "10.203.217.2");
    a.ci.isMuted = true;
    await a.join();
    const snapshots = { self_muted: a.socket.snapshot(), self_deafened: a.socket.snapshot(),
      server_muted: a.socket.snapshot(), denied: a.socket.snapshot() };
    const authority = () => (a.socket.snapshot() as NativeVoiceSnapshot & { canSpeak?: boolean }).canSpeak;
    assert.equal(a.socket.snapshot().canPublish, false);
    assert.equal(authority(), true, "self mute cannot revoke channel permission or lock out unmute");
    a.ci.isMuted = false; a.ci.isDeafened = true; await a.heartbeat();
    snapshots.self_deafened = a.socket.snapshot();
    assert.equal(a.socket.snapshot().canPublish, false); assert.equal(authority(), true);
    a.ci.isDeafened = false; a.ci.isServerMuted = true; await a.heartbeat();
    snapshots.server_muted = a.socket.snapshot();
    assert.equal(a.socket.snapshot().canPublish, false); assert.equal(authority(), true);
    const previous = a.socket.snapshot();
    f.speak(false); await a.heartbeat();
    snapshots.denied = a.socket.snapshot();
    assert.equal(authority(), false, "channel denial must still be authoritative");
    assert.equal(a.socket.snapshot().canPublish, false);
    assert.ok(a.socket.snapshot().revision > previous.revision, "permission changes need a new revision even while already muted");
    assert.equal(a.socket.snapshot().epoch, previous.epoch);
    const fixturePath = process.env.LAOKUAI_NATIVE_PERMISSION_FIXTURE;
    if (fixturePath) {
      mkdirSync(dirname(fixturePath), { recursive: true });
      writeFileSync(fixturePath, JSON.stringify(snapshots, null, 2) + "\n", "utf8");
    }
    f.io.emit("close");
  });
  it("authoritative permission revocation and disconnect remove media roster immediately", async () => {
    const f = fixture(), a = f.add(), b = f.add(); await a.join(); await b.join();
    assert.equal(removeNativeVoice(f.io, a.socket.id, "admin_disconnected"), true); assert.deepEqual(b.socket.snapshot().peers, []);
    f.allow(false); reconcileNativeVoice(f.io); await b.heartbeat(); assert.equal(b.ci.hasJoinedChannel, false); f.io.emit("close");
  });
  it("expires temporary binding failures at the existing lease without leaking RPC text", async () => {
    const f = fixture(), a = f.add(); await a.join(); f.advance(5000);
    f.proof(() => { throw new Error("PRIVATE KEY AND ISSUER ADDRESS"); });
    const temporary = await a.heartbeat();
    assert.equal(temporary.error, "binding_unavailable"); assert.equal(temporary.retryable, true); assert.equal(a.ci.hasJoinedChannel, true);
    assert.equal(a.socket.events.some(e => e.event === "voice:native:error"), false);
    assert.equal(JSON.stringify(a.socket.events).includes("PRIVATE KEY"), false);
    f.advance(10_000); reconcileNativeVoice(f.io); assert.equal(a.ci.hasJoinedChannel, false); f.io.emit("close");
  });
  it("moves atomically through existing authority before emitting destination snapshot", async () => {
    const f = fixture(), actor = f.add(), target = f.add(), peer = f.add(); await target.join(); await peer.join();
    for (let i = 0; i < 8; i++) { target.ci.isMuted = !target.ci.isMuted; await target.heartbeat(); }
    const sourceRevision = target.socket.snapshot().revision;
    const previous = peer.socket.snapshot().key;
    const result = await actor.socket.call("voice:move:user", { v: 1, requestId: randomUUID(),
      targetServerUserId: target.ci.serverUserId, sourceChannelId: "room", destinationChannelId: "ptt" });
    assert.equal(result.status, "committed"); assert.equal(target.ci.voiceChannelId, "ptt");
    assert.equal(target.socket.snapshot().requirePTT, true); assert.notEqual(peer.socket.snapshot().key, previous);
    assert.ok(target.socket.snapshot().revision > sourceRevision);
    const committed = target.socket.events.findIndex(e => e.event === "voice:move:committed");
    assert.equal((target.socket.events[committed + 1].payload as NativeVoiceSnapshot).channelId, "ptt"); f.io.emit("close");
  });
  it("refuses administrative move authorization and destination join denial", async () => {
    const f = fixture(), actor = f.add(), target = f.add(); await target.join(); f.allowMove(false);
    const payload = { v: 1, requestId: randomUUID(), targetServerUserId: target.ci.serverUserId, sourceChannelId: "room", destinationChannelId: "ptt" };
    assert.equal((await actor.socket.call("voice:move:user", payload)).error, "forbidden");
    f.allowMove(true); assert.equal((await actor.socket.call("voice:move:user", { ...payload, destinationChannelId: "text" })).error, "forbidden");
    assert.equal(target.ci.voiceChannelId, "room"); f.io.emit("close");
  });
  it("stops live rooms when the mode is disabled and protects against legacy room claims", async () => {
    const f = fixture(), a = f.add(); await a.join(); f.enable(false); reconcileNativeVoice(f.io);
    assert.equal(a.ci.hasJoinedChannel, false);
    const previous = process.env.NATIVE_LAN_VOICE_ENABLED; process.env.NATIVE_LAN_VOICE_ENABLED = "true";
    try {
      const legacy = registerVoiceHandlers(a.ctx);
      await legacy["voice:room:request"]("room"); await legacy["voice:channel:joined"](true); legacy["voice:stream:set"]("spoofed");
      assert.equal(a.ci.hasJoinedChannel, false); assert.equal(a.ci.streamID, "");
      assert.equal(a.socket.events.some(e => e.event === "voice:room:granted"), false);
    } finally { if (previous === undefined) delete process.env.NATIVE_LAN_VOICE_ENABLED; else process.env.NATIVE_LAN_VOICE_ENABLED = previous; f.io.emit("close"); }
  });
});

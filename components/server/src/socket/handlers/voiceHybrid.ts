import { randomUUID } from "node:crypto";
import type { Socket, Server } from "socket.io";
import type { Clients } from "../../types";
import { mayInChannel } from "../../services/channelPermissions";
import { requireAuth } from "../middleware/auth";
import { sfuRoomId } from "../utils/voiceRooms";
import { watchVoiceHybrid } from "../utils/voiceHybridLifecycle";
import type { HandlerContext, EventHandlerMap } from "./types";

interface Scope { serverInstanceId: string; roomId: string; roomGeneration: string; localParticipantId: string; localSessionId: string; canPublish: boolean; canReceive: boolean }
interface Participant { participantId: string; sessionId: string; publicationId: string; canSendAudio: boolean; canReceiveAudio: boolean }
interface Member { socket: Socket; ci: Clients[string]; participant: Participant }
interface Pair { id: string; roomId: string; roomGeneration: string; a: Member; b: Member; expires: number; sequences: Map<string, number>; retired: boolean }
interface Forwarding { scope: Scope; pairConnectionId: string | null; sourceParticipantId: string; sourceSessionId: string; sourcePublicationId: string; destinationSessionId: string; routeGeneration: number; operationId: string; enabled: boolean; pauseLeaseMs: number }
interface Hub { instance: string; rooms: Map<string, string>; pairs: Map<string, Pair>; sockets: Set<Socket>; queue: Promise<unknown>; pending: number; revision: number;
  gateOperations: Map<string, { generation: number; operation: number; pair: string | null }>; timer?: NodeJS.Timeout; unwatch?: () => void }
const hubs = new WeakMap<Server, Hub>();
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const sameScope = (a: Scope, b: Scope) => a.serverInstanceId === b.serverInstanceId && a.roomId === b.roomId &&
  a.roomGeneration === b.roomGeneration && a.localParticipantId === b.localParticipantId && a.localSessionId === b.localSessionId &&
  a.canPublish === b.canPublish && a.canReceive === b.canReceive;
const validSignal = (body: any) => record(body) && ((body.kind === "offer" || body.kind === "answer") ? typeof body.sdp === "string" && body.sdp.length <= 65536 :
  body.kind === "candidate" && (body.candidate === null || record(body.candidate) && typeof body.candidate.candidate === "string" && body.candidate.candidate.length <= 4096 &&
    (body.candidate.sdpMid == null || text(body.candidate.sdpMid)) &&
    (body.candidate.sdpMLineIndex == null || Number.isSafeInteger(body.candidate.sdpMLineIndex) && body.candidate.sdpMLineIndex >= 0 && body.candidate.sdpMLineIndex <= 1024) &&
    (body.candidate.usernameFragment == null || text(body.candidate.usernameFragment))));

/** Opt-in experimental network protocol; no fixture identity substitutes for authentication. */
export function registerVoiceHybridHandlers(ctx: HandlerContext, options: { enabled?: boolean } = {}): EventHandlerMap {
  const { io, socket, clientsInfo, serverId, sfuClient } = ctx;
  const enabled = options.enabled ?? process.env.VOICE_HYBRID_ENABLED === "true";
  let state = hubs.get(io);
  if (!state) {
    state = { instance: `${serverId}:${randomUUID()}`, rooms: new Map(), pairs: new Map(), sockets: new Set(), queue: Promise.resolve(), pending: 0, revision: 0, gateOperations: new Map() };
    hubs.set(io, state);
  }
  const hub = state; hub.sockets.add(socket);
  function currentBinding(member: Member): boolean {
    const { socket: s, ci, participant: p } = member;
    return s.connected && io.sockets.sockets.get(s.id) === s && clientsInfo[s.id] === ci && ci.hasJoinedChannel &&
      ci.isConnectedToVoice === true && ci.serverUserId === p.participantId && ci.streamID === p.publicationId;
  }
  function current(member: Member): boolean {
    return currentBinding(member) && !member.ci.isServerMuted && !member.ci.isServerDeafened && !member.ci.isDeafened;
  }
  function pairCurrent(pair: Pair): boolean {
    return !pair.retired && pair.expires > Date.now() && hub.rooms.get(pair.roomId) === pair.roomGeneration &&
      current(pair.a) && current(pair.b) && pair.a.ci.voiceChannelId === pair.roomId && pair.b.ci.voiceChannelId === pair.roomId;
  }
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (hub.pending >= 128) return Promise.reject(new Error("hybrid_busy")); ++hub.pending;
    const next = hub.queue.then(work, work); hub.queue = next.catch(() => {});
    return next.finally(() => { --hub.pending; });
  }
  function retire(pair: Pair, except?: Socket): void {
    if (pair.retired) return; pair.retired = true; pair.expires = Date.now() + 30000;
    for (const member of [pair.a, pair.b]) if (member.socket !== except && member.socket.connected) member.socket.emit("voice:hybrid:pair-invalidated", { connectionId: pair.id });
    // The real SFU expiry restores even if this cleanup loses its connection.
    for (const [source, destination] of [[pair.a, pair.b], [pair.b, pair.a]]) {
      void enqueue(async () => sfuClient?.requestHybrid({ phase: "forwarding", room_id: sfuRoomId(serverId, pair.roomId),
        authority_generation: hub.instance, pair_connection_id: pair.id, source_user_id: source.participant.participantId,
        source_session_id: source.socket.id, source_publication_id: source.participant.publicationId,
        receiver_user_id: destination.participant.participantId, receiver_session_id: destination.socket.id,
        revision: ++hub.revision, enabled: true, pause_ms: 0 })).catch(() => {});
    }
  }
  if (enabled && !hub.unwatch) {
    hub.unwatch = watchVoiceHybrid(io, (sid, userId) => {
      for (const pair of hub.pairs.values()) if (!pair.retired && (sid && [pair.a.socket.id, pair.b.socket.id].includes(sid) ||
        userId && [pair.a.ci.serverUserId, pair.b.ci.serverUserId].includes(userId) || !pairCurrent(pair))) retire(pair);
      for (const channel of hub.rooms.keys()) if (!Object.values(clientsInfo).some(ci => ci.hasJoinedChannel && ci.voiceChannelId === channel)) hub.rooms.delete(channel);
    });
    hub.timer = setInterval(() => {
      for (const [key, pair] of hub.pairs) {
        if (!pair.retired && !pairCurrent(pair)) retire(pair);
        else if (pair.retired && pair.expires <= Date.now()) hub.pairs.delete(key);
      }
      for (const key of hub.gateOperations.keys()) {
        const [generation, source, publication, receiver] = JSON.parse(key) as string[];
        if (!clientsInfo[source]?.hasJoinedChannel || clientsInfo[source].streamID !== publication || !clientsInfo[receiver]?.hasJoinedChannel ||
          hub.rooms.get(clientsInfo[source].voiceChannelId) !== generation) hub.gateOperations.delete(key);
      }
    }, 1000); hub.timer.unref();
  }
  socket.once("disconnect", () => {
    hub.sockets.delete(socket);
    for (const pair of hub.pairs.values()) if ([pair.a.socket, pair.b.socket].includes(socket)) retire(pair);
    if (hub.sockets.size === 0) { clearInterval(hub.timer); hub.unwatch?.(); hubs.delete(io); }
  });
  async function member(sid: string): Promise<Member> {
    const s = io.sockets.sockets.get(sid), ci = clientsInfo[sid];
    if (!s?.connected || !ci || typeof ci.accessToken !== "string" || ci.accessToken.length === 0 || ci.accessToken.length > 8192) throw new Error("hybrid_unauthenticated");
    const auth = await requireAuth(s, { accessToken: ci.accessToken });
    if (!auth || io.sockets.sockets.get(sid) !== s || clientsInfo[sid] !== ci ||
        ci.serverUserId !== auth.tokenPayload.serverUserId || ci.grytUserId !== auth.tokenPayload.grytUserId ||
        !ci.hasJoinedChannel || !ci.isConnectedToVoice || !text(ci.voiceChannelId) || !text(ci.streamID)) throw new Error("hybrid_unauthenticated");
    const room = ci.voiceChannelId;
    const [join, read, speak] = await Promise.all(["join_voice", "read_messages", "speak"].map(permission =>
      mayInChannel(room, ci.serverUserId, permission as "join_voice" | "read_messages" | "speak", ci.grytUserId)));
    if (!join || !read || s !== io.sockets.sockets.get(sid) || ci !== clientsInfo[sid] || ci.voiceChannelId !== room || !ci.hasJoinedChannel) throw new Error("hybrid_permission_denied");
    return { socket: s, ci, participant: { participantId: ci.serverUserId, sessionId: sid, publicationId: ci.streamID,
      canSendAudio: speak && !ci.isServerMuted, canReceiveAudio: !ci.isServerDeafened && !ci.isDeafened } };
  }
  function scope(local: Member): Scope {
    const roomId = local.ci.voiceChannelId;
    if (!hub.rooms.has(roomId)) hub.rooms.set(roomId, randomUUID());
    return { serverInstanceId: hub.instance, roomId, roomGeneration: hub.rooms.get(roomId)!, localParticipantId: local.ci.serverUserId,
      localSessionId: local.socket.id, canPublish: local.participant.canSendAudio, canReceive: local.participant.canReceiveAudio };
  }
  async function ready(local: Member): Promise<Scope> {
    if (!enabled || !sfuClient || !sfuClient.isConnected()) throw new Error("hybrid_unsupported");
    const result = await sfuClient.requestHybrid({ phase: "probe" });
    if (result.status !== "supported") throw new Error("hybrid_unsupported");
    if (!currentBinding(local)) throw new Error("hybrid_scope_stale");
    return scope(local);
  }
  async function checkedScope(p: any, restoring = false): Promise<{ local: Member; scope: Scope }> {
    const local = await member(socket.id), actual = scope(local);
    if (!record(p.scope) || !sameScope(p.scope as Scope, actual) || (!restoring && !actual.canPublish) || !actual.canReceive) throw new Error("hybrid_scope_stale");
    return { local, scope: actual };
  }
  async function pairOwned(id: unknown, restore = false): Promise<Pair> {
    if (!text(id)) throw new Error("hybrid_pair_unknown");
    const pair = hub.pairs.get(id);
    if (!pair || ![pair.a.socket, pair.b.socket].includes(socket) || (!restore && !pairCurrent(pair))) throw new Error("hybrid_pair_stale");
    const [a, b] = await Promise.all([member(pair.a.socket.id), member(pair.b.socket.id)]);
    for (const [next, old] of [[a, pair.a], [b, pair.b]]) {
      if (next.ci !== old.ci || next.participant.publicationId !== old.participant.publicationId || next.ci.voiceChannelId !== pair.roomId) {
        retire(pair); throw new Error("hybrid_pair_stale");
      }
      if (!next.participant.canSendAudio || !next.participant.canReceiveAudio) {
        retire(pair); if (!restore) throw new Error("hybrid_pair_stale");
      }
    }
    if (!restore && !pairCurrent(pair)) throw new Error("hybrid_pair_stale");
    return pair;
  }
  let windowStart = 0, calls = 0;
  const wrap = (work: (p: any) => Promise<object>) => async (payload: unknown, ack?: (value: unknown) => void) => {
    let result: object;
    try {
      if (!enabled) throw new Error("hybrid_disabled");
      if (Date.now() - windowStart > 2000) { calls = 0; windowStart = Date.now(); }
      if (++calls > 128) throw new Error("hybrid_rate_limited");
      if (!record(payload) || payload.accessToken !== clientsInfo[socket.id]?.accessToken) throw new Error("hybrid_unauthenticated");
      result = await enqueue(() => work(payload));
    } catch (error) { result = { status: "failed", error: error instanceof Error && /^hybrid_[a-z_]+$/.test(error.message) ? error.message : "hybrid_failed" }; }
    if (typeof ack === "function") ack({ v: 1, ...result });
  };
  return {
    "voice:hybrid:scope": wrap(async () => {
      const local = await member(socket.id), actual = await ready(local); const peers: Participant[] = [];
      const counts = new Map<string, number>();
      for (const ci of Object.values(clientsInfo)) if (ci.hasJoinedChannel && ci.voiceChannelId === actual.roomId) counts.set(ci.serverUserId, (counts.get(ci.serverUserId) ?? 0) + 1);
      for (const [sid, ci] of Object.entries(clientsInfo)) {
        if (sid === socket.id || ci.serverUserId === local.ci.serverUserId || counts.get(ci.serverUserId) !== 1 || !ci.hasJoinedChannel || ci.voiceChannelId !== actual.roomId) continue;
        try { const remote = await member(sid); if (remote.participant.canSendAudio && remote.participant.canReceiveAudio) peers.push(remote.participant); } catch {}
      }
      return { status: "supported", capabilities: { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true }, scope: actual, participants: peers };
    }),
    "voice:hybrid:lease": wrap(async p => {
      const { local, scope: actual } = await checkedScope(p);
      if (!record(p.participant) || !text(p.participant.sessionId) || p.participant.sessionId === socket.id) throw new Error("hybrid_participant_invalid");
      const remote = await member(p.participant.sessionId);
      if (remote.ci.voiceChannelId !== actual.roomId || remote.participant.participantId !== p.participant.participantId ||
        remote.participant.publicationId !== p.participant.publicationId || !remote.participant.canSendAudio || !remote.participant.canReceiveAudio) throw new Error("hybrid_cross_room_or_generation");
      if (remote.ci.serverUserId === local.ci.serverUserId || Object.values(clientsInfo).filter(ci => ci.hasJoinedChannel && ci.voiceChannelId === actual.roomId && ci.serverUserId === remote.ci.serverUserId).length !== 1) throw new Error("hybrid_participant_invalid");
      await ready(local);
      let pair = [...hub.pairs.values()].find(row => pairCurrent(row) && row.roomId === actual.roomId &&
        [row.a.socket.id, row.b.socket.id].includes(socket.id) && [row.a.socket.id, row.b.socket.id].includes(remote.socket.id));
      if (!pair) {
        if (hub.pairs.size >= 512) throw new Error("hybrid_pair_capacity");
        const [a, b] = socket.id < remote.socket.id ? [local, remote] : [remote, local];
        pair = { id: randomUUID(), roomId: actual.roomId, roomGeneration: actual.roomGeneration, a, b, expires: Date.now() + 30000, sequences: new Map(), retired: false };
        hub.pairs.set(pair.id, pair);
      }
      pair.expires = Date.now() + 30000;
      return { status: "leased", lease: { connectionId: pair.id, scope: actual, remoteSessionId: remote.socket.id, initiator: pair.a.socket === socket } };
    }),
    "voice:hybrid:signal": wrap(async p => {
      const signal = p.signal; if (!record(signal) || !validSignal(signal.body)) throw new Error("hybrid_signal_invalid");
      const pair = await pairOwned(signal.connectionId);
      const destination = pair.a.socket === socket ? pair.b : pair.a;
      if (signal.serverInstanceId !== hub.instance || signal.roomId !== pair.roomId || signal.roomGeneration !== pair.roomGeneration ||
        signal.sourceSessionId !== socket.id || signal.destinationSessionId !== destination.socket.id ||
        !Number.isSafeInteger(signal.sequence) || signal.sequence <= (pair.sequences.get(socket.id) ?? 0) ||
        signal.sequence > (pair.sequences.get(socket.id) ?? 0) + 64) throw new Error("hybrid_signal_stale");
      if (signal.body.kind === "offer" && pair.a.socket !== socket || signal.body.kind === "answer" && pair.b.socket !== socket) throw new Error("hybrid_signal_role");
      pair.sequences.set(socket.id, signal.sequence); pair.expires = Date.now() + 30000;
      const body = signal.body.kind === "candidate" ? { kind: "candidate", candidate: signal.body.candidate === null ? null : {
        candidate: signal.body.candidate.candidate, sdpMid: signal.body.candidate.sdpMid,
        sdpMLineIndex: signal.body.candidate.sdpMLineIndex, usernameFragment: signal.body.candidate.usernameFragment } } :
        { kind: signal.body.kind, sdp: signal.body.sdp };
      destination.socket.emit("voice:hybrid:signal", { serverInstanceId: hub.instance, roomId: pair.roomId, roomGeneration: pair.roomGeneration,
        sourceSessionId: socket.id, destinationSessionId: destination.socket.id, connectionId: pair.id, sequence: signal.sequence, body });
      return { status: "relayed" };
    }),
    "voice:hybrid:forwarding": wrap(async p => {
      const request = p.request as Forwarding; if (!record(request)) throw new Error("hybrid_forwarding_invalid");
      const { local, scope: actual } = await checkedScope({ scope: request.scope }, request.enabled === true);
      if (request.destinationSessionId !== socket.id || typeof request.enabled !== "boolean" || !text(request.sourceSessionId) ||
        !text(request.sourceParticipantId) || !text(request.sourcePublicationId) || !Number.isSafeInteger(request.routeGeneration) || request.routeGeneration <= 0 ||
        !text(request.operationId) || !Number.isSafeInteger(request.pauseLeaseMs) || (request.enabled ? request.pauseLeaseMs !== 0 : request.pauseLeaseMs < 1000 || request.pauseLeaseMs > 10000)) throw new Error("hybrid_forwarding_invalid");
      const source = await member(request.sourceSessionId);
      if (source.ci.voiceChannelId !== actual.roomId || source.ci.serverUserId !== request.sourceParticipantId || source.ci.streamID !== request.sourcePublicationId) throw new Error("hybrid_cross_room_or_generation");
      let pair: Pair | undefined;
      if (request.pairConnectionId !== null) { pair = await pairOwned(request.pairConnectionId, request.enabled);
        if (![pair.a.socket.id, pair.b.socket.id].includes(source.socket.id)) throw new Error("hybrid_pair_stale"); }
      else if (!request.enabled) throw new Error("hybrid_pair_unknown");
      const match = /^(\d+):(\d+)$/.exec(request.operationId); const operation = Number(match?.[2]);
      if (!match || Number(match[1]) !== request.routeGeneration || !Number.isSafeInteger(operation) || operation <= 0) throw new Error("hybrid_operation_invalid");
      const key = JSON.stringify([actual.roomGeneration, source.socket.id, source.ci.streamID, socket.id]); const prior = hub.gateOperations.get(key);
      if (!prior && hub.gateOperations.size >= 2048) throw new Error("hybrid_gate_capacity");
      if (pair?.retired && prior?.pair !== pair.id || prior?.pair && prior.pair !== request.pairConnectionId &&
        hub.pairs.get(prior.pair) && !hub.pairs.get(prior.pair)!.retired) throw new Error("hybrid_cleanup_conflict");
      if (prior && (!pair || prior.pair === pair.id) && (request.routeGeneration < prior.generation ||
        request.routeGeneration === prior.generation && operation <= prior.operation)) throw new Error("hybrid_operation_stale");
      if (!pair && prior?.pair && hub.pairs.get(prior.pair) && !hub.pairs.get(prior.pair)!.retired) throw new Error("hybrid_cleanup_conflict");
      const result = await sfuClient!.requestHybrid({ phase: "forwarding", room_id: sfuRoomId(serverId, actual.roomId), authority_generation: hub.instance,
        pair_connection_id: request.pairConnectionId ?? "", source_user_id: source.ci.serverUserId, source_session_id: source.socket.id,
        source_publication_id: source.ci.streamID, receiver_user_id: local.ci.serverUserId, receiver_session_id: socket.id,
        revision: ++hub.revision, enabled: request.enabled, pause_ms: request.pauseLeaseMs });
      if (result.status !== "applied" || !result.snapshot || !Number.isFinite(result.snapshot.remaining_ms) ||
        result.snapshot.remaining_ms < 0 || !request.enabled && result.snapshot.remaining_ms <= 0) throw new Error("hybrid_sfu_ack_failed");
      const receiverCurrent = request.enabled ? currentBinding(local) && !local.ci.isServerDeafened && !local.ci.isDeafened : current(local);
      if (!receiverCurrent || !(request.enabled ? currentBinding(source) : current(source)) || source.ci.voiceChannelId !== actual.roomId || local.ci.voiceChannelId !== actual.roomId || !request.enabled && pair && !pairCurrent(pair)) throw new Error("hybrid_scope_stale");
      hub.gateOperations.set(key, { generation: request.routeGeneration, operation, pair: request.pairConnectionId });
      if (pair && !pair.retired) pair.expires = Date.now() + 30000;
      return { status: "applied", ack: { ...structuredClone(request), applied: true, leaseRemainingMs: result.snapshot.remaining_ms } };
    }),
    "voice:hybrid:release": wrap(async p => {
      const local = await member(socket.id); if (!record(p.lease) || !sameScope(p.lease.scope, scope(local))) throw new Error("hybrid_scope_stale");
      const pair = await pairOwned(p.lease.connectionId, true); retire(pair, socket); return { status: "released" };
    }),
  };
}

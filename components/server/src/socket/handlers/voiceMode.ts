/** Ephemeral diagnostic semantics, never permissions or SFU mute control. */
export type VoiceModeState = {
  v: 1;
  seq: number;
  inputMode: "voice_activity" | "push_to_talk";
  squad: "off" | "standby" | "armed" | "suppressed" | "resuming" | "unavailable";
  transmit: "normal" | "manual-muted" | "server-muted" | "ptt-idle" | "squad-suppressed" | "resuming" | "pending" | "suspended" | "error";
};
type Peer = { hasJoinedChannel?: boolean; voiceChannelId?: string; serverUserId?: string; streamID?: string };
type SocketLike = { id: string; emit: (event: string, data: unknown) => unknown };
type Context = {
  socket: SocketLike;
  io: { sockets: { sockets: Map<string, SocketLike> }; to: (room: string) => { emit: (event: string, data: unknown) => unknown } };
  clientsInfo: Record<string, Peer>;
  clientId: string;
  roomFor: (id: string) => string;
  identified: () => boolean;
  now?: () => number;
};
type Entry = { state: VoiceModeState; at: number; room: string; stream: string; burstAt: number; burst: number; semantic: string };
const entries = new WeakMap<object, Entry>();
const SQUAD = ["off", "standby", "armed", "suppressed", "resuming", "unavailable"];
const TRANSMIT = ["normal", "manual-muted", "server-muted", "ptt-idle", "squad-suppressed", "resuming", "pending", "suspended", "error"];
export function parseVoiceMode(value: unknown): VoiceModeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["v", "seq", "inputMode", "squad", "transmit"].includes(k))) return null;
  if (v.v !== 1 || !Number.isSafeInteger(v.seq) || (v.seq as number) < 0
    || !["voice_activity", "push_to_talk"].includes(v.inputMode as string)
    || !SQUAD.includes(v.squad as string) || !TRANSMIT.includes(v.transmit as string)) return null;
  return { v: 1, seq: v.seq as number, inputMode: v.inputMode as VoiceModeState["inputMode"],
    squad: v.squad as VoiceModeState["squad"], transmit: v.transmit as VoiceModeState["transmit"] };
}
export function registerVoiceModeHandlers(ctx: Context) {
  const now = ctx.now ?? Date.now;
  const respond = (ack: unknown, value: unknown) => { if (typeof ack === "function") ack(value); };
  let fetchedAt = -Infinity;
  const own = () => ctx.clientsInfo[ctx.clientId];
  const joined = (ci: Peer | undefined) => !!ci?.hasJoinedChannel && !!ci.voiceChannelId && !!ci.serverUserId && !ci.serverUserId.startsWith("temp_");
  return {
    "voice:mode:capabilities": (_: unknown, ack?: (value: unknown) => void) => {
      respond(ack, { v: 1, supported: true });
    },
    "voice:mode:set": (value: unknown, ack?: (value: unknown) => void) => {
      const ci = own();
      const state = parseVoiceMode(value);
      if (!state || !ctx.identified() || !joined(ci)) { respond(ack, { accepted: false }); return; }
      const previous = entries.get(ctx.socket);
      const time = now();
      if (previous && state.seq <= previous.state.seq) { respond(ack, { accepted: false }); return; }
      const burstAt = previous && time - previous.burstAt < 1000 ? previous.burstAt : time;
      const burst = burstAt === previous?.burstAt ? previous.burst + 1 : 1;
      if (burst > 12) { respond(ack, { accepted: false }); return; }
      const semantic = JSON.stringify([state.inputMode, state.squad, state.transmit]);
      if (previous && previous.semantic === semantic && time - previous.at < 500) {
        entries.set(ctx.socket, { ...previous, state, burstAt, burst }); respond(ack, { accepted: true }); return;
      }
      const entry = { state, at: time, room: ci!.voiceChannelId!, stream: ci!.streamID ?? "", burstAt, burst, semantic };
      entries.set(ctx.socket, entry);
      ctx.io.to(ctx.roomFor(entry.room)).emit("voice:mode", { clientId: ctx.clientId, serverUserId: ci!.serverUserId, state });
      respond(ack, { accepted: true });
    },
    "voice:mode:fetch": (_: unknown, ack?: (value: unknown) => void) => {
      const ci = own();
      if (!ctx.identified() || !joined(ci)) { respond(ack, []); return; }
      if (now() - fetchedAt < 250) { respond(ack, []); return; }
      fetchedAt = now();
      const states: unknown[] = [];
      for (const [id, socket] of ctx.io.sockets.sockets) {
        const peer = ctx.clientsInfo[id];
        const entry = entries.get(socket);
        if (!joined(peer) || peer.voiceChannelId !== ci!.voiceChannelId || !entry
          || entry.room !== peer.voiceChannelId || entry.stream !== (peer.streamID ?? "") || now() - entry.at > 8000) continue;
        states.push({ clientId: id, serverUserId: peer.serverUserId, state: entry.state });
      }
      respond(ack, states);
    },
  };
}

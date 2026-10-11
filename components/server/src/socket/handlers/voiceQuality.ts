import type { HandlerContext, EventHandlerMap } from "./types";
import { requireAuth } from "../middleware/auth";
import { voiceRoomName, sfuRoomId } from "../utils/voiceRooms";
import { parseVoiceQualityRequest, VoiceQualityStore } from "../utils/voiceQuality";
import type { VoiceQualityUpdate } from "../utils/voiceQualityContract";
import { VOICE_QUALITY_TTL_MS, VOICE_QUALITY_REPORT_INTERVAL_MS } from "../utils/voiceQualityContract";

export interface VoiceQualityHandlerOptions {
  now?: () => number;
  /** Timer boundary: return a cancellation function. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  authenticate?: typeof requireAuth;
}

export interface VoiceQualityRegistration {
  handlers: EventHandlerMap;
  /** Call on leave/member-left/room change before replacing membership. */
  clear: () => void;
  /** Release the connection's listener and timer on teardown. */
  dispose: () => void;
}

export function registerVoiceQualityHandlers(
  ctx: HandlerContext,
  options: VoiceQualityHandlerOptions = {},
): VoiceQualityRegistration {
  const { io, socket, clientId, serverId, clientsInfo, sfuClient } = ctx;
  const now = options.now ?? Date.now;
  const authenticate = options.authenticate ?? requireAuth;
  const schedule = options.schedule ?? ((run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  });
  const store = new VoiceQualityStore(clientId);
  let lastAttemptAt = -Infinity;
  let lastChannelId: string | null = null;
  let cancelExpiry: (() => void) | undefined;
  let disposed = false;
  let lifecycleGeneration = 0;
  let authenticationPending = false;

  function joinedRoom(): string | null {
    const client = clientsInfo[clientId];
    if (!socket.connected || !client?.accessToken || !client.grytUserId ||
        !client.hasJoinedChannel || !client.voiceChannelId ||
        !socket.rooms.has(voiceRoomName(serverId, client.voiceChannelId)) ||
        !sfuClient?.isConnected() ||
        sfuClient.getTrackedUser(client.serverUserId)?.roomId !== sfuRoomId(serverId, client.voiceChannelId)) return null;
    return client.voiceChannelId;
  }

  function broadcast(channelId: string, update: VoiceQualityUpdate): void {
    const room = voiceRoomName(serverId, channelId);
    for (const [id, peerSocket] of io.sockets.sockets) {
      const peer = clientsInfo[id];
      if (peer?.accessToken && peer.grytUserId && peer.hasJoinedChannel &&
          peer.voiceChannelId === channelId && peerSocket.rooms.has(room)) {
        peerSocket.emit("voice:quality:update", update);
      }
    }
  }

  function clear(): void {
    lifecycleGeneration++;
    cancelExpiry?.();
    cancelExpiry = undefined;
    const update = store.clear(now());
    if (lastChannelId && update) broadcast(lastChannelId, update);
    lastChannelId = null;
  }

  const handlers: EventHandlerMap = {
    "voice:quality:report": async (payload: unknown) => {
      const attemptedAt = now();
      if (disposed || authenticationPending || attemptedAt - lastAttemptAt < VOICE_QUALITY_REPORT_INTERVAL_MS) return;
      // Invalid envelopes/authentication attempts cannot multiply DB work.
      lastAttemptAt = attemptedAt;
      const request = parseVoiceQualityRequest(payload);
      const channelId = joinedRoom();
      if (!channelId) { clear(); return; }
      if (!request) return;
      const generation = lifecycleGeneration;
      const member = clientsInfo[clientId];
      let auth: Awaited<ReturnType<typeof requireAuth>>;
      authenticationPending = true;
      try {
        auth = await authenticate(socket, request);
      } catch {
        if (!disposed && generation === lifecycleGeneration) clear();
        return;
      } finally {
        authenticationPending = false;
      }
      const client = clientsInfo[clientId];
      if (disposed || generation !== lifecycleGeneration) return;
      if (client !== member || !auth || joinedRoom() !== channelId ||
          auth.tokenPayload.serverUserId !== client?.serverUserId ||
          auth.tokenPayload.grytUserId !== client.grytUserId) { clear(); return; }
      const receivedAt = now();
      const update = store.accept(request.report, receivedAt);
      if (!update) return;
      lastChannelId = channelId;
      cancelExpiry?.();
      cancelExpiry = schedule(clear, VOICE_QUALITY_TTL_MS);
      broadcast(channelId, update);
    },
  };
  socket.on("disconnect", clear);
  return {
    handlers,
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      socket.off("disconnect", clear);
    },
  };
}

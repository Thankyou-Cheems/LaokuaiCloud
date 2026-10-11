import { useSFU } from "@gryt/voice";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useUserId } from "@/common";
import { useSockets } from "@/socket";

import { type AuthenticatedVoiceConnection, MemberVoiceMediaStore } from "../../../../lib/memberVoiceMediaStore";
import { MemberVoiceMediaPathProvider } from "../components/MemberVoiceMediaPathAdapter";

/** Passive roster/lifecycle boundary, including ordinary SFU and receive-only calls.
 * SDK observations are deliberately absent until the owner's frozen API is consumed.
 * No network, capture, media selection, ET ownership or getStats lives here. */
export function MemberVoiceMediaBridge({ children }: { children?: ReactNode }) {
  const account = useUserId(), sfu = useSFU(), sockets = useSockets();
  const host = sfu.currentServerConnected, channel = sfu.currentChannelConnected;
  const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.() ?? null;
  const serverId = sockets.serverDetailsList[host]?.server_info?.server_id;
  const context = useRef({ account, sfu, sockets });
  context.current = { account, sfu, sockets };
  const [store] = useState(() => new MemberVoiceMediaStore(() => Date.now()));
  const reconcile = useCallback(() => {
    const { account, sfu, sockets } = context.current;
    const host = sfu.currentServerConnected, room = sfu.currentChannelConnected;
    const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.();
    const roster = sockets.clients[host] ?? {}, local = socket?.id ? roster[socket.id] : undefined;
    if (!account || !socket?.connected || !socket.id || !pc || pc.connectionState !== "connected" ||
      !sfu.isConnected || !room || !local?.serverUserId || local.hasJoinedChannel !== true || local.voiceChannelId !== room) {
      store.reconcile(); return;
    }
    const rosterEntries = Object.entries(roster);
    const members: AuthenticatedVoiceConnection["members"][number][] = [];
    for (const [sessionId, member] of rosterEntries) {
      if (sessionId === socket.id || !member.serverUserId || !member.streamID || member.hasJoinedChannel !== true ||
        member.voiceChannelId !== room || member.isConnectedToVoice !== true) continue;
      const source = sfu.streamSources[member.streamID]?.receiveCleanup;
      if (!source || source.isCurrent?.() === false) continue;
      const aliases = Object.entries(sfu.streamSources).filter(([, value]) => value.receiveCleanup === source).map(([alias]) => alias);
      if (rosterEntries.some(([, candidate]) => candidate.screenShareAudioStreamID && aliases.includes(candidate.screenShareAudioStreamID)) ||
        rosterEntries.filter(([, candidate]) => candidate.streamID && aliases.includes(candidate.streamID)).length !== 1) continue;
      members.push({ userId: member.serverUserId, sessionId, publicationId: member.streamID, source });
    }
    store.reconcile({ accountId: account, host, roomId: room, localUserId: local.serverUserId, localSessionId: socket.id,
      localPublicationId: local.streamID || null, socket, peerConnection: pc, members,
      ...(sockets.serverDetailsList[host]?.server_info?.server_id ? { serverInstanceId: sockets.serverDetailsList[host].server_info!.server_id } : {}),
    });
  }, [store]);
  useLayoutEffect(() => { reconcile(); }, [reconcile, account, host, channel, socket, socket?.id, socket?.connected,
    pc, pc?.connectionState, serverId, sfu.isConnected, sfu.streamSources, sockets.clients]);
  useEffect(() => {
    // Clock and lifecycle refresh only: no stats/capture. Retired sources also
    // invalidate synchronously through their existing SDK retirement subscription.
    const timer = setInterval(reconcile, 500);
    return () => { clearInterval(timer); store.clear(); };
  }, [reconcile, store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <MemberVoiceMediaPathProvider value={snapshot}>{children}</MemberVoiceMediaPathProvider>;
}

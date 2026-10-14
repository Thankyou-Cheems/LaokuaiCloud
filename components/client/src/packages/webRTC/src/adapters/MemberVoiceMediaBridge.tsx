import { type BrowserHybridVoiceSession, type ReceivePathBinding } from "@gryt/voice";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useUserId } from "@/common";
import { useSockets } from "@/socket";

import { useEasyTierCommunityState } from "../../../../lib/communityLanState";
import { readVoiceLocalNetwork } from "../../../../lib/memberVoiceLocalNetwork";
import { type AuthenticatedVoiceConnection, MemberVoiceMediaStore } from "../../../../lib/memberVoiceMediaStore";
import { type HybridVoiceObservationBinding, MemberVoiceReceiveTranslator, type VoiceReceiveHost } from "../../../../lib/memberVoiceReceiveTranslator";
import { useSFU } from "../../../../lib/voiceFacade";
import { MemberVoiceMediaPathProvider } from "../components/MemberVoiceMediaPathAdapter";
import { MemberVoiceObservationAuthorityProvider } from "./MemberVoiceObservationAuthority";

/** Passive roster/lifecycle boundary, including ordinary SFU and receive-only calls.
 * One SDK observer borrows the existing PC/media sampler. No capture, media
 * selection, ET ownership or client-owned getStats lives here. */
export function MemberVoiceMediaBridge({ children }: { children?: ReactNode }) {
  const account = useUserId(), sfu = useSFU(), sockets = useSockets();
  const host = sfu.currentServerConnected, channel = sfu.currentChannelConnected;
  const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.() ?? null;
  const serverId = sockets.serverDetailsList[host]?.server_info?.server_id;
  const community = useEasyTierCommunityState(serverId);
  const context = useRef({ account, sfu, sockets });
  context.current = { account, sfu, sockets };
  const session = useRef<{ value: BrowserHybridVoiceSession; binding: HybridVoiceObservationBinding } | null>(null);
  const [store] = useState(() => new MemberVoiceMediaStore(() => performance.now()));
  const getHost = useCallback((): VoiceReceiveHost | null => {
    const { account, sfu, sockets } = context.current;
    const host = sfu.currentServerConnected, room = sfu.currentChannelConnected;
    const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.();
    const roster = sockets.clients[host] ?? {}, local = socket?.id ? roster[socket.id] : undefined;
    if (!account || !socket?.connected || !socket.id || !pc || pc.connectionState !== "connected" ||
      !sfu.isConnected || !room || !local?.serverUserId || local.hasJoinedChannel !== true || local.voiceChannelId !== room) {
      return null;
    }
    const rosterEntries = Object.entries(roster);
    const members: AuthenticatedVoiceConnection["members"][number][] = [];
    const bindings: ReceivePathBinding[] = [];
    for (const [sessionId, member] of rosterEntries) {
      if (sessionId === socket.id || !member.serverUserId || !member.streamID || member.hasJoinedChannel !== true ||
        member.voiceChannelId !== room || member.isConnectedToVoice !== true) continue;
      const entry = sfu.streamSources[member.streamID], source = entry?.receiveCleanup;
      if (!source || source.isCurrent?.() === false) continue;
      const aliases = Object.entries(sfu.streamSources).filter(([, value]) => value.receiveCleanup === source).map(([alias]) => alias);
      if (rosterEntries.some(([, candidate]) => [candidate.screenShareAudioStreamID, candidate.screenShareVideoStreamID, candidate.cameraStreamID].some(id => id && aliases.includes(id))) ||
        rosterEntries.filter(([, candidate]) => candidate.streamID && aliases.includes(candidate.streamID)).length !== 1) continue;
      members.push({ userId: member.serverUserId, sessionId, publicationId: member.streamID, source });
      bindings.push({ participantId: member.serverUserId, sessionId, publicationId: member.streamID, role: "microphone", source: entry });
    }
    const connectionEpoch = sfu.getConnectionEpoch?.();
    if (connectionEpoch == null) return null;
    return { connectionEpoch, bindings, hybridScope: session.current?.value.getReceiveScope() ?? null,
      hybridBinding: session.current?.binding,
      connection: { accountId: account, host, roomId: room, localUserId: local.serverUserId, localSessionId: socket.id,
      localPublicationId: local.streamID || null, socket, peerConnection: pc, members,
      ...(sockets.serverDetailsList[host]?.server_info?.server_id ? { serverId: sockets.serverDetailsList[host].server_info!.server_id } : {}),
    } };
  }, []);
  const [translator] = useState(() => new MemberVoiceReceiveTranslator(store, {
    getSfu: () => context.current.sfu, getHost, now: () => performance.now(),
  }));
  const reconcile = useCallback(() => translator.update(), [translator]);
  const [authority] = useState(() => ({ requestDetails: () => translator.requestDetails(), update: reconcile,
    registerSession: (value: BrowserHybridVoiceSession, binding: HybridVoiceObservationBinding) => {
      const registration = { value, binding: Object.freeze({ ...binding }) };
      session.current = registration; reconcile();
      return () => { if (session.current === registration) { session.current = null; reconcile(); } };
    } }));
  useLayoutEffect(() => { reconcile(); }, [reconcile, account, host, channel, socket, socket?.id, socket?.connected,
    pc, pc?.connectionState, serverId, sfu.isConnected, sfu.streamSources, sockets.clients]);
  useEffect(() => {
    // Clock and lifecycle refresh only: no stats/capture. Retired sources also
    // invalidate synchronously through their existing SDK retirement subscription.
    translator.start(); const timer = setInterval(reconcile, 500);
    return () => { clearInterval(timer); translator.stop(); };
  }, [reconcile, translator]);
  useEffect(() => {
    // Observe existing socket lifecycle only; disconnect immediately retires the
    // host binding even if the same socket/PC survives a rapid reconnect.
    const disconnected = () => { reconcile(); };
    const connected = () => { translator.start(); reconcile(); };
    socket?.on("disconnect", disconnected); socket?.on("connect", connected);
    return () => { socket?.off("disconnect", disconnected); socket?.off("connect", connected); };
  }, [socket, translator, reconcile]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const value = { ...snapshot, localNetwork: readVoiceLocalNetwork(serverId, community, Date.now()) };
  return <MemberVoiceObservationAuthorityProvider value={authority}><MemberVoiceMediaPathProvider value={value}>{children}</MemberVoiceMediaPathProvider></MemberVoiceObservationAuthorityProvider>;
}

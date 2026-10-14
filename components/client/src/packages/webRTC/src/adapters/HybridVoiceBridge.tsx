import { BrowserHybridVoiceSession, type BrowserHybridVoiceState, type HybridParticipant, type MicrophoneCodecProfile, type VoiceConfig } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { getServerAccessToken, useUserId } from "@/common";
import { useSockets } from "@/socket";

import { useEasyTierCommunityState } from "../../../../lib/communityLanState";
import { createEasyTierVoiceUnderlayResolver } from "../../../../lib/easyTierVoiceUnderlay";
import { createHybridDiagnosticObserver, type HybridDiagnostic } from "../../../../lib/hybridDiagnostics";
import { readVoiceLocalNetwork } from "../../../../lib/memberVoiceLocalNetwork";
import type { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";
import { useMicrophone, useSFU } from "../../../../lib/voiceFacade";
import { useMemberVoiceObservationAuthority } from "./MemberVoiceObservationAuthority";

/** Separate explicit network opt-in. It enables voice only and never starts EasyTier. */
export interface HybridVoicePolicy {
  enabled: boolean;
  allowNetwork: boolean;
  /** Optional override; otherwise inherit the current authorized SFU PC configuration. */
  rtcConfiguration?: RTCConfiguration;
  /** Independent peer encoder profile; channel permission/cap is still passed separately. */
  microphoneCodec?: MicrophoneCodecProfile;
  onState?(state: BrowserHybridVoiceState): void;
  /** Safe, deduplicated summaries only; no account, room, candidate or track identifiers. */
  onDiagnostic?(diagnostic: HybridDiagnostic): void;
}

export function HybridVoiceBridge({ policy, config, registry }: { policy?: HybridVoicePolicy; config: VoiceConfig; registry: ReceiveCorrectionRegistry }) {
  const account = useUserId(), sfu = useSFU(), microphone = useMicrophone(false);
  const sockets = useSockets();
  const observations = useMemberVoiceObservationAuthority();
  const { currentServerConnected: host, currentChannelConnected: channel, isConnected, streamSources } = sfu;
  const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.() ?? null;
  const serverId = sockets.serverDetailsList[host]?.server_info?.server_id;
  const community = useEasyTierCommunityState(serverId);
  const localNetwork = readVoiceLocalNetwork(serverId, community, Date.now());
  const local = sockets.clients[host]?.[socket?.id ?? ""];
  const connectionEpoch = sfu.getConnectionEpoch?.();
  const rosterReady = !!local?.serverUserId && local.hasJoinedChannel === true && local.voiceChannelId === channel;
  const epochReady = connectionEpoch != null && Number.isSafeInteger(connectionEpoch) && connectionEpoch > 0;
  // Only local binding/readiness changes own this lifecycle. Remote roster refreshes update the existing session.
  const scopeKey = JSON.stringify([account, serverId, host, channel, socket?.id, local?.serverUserId, rosterReady, connectionEpoch]);
  const context = useRef({ scopeKey, sfu, microphone, sockets, policy, config, localNetwork });
  context.current = { scopeKey, sfu, microphone, sockets, policy, config, localNetwork };
  const pathUnderlayResolver = useRef(createEasyTierVoiceUnderlayResolver(() => context.current.localNetwork)).current;
  const live = useRef<{ scopeKey: string; socket: typeof socket; pc: RTCPeerConnection; session: BrowserHybridVoiceSession; releaseObservation?: () => void } | undefined>(undefined);
  const configured = policy?.allowNetwork === true;
  const profileKey = JSON.stringify([policy?.rtcConfiguration, policy?.microphoneCodec, config.connection.microphoneCodec, config.connection.maxBitrate]);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const diagnostics = createHybridDiagnosticObserver(value => context.current.policy?.onDiagnostic?.(value));
    const readiness = { connected: isConnected && pc?.connectionState === "connected", rosterReady, epochReady };
    const boot = async () => {
      if (cancelled) return;
      const old = live.current;
      if (old) {
        // Same-call reconfiguration waits for real SFU restoration before replacing its owner.
        if (old.scopeKey === scopeKey && old.socket === socket && old.pc === pc && isConnected && pc?.connectionState === "connected") {
          await old.session.setEnabled(false);
          if (cancelled || live.current !== old) return;
          if (old.session.getState().status !== "disabled") {
            diagnostics.scope("recovering", "reconfigure_restore_pending", readiness);
            if (!cancelled) retry = setTimeout(() => { void boot(); }, 1000);
            return;
          }
        }
        diagnostics.scope("retired", "scope_retired", readiness);
        old.releaseObservation?.(); old.session.dispose(); if (live.current === old) live.current = undefined;
      }
      const codec = context.current.policy?.microphoneCodec ?? context.current.config.connection.microphoneCodec;
      const waiting = !configured ? "network_disabled" : !account || !serverId || !channel ? "identity_unavailable" :
        !socket?.connected || !socket.id ? "socket_unavailable" : !isConnected || !pc || pc.connectionState !== "connected" ? "sfu_media_unavailable" :
        !codec ? "codec_unavailable" : !rosterReady ? "roster_unavailable" : !epochReady ? "epoch_unavailable" : null;
      if (waiting) { diagnostics.scope("waiting", waiting, readiness); return; }
      if (cancelled || !account || !serverId || !channel || !socket || !socket.id || !pc || !codec) return;
      const local = context.current.sockets.clients[host]?.[socket.id];
      const connectionEpoch = context.current.sfu.getConnectionEpoch?.();
      if (!local?.serverUserId || local.hasJoinedChannel !== true || local.voiceChannelId !== channel ||
        connectionEpoch == null || !Number.isSafeInteger(connectionEpoch) || connectionEpoch <= 0) return;
      const binding = Object.freeze({ accountId: account, host, serverId, roomId: channel,
        localUserId: local.serverUserId, localSessionId: socket.id, socket, peerConnection: pc, connectionEpoch });
      const ice = context.current.policy?.rtcConfiguration ?? pc.getConfiguration();
      const current = () => {
        const currentLocal = context.current.sockets.clients[host]?.[binding.localSessionId];
        return context.current.scopeKey === scopeKey && context.current.sfu.isConnected &&
          context.current.sfu.getPeerConnection?.() === pc && context.current.sfu.getConnectionEpoch?.() === connectionEpoch &&
          context.current.sockets.sockets[host] === socket && socket.connected && socket.id === binding.localSessionId && currentLocal?.serverUserId === binding.localUserId &&
          currentLocal.hasJoinedChannel === true && currentLocal.voiceChannelId === channel;
      };
      const sourceFor = (participant: HybridParticipant) => {
        if (!current()) return null;
        const roster = context.current.sockets.clients[host] ?? {}, member = roster[participant.sessionId];
        if (!member || member.serverUserId !== participant.participantId || member.streamID !== participant.publicationId ||
          member.voiceChannelId !== channel || member.hasJoinedChannel !== true) return null;
        const source = context.current.sfu.streamSources[participant.publicationId]; if (!source?.receiveCleanup) return null;
        const aliases = Object.entries(context.current.sfu.streamSources).filter(([, value]) => value.receiveCleanup === source.receiveCleanup).map(([alias]) => alias);
        const members = Object.values(roster);
        if (members.some(value => value.screenShareAudioStreamID && aliases.includes(value.screenShareAudioStreamID)) ||
          members.filter(value => value.streamID && aliases.includes(value.streamID)).length !== 1) return null;
        return source;
      };
      const session = new BrowserHybridVoiceSession({ socket, expectedRoomId: channel, getAccessToken: () => getServerAccessToken(host) ?? undefined,
        rtcConfiguration: ice, microphoneCodec: codec,
        channelMaxBitrateBps: context.current.config.connection.maxBitrate, enabled: context.current.policy?.enabled, allowNetwork: true,
        pathUnderlayResolver,
        getPeerConnection: () => context.current.sfu.getPeerConnection?.() ?? null, getMicrophone: () => context.current.microphone,
        isCurrent: current, getSource: sourceFor,
        onSelection: (source, track) => { if (source.receiveCleanup) registry.selectTrack(source.receiveCleanup, track); observations?.update(); },
        onDiagnostic: event => diagnostics.sdk(event),
        onState: state => { diagnostics.state(state); observations?.update(); context.current.policy?.onState?.(state); },
      });
      if (cancelled) { session.dispose(); return; }
      live.current = { scopeKey, socket, pc, session, releaseObservation: observations?.registerSession(session, binding) };
      diagnostics.scope("created", null, readiness); await session.update();
    };
    void boot().catch(() => {
      if (cancelled) return;
      diagnostics.scope("unsupported", "hybrid_unavailable", readiness);
      context.current.policy?.onState?.({status:"unsupported",reason:"hybrid_unavailable",routing:null,physicalDirectVerified:false});
    });
    return () => { cancelled = true; clearTimeout(retry); };
  }, [account, serverId, host, channel, socket, socket?.connected, scopeKey, pc, pc?.connectionState, isConnected, configured, profileKey, registry, observations, pathUnderlayResolver, rosterReady, epochReady]);
  useEffect(() => { void live.current?.session.setEnabled(policy?.enabled === true); }, [policy?.enabled]);
  useEffect(() => { void live.current?.session.update(); }, [streamSources, sockets.clients]);
  useEffect(() => () => { live.current?.releaseObservation?.(); live.current?.session.dispose(); live.current = undefined; }, []);
  return null;
}

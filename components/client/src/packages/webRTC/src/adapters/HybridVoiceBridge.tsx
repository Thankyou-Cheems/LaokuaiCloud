import { BrowserHybridVoiceSession, type BrowserHybridVoiceState, type HybridParticipant, type MicrophoneCodecProfile, useMicrophone, useSFU, type VoiceConfig } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { getServerAccessToken, useUserId } from "@/common";
import { useSockets } from "@/socket";

import type { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";

/** Separate explicit network opt-in. It enables voice only and never starts EasyTier. */
export interface HybridVoicePolicy {
  enabled: boolean;
  allowNetwork: boolean;
  /** Optional override; otherwise inherit the current authorized SFU PC configuration. */
  rtcConfiguration?: RTCConfiguration;
  /** Independent peer encoder profile; channel permission/cap is still passed separately. */
  microphoneCodec?: MicrophoneCodecProfile;
  onState?(state: BrowserHybridVoiceState): void;
}

export function HybridVoiceBridge({ policy, config, registry }: { policy?: HybridVoicePolicy; config: VoiceConfig; registry: ReceiveCorrectionRegistry }) {
  const account = useUserId(), sfu = useSFU(), microphone = useMicrophone(false);
  const sockets = useSockets();
  const { currentServerConnected: host, currentChannelConnected: channel, isConnected, streamSources } = sfu;
  const socket = sockets.sockets[host], pc = sfu.getPeerConnection?.() ?? null;
  const serverId = sockets.serverDetailsList[host]?.server_info?.server_id;
  const scopeKey = JSON.stringify([account, serverId, host, channel, socket?.id]);
  const context = useRef({ scopeKey, sfu, microphone, sockets, policy, config });
  context.current = { scopeKey, sfu, microphone, sockets, policy, config };
  const live = useRef<{ scopeKey: string; session: BrowserHybridVoiceSession } | undefined>(undefined);
  const configured = policy?.allowNetwork === true;
  const profileKey = JSON.stringify([policy?.rtcConfiguration, policy?.microphoneCodec, config.connection.microphoneCodec, config.connection.maxBitrate]);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const boot = async () => {
      const old = live.current;
      if (old) {
        // Same-call reconfiguration waits for real SFU restoration before replacing its owner.
        if (old.scopeKey === scopeKey && isConnected && pc?.connectionState === "connected") {
          await old.session.setEnabled(false);
          if (old.session.getState().status !== "disabled") {
            if (!cancelled) retry = setTimeout(() => { void boot(); }, 1000);
            return;
          }
        }
        old.session.dispose(); if (live.current === old) live.current = undefined;
      }
      const codec = context.current.policy?.microphoneCodec ?? context.current.config.connection.microphoneCodec;
      if (cancelled || !configured || !account || !serverId || !channel || !socket?.connected || !socket.id || !isConnected ||
        !pc || pc.connectionState !== "connected" || !codec) return;
      const ice = context.current.policy?.rtcConfiguration ?? pc.getConfiguration();
      const current = () => context.current.scopeKey === scopeKey && context.current.sfu.isConnected &&
        context.current.sfu.getPeerConnection?.() === pc && socket.connected && socket.id === JSON.parse(scopeKey)[4];
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
        getPeerConnection: () => context.current.sfu.getPeerConnection?.() ?? null, getMicrophone: () => context.current.microphone,
        isCurrent: current, getSource: sourceFor,
        onSelection: (source, track) => { if (source.receiveCleanup) registry.selectTrack(source.receiveCleanup, track); },
        onState: state => context.current.policy?.onState?.(state),
      });
      if (cancelled) { session.dispose(); return; }
      live.current = { scopeKey, session }; await session.update();
    };
    void boot().catch(() => context.current.policy?.onState?.({status:"unsupported",reason:"hybrid_unavailable",routing:null,physicalDirectVerified:false}));
    return () => { cancelled = true; clearTimeout(retry); };
  }, [account, serverId, host, channel, socket, scopeKey, pc, isConnected, configured, profileKey, registry]);
  useEffect(() => { void live.current?.session.setEnabled(policy?.enabled === true); }, [policy?.enabled]);
  useEffect(() => { void live.current?.session.update(); }, [streamSources, sockets.clients]);
  useEffect(() => () => { live.current?.session.dispose(); live.current = undefined; }, []);
  return null;
}

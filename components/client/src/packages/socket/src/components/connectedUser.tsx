import { Avatar, Skeleton } from "@gryt/ui";
import { motion } from "motion/react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useTransmitSpeech } from "@/webRTC/src/components/TransmitSpeechAdapter";

import { PiMicrophoneSlashFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { MemberVoiceMediaStatus } from "./MemberVoiceMediaStatus";
import { MemberVoiceQuality } from "./MemberVoiceQuality";
import { RemoteReceiveCorrection } from "./RemoteReceiveCorrection";
import { SpeakingHalo } from "./SpeakingHalo";
import {
  speakingRingStyle,
  tileHue,
} from "./speakingIndicator";
import { UserContextMenu } from "./UserContextMenu";
import { VoiceModeIcon } from "./VoiceModeIcon";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

/** Radix Avatar size="1". The halo has to be told the box it grows from. */
const SIDEBAR_AVATAR_PX = 24;

/** Thinner than the tile's 2.5px — the row is a fraction of the height. */
const SIDEBAR_RING = 2;

export function ConnectedUser({
  isSpeaking,
  avatarColor,
  avatarWorn,
  speakingAnalyser,
  isMuted,
  isDeafened,
  isAFK,
  nickname,
  avatarSrc,
  serverUserId,
  isSelf,
  isConnectingToVoice = false,
  canDisconnect,
  onDisconnectFromVoice,
  role,
  targetRole,
  isServerMuted,
  isServerDeafened,
  onKick,
  onBan,
  onServerMute,
  onServerDeafen,
  onToggleRole,
  targetRoles,
  serverHost,
  streamId,
  showVoiceMediaPath = false,
}: {
  isSpeaking: boolean;
  /** Dominant colour of the avatar, so the ring matches the voice tile's. */
  avatarColor?: string | null;
  /** Their owl's design, which beats the sampled colour above. See tileHue. */
  avatarWorn?: string | null;
  /** The same analyser the tile's halo reads. */
  speakingAnalyser?: AnalyserNode;
  isMuted: boolean;
  isDeafened: boolean;
  isAFK: boolean;
  nickname: string;
  avatarSrc?: string;
  serverUserId?: string;
  streamId?: string;
  /** Only the current room's live media membership may request a path badge. */
  showVoiceMediaPath?: boolean;
  isSelf?: boolean;
  isConnectedToVoice?: boolean;
  isConnectingToVoice?: boolean;
  screenShareEnabled?: boolean;
  cameraEnabled?: boolean;
  canDisconnect?: boolean;
  onDisconnectFromVoice?: () => void;
  role?: Role;
  targetRole?: Role;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  onKick?: () => void;
  onBan?: () => void;
  onServerMute?: (muted: boolean) => void;
  onServerDeafen?: (deafened: boolean) => void;
  onToggleRole?: (role: Role, hold: boolean) => void;
  targetRoles?: Role[];
  serverHost?: string;
}) {
  useSocketTranslation();
  const actualSelfSpeech=useTransmitSpeech();
  const deafened = isDeafened || isServerDeafened;
  const speaking=(isSelf ? actualSelfSpeech : isSpeaking) && !isMuted && !isServerMuted && !deafened;
  const closedLabel = socketI18n.t(deafened ? "voiceAudio.deafenedState" : "voiceAudio.mutedState");
  const hue = tileHue(nickname, avatarColor, { nickname, worn: avatarWorn });

  return (
    <UserContextMenu
      serverHost={serverHost}
      serverUserId={serverUserId}
      nickname={nickname}
      isSelf={isSelf}
      canDisconnect={canDisconnect}
      isInVoice={true}
      onDisconnectFromVoice={onDisconnectFromVoice}
      role={role}
      targetRole={targetRole}
      isServerMuted={isServerMuted}
      isServerDeafened={isServerDeafened}
      onKick={onKick}
      onBan={onBan}
      onServerMute={onServerMute}
      onServerDeafen={onServerDeafen}
      onToggleRole={onToggleRole}
      targetRoles={targetRoles}
    >
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      style={{ width: "100%", overflow: "hidden" }}
    >
      <div className="flex flex-nowrap items-center gap-2 px-3 py-1 w-full" data-gryt="voice-member" style={{
          containerType: "inline-size",
          opacity: 1,
          transition: "opacity 0.3s ease",
        }}>
        <div className="flex gap-2 items-center" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center justify-center relative" style={{ flexShrink: 0 }}>
            <SpeakingHalo
              analyser={isSelf ? undefined : speakingAnalyser}
              active={speaking}
              hue={hue}
              size={SIDEBAR_AVATAR_PX}
            />
            <Avatar
              size="small"
              className="h-6 w-6 text-[10px]"
              fallback={nickname[0]}
              src={avatarSrc}
              style={{
                flexShrink: 0,
                // Same ring the voice tile draws, at this row's width. Sharing
                // speakingRingStyle is the point: the two used to disagree.
                ...speakingRingStyle(hue, speaking, SIDEBAR_RING),
              }}
            />
          </div>
          <span className="min-w-0 flex-1 truncate text-sm" data-gryt="member-name" title={nickname}>{nickname}</span>
        </div>

        <div className="flex shrink-0 flex-nowrap gap-1 items-center" data-gryt="voice-member-status-icons">
          <VoiceModeIcon host={serverHost} member={serverUserId} isSelf={isSelf} />
          {showVoiceMediaPath && !isSelf && <MemberVoiceMediaStatus compact host={serverHost} member={serverUserId} publicationId={streamId} />}
          <div className="inline-flex shrink-0 items-center gap-1" data-gryt="voice-member-secondary">
            <MemberVoiceQuality host={serverHost} member={serverUserId}/>
            {!isSelf && <RemoteReceiveCorrection compact host={serverHost} member={serverUserId} streamId={streamId} />}
            {isAFK && <span className="text-xs font-bold text-gryt-warning">{socketI18n.t("socketFull.connectedUser_47ce15dbdf")}</span>}
          </div>
          {isConnectingToVoice && (
            <Skeleton variant="circular" width="12px" height="12px" />
          )}
          {(deafened || isMuted || isServerMuted) && <span role="img" tabIndex={0} title={closedLabel} aria-label={closedLabel}>
            {deafened ? <PiSpeakerSlashFill size={14} color="var(--gryt-danger-8)" />
              : <PiMicrophoneSlashFill size={14} color="var(--gryt-danger-8)" />}
          </span>}
        </div>
      </div>
    </motion.div>
    </UserContextMenu>
  );
}

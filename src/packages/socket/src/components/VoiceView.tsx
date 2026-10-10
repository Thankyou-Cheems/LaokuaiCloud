import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { ConnectedUser } from "./connectedUser";
import type { VoiceView as LegacyVoiceView } from "./LegacyMediaVoiceView";

/** Audio participants only. The upstream media renderer is kept as source, never mounted. */
export const VoiceView = (props: Parameters<typeof LegacyVoiceView>[0]) => {
  if (!props.showVoiceView || props.currentServerConnected !== props.serverHost) return null;
  const entries = Object.entries(props.clientsForHost).filter(([, client]) =>
    client.hasJoinedChannel && client.voiceChannelId === props.currentChannelId);
  return <div data-gryt="voice-view" aria-hidden="false" className="overflow-y-auto min-w-0"
    style={{width:props.voiceWidth,maxWidth:props.maxWidth,flexShrink:0}}>
    {entries.map(([id, client]) => {
      const member = props.members?.find(item => item.serverUserId === client.serverUserId);
      const target = client.serverUserId;
      const actions = props.adminActions;
      return <ConnectedUser key={id} nickname={client.nickname} serverHost={props.serverHost}
        serverUserId={target} streamId={client.streamID} isSelf={id===props.currentConnectionId}
        isSpeaking={props.clientsSpeaking[id]===true && !client.isMuted && !client.isServerMuted}
        isMuted={client.isMuted || !!client.isServerMuted} isDeafened={client.isDeafened || !!client.isServerDeafened}
        isAFK={client.isAFK} isConnectingToVoice={id===props.currentConnectionId && props.isConnecting}
        avatarSrc={resolveAvatarSrc(member?.avatarFileId ? getUploadsFileUrl(props.serverHost,member.avatarFileId) : undefined,client.nickname,member?.avatarWorn)}
        avatarColor={member?.avatarColor} avatarWorn={member?.avatarWorn}
        role={props.currentUserRole} targetRole={member?.role} targetRoles={member?.roles}
        isServerMuted={client.isServerMuted} isServerDeafened={client.isServerDeafened}
        canDisconnect={!!props.onDisconnectUser} onDisconnectFromVoice={target && props.onDisconnectUser ? () => props.onDisconnectUser!(target) : undefined}
        onKick={target && actions?.onKickUser ? () => actions.onKickUser!(target) : undefined}
        onBan={target && actions?.onBanUser ? () => actions.onBanUser!(target) : undefined}
        onServerMute={target && actions?.onServerMuteUser ? muted => actions.onServerMuteUser!(target,muted) : undefined}
        onServerDeafen={target && actions?.onServerDeafenUser ? deafened => actions.onServerDeafenUser!(target,deafened) : undefined}
        onToggleRole={target && actions?.onToggleRole ? (role,hold) => actions.onToggleRole!(target,role,hold) : undefined}
      />;
    })}
  </div>;
};

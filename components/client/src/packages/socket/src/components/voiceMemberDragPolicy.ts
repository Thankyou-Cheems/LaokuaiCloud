import type { Channel } from "@/settings/src/types/server";

import type { ServerRoleSummary } from "../hooks/usePermissions";
import { outranks } from "../lib/memberFacts";
import type { Client } from "../types/clients";

export type VoiceDragTarget = { clientId: string; serverUserId: string; source: string; host: string; generation: string };
export type VoiceDragSnapshot = {
  host: string;
  generation?: string;
  connected: boolean;
  enabled: boolean;
  canDisconnect: boolean;
  role?: string;
  roles: ServerRoleSummary[];
  members: ReadonlyMap<string, { role?: string }>;
  clients: Record<string, Client>;
  channels: Channel[];
  authoritativeChannels: Channel[];
};

/** Match the existing move menu's permission/rank and single-device contract. */
export function mayMoveVoiceMember(snapshot: VoiceDragSnapshot, clientId: string): boolean {
  const client = snapshot.clients[clientId];
  return !!client?.serverUserId && client.hasJoinedChannel && !!client.voiceChannelId &&
    snapshot.canDisconnect && outranks(snapshot.roles, snapshot.role, snapshot.members.get(client.serverUserId)?.role);
}

export function voiceDragTarget(snapshot: VoiceDragSnapshot, clientId: string): VoiceDragTarget | null {
  if (!mayMoveVoiceMember(snapshot, clientId) || !snapshot.enabled || !snapshot.connected || !snapshot.generation) return null;
  const client = snapshot.clients[clientId];
  // Count every joined device, including older devices that cannot stage.
  if (!client.voiceMoveStagingSupported || Object.values(snapshot.clients).filter(peer =>
    peer.serverUserId === client.serverUserId && peer.hasJoinedChannel).length !== 1) return null;
  if (!snapshot.channels.some(channel => channel.id === client.voiceChannelId && channel.type === "voice") ||
      !snapshot.authoritativeChannels.some(channel => channel.id === client.voiceChannelId && channel.type === "voice")) return null;
  return { clientId, serverUserId: client.serverUserId!, source: client.voiceChannelId!, host: snapshot.host, generation: snapshot.generation };
}

export function mayDropVoiceMember(snapshot: VoiceDragSnapshot, target: VoiceDragTarget, destination: string): boolean {
  const current = voiceDragTarget(snapshot, target.clientId);
  return !!current && current.host === target.host && current.generation === target.generation &&
    current.serverUserId === target.serverUserId && current.source === target.source && destination !== target.source &&
    snapshot.channels.some(channel => channel.id === destination && channel.type === "voice") &&
    snapshot.authoritativeChannels.some(channel => channel.id === destination && channel.type === "voice");
}

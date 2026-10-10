type VoiceRosterEntry = {
  serverUserId?: string;
  hasJoinedChannel?: boolean;
  voiceChannelId?: string;
  streamID?: string;
  screenShareAudioStreamID?: string;
};

/** Only the current authenticated server roster can authorize remote audio. */
export function receiveMicrophoneStreamIds(input: {
  connected: boolean;
  host: string;
  channelId?: string;
  clients: readonly VoiceRosterEntry[];
}): string[] {
  if (!input.connected || !input.host || !input.channelId) return [];
  const screens = new Set(input.clients.map(client => client.screenShareAudioStreamID).filter(Boolean));
  return [...new Set(input.clients.filter(client =>
    client.serverUserId && client.hasJoinedChannel === true && client.voiceChannelId === input.channelId &&
    typeof client.streamID === "string" && client.streamID.trim() && !screens.has(client.streamID),
  ).map(client => client.streamID!))].sort();
}

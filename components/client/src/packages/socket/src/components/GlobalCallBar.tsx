import { useVoicePresence } from "@/webRTC/src/adapters/useVoicePresence";

import { useSFU } from "../../../../lib/voiceFacade";
import { useSockets } from "../hooks/useSockets";
import { RoomCallBar } from "./RoomCallBar";

/** The call follows the joined room, including while discovery or another server is open. */
export function GlobalCallBar() {
  const voice = useVoicePresence();
  const { currentServerConnected, currentChannelConnected, isConnecting, callAloneTimeoutSeconds } = useSFU();
  const { clients } = useSockets();
  if (!voice.inCall && !currentServerConnected) return null;
  const occupants = Object.values(clients[currentServerConnected] ?? {}).filter(client => client.voiceChannelId === currentChannelConnected && client.hasJoinedChannel);
  return <RoomCallBar isCall={(callAloneTimeoutSeconds ?? 0) > 0} alone={!isConnecting && occupants.length === 1} />;
}

import { useSFU } from "@gryt/voice";
import { useLayoutEffect } from "react";

import { useSockets } from "@/socket";

import type { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";

export function useReceiveAudioRoles(registry: ReceiveCorrectionRegistry): void {
  const { currentServerConnected, currentChannelConnected, connectionState, isConnected, streamSources } = useSFU();
  const { clients } = useSockets();
  useLayoutEffect(() => {
    const members = currentServerConnected ? Object.values(clients[currentServerConnected] || {}) : [];
    registry.reconcile({ host: currentServerConnected, channel: currentChannelConnected,
      connected: isConnected && connectionState === "connected", sources: streamSources, clients: members });
  }, [registry, clients, currentServerConnected, currentChannelConnected, connectionState, isConnected, streamSources]);
}

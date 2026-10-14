import { useLayoutEffect } from "react";

import { useSockets } from "@/socket";

import type { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";
import { useSFU } from "../../../../lib/voiceFacade";

export function useReceiveAudioRoles(registry: ReceiveCorrectionRegistry,scopeKey=""): void {
  const { currentServerConnected, currentChannelConnected, connectionState, isConnected, streamSources } = useSFU();
  const { clients } = useSockets();
  useLayoutEffect(() => {
    const members = currentServerConnected ? Object.values(clients[currentServerConnected] || {}) : [];
    registry.reconcile({ host: currentServerConnected, channel: currentChannelConnected,
      connected: isConnected && connectionState === "connected", sources: streamSources, clients: members });
  }, [registry, scopeKey, clients, currentServerConnected, currentChannelConnected, connectionState, isConnected, streamSources]);
}

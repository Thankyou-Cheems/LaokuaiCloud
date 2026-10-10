import { useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { useSockets } from "@/socket";

import { VoiceQualitySampler } from "../../../../lib/voiceQualityStats";
import { emitAuthenticated } from "../../../socket/src/utils/tokenManager";

/** One local-PC report, never an estimate of an arbitrary teammate's connection. */
export function useVoiceQualityReporting() {
  const { isConnected, currentServerConnected: host, currentChannelConnected: channel, getPeerConnection } = useSFU();
  const { sockets } = useSockets();
  const socket = sockets[host];
  const generation = useRef(0);
  useEffect(() => {
    if (!isConnected || !socket?.connected || !channel) return;
    let disposed = false; let busy = false;
    let lastPc: RTCPeerConnection | null | undefined;
    let sampler: VoiceQualitySampler | undefined;
    const report = async () => {
      if (disposed || busy || !socket.connected) return;
      const pc = getPeerConnection?.(); if (!pc || pc.connectionState!=="connected") return;
      if (pc !== lastPc) { lastPc = pc; sampler = new VoiceQualitySampler(++generation.current); }
      const currentSampler = sampler!;
      const current = () => !disposed && socket.connected && pc.connectionState==="connected" && getPeerConnection?.() === pc && sampler === currentSampler;
      busy = true;
      try {
        const stats = await pc.getStats(); if (!current()) return;
        const tracks = pc.getSenders().map(sender => sender.track).filter(track => track?.kind === "audio" && track.readyState === "live");
        const payload = currentSampler.sample(stats.values(), tracks.length === 1 ? tracks[0]?.id : undefined);
        await emitAuthenticated(socket, "voice:quality:report", { report: payload }, host, current);
      } catch { /* Absence of a report expires to unknown; never substitute zeros. */ }
      finally { busy = false; }
    };
    void report(); const timer = setInterval(() => { void report(); }, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [isConnected, host, channel, socket, getPeerConnection]);
}

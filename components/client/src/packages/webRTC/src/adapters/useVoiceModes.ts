import { useEffect, useRef } from "react";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";

import { useSquadSnapshot } from "../../../../lib/squadRuntime";
import { useMicrophone, useSFU } from "../../../../lib/voiceFacade";
import { deriveVoiceMode } from "../../../../lib/voiceMode";
import { acceptVoiceMode, clearVoiceModes, pruneVoiceModes, publishLocalVoiceMode } from "../../../../lib/voiceModeStore";

/** Channel-only semantic diagnostics. No keys, process names, paths or events. */
export function useVoiceModes() {
  const s = useSettings();
  const squad = useSquadSnapshot();
  const { isPttActive, transmissionState } = useMicrophone(false);
  const { currentServerConnected: host, currentChannelConnected: room, isConnected } = useSFU();
  const { sockets, clients } = useSockets();
  const latest = useRef({ s, squad, isPttActive, transmissionState, clients });
  latest.current = { s, squad, isPttActive, transmissionState, clients };
  const sequence = useRef(0);
  const socket = host ? sockets[host] : undefined;

  useEffect(() => {
    if (!socket || !host || !room || !isConnected) return;
    let supported = false, cancelled = false;
    let last = "", at = 0;
    const receive = (value: unknown) => acceptVoiceMode(host, value, latest.current.clients[host] ?? {}, room);
    const fetch = () => socket.timeout(1500).emit("voice:mode:fetch", {}, (error: Error | null, values: unknown) => {
      if (!cancelled && !error && Array.isArray(values)) values.forEach(receive);
    });
    const probe = () => {
      supported = false; clearVoiceModes(host); last = ""; at = 0;
      socket.timeout(1500).emit("voice:mode:capabilities", {}, (error: Error | null, value: { v?: number; supported?: boolean }) => {
        if (cancelled || error || value?.v !== 1 || value?.supported !== true) return;
        supported = true; fetch(); publish();
      });
    };
    const publish = () => {
      const { s: prefs, squad: local, isPttActive: ptt, transmissionState: gate } = latest.current;
      const semantic = deriveVoiceMode({ inputMode: prefs.inputMode, pttActive: ptt.current,
        manualMuted: prefs.isMuted || prefs.isDeafened, serverMuted: prefs.isServerMuted || prefs.isServerDeafened,
        squadEnabled: prefs.squadConfig.enabled, squadStatus: local.status, gateStatus: gate.status,
        requestedSuppression: local.suppressed });
      publishLocalVoiceMode({ ...semantic, seq: 0 });
      if (!supported || !socket.connected) return;
      const serialized = JSON.stringify(semantic);
      if (serialized === last && Date.now() - at < 2000) return;
      last = serialized; at = Date.now();
      socket.emit("voice:mode:set", { ...semantic, seq: ++sequence.current });
    };
    const disconnected = () => { supported = false; clearVoiceModes(host); };
    socket.on("voice:mode", receive); socket.on("disconnect", disconnected); socket.on("connect", probe);
    const timer = setInterval(publish, 150);
    probe();
    return () => {
      cancelled = true; clearInterval(timer); socket.off("voice:mode", receive);
      socket.off("disconnect", disconnected); socket.off("connect", probe); clearVoiceModes(host);
    };
  }, [socket, host, room, isConnected]);

  useEffect(() => {
    if (host && room) pruneVoiceModes(host, clients[host] ?? {}, room);
  }, [host, room, clients]);
}

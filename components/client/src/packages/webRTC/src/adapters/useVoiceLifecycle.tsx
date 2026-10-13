import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { ServerErrorToast, serverIconSrc, useUserId } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import {diagnosticCode, localDiagnostic} from "../../../../lib/localDiagnostics";
import { VoiceConnectionCuePolicy } from "../../../../lib/voiceAnnouncements";
import { cancelVoiceAnnouncements, useVoiceSounds } from "./useVoiceSounds";

/**
 * The parts of a voice call that are the app's business rather than the engine's:
 * they need the server list, the DOM, or a decision about what to hear.
 */
export function useVoiceLifecycle() {
  const {
    connectionError,
    connectionState,
    currentServerConnected,
    currentChannelConnected,
    disconnect,
  } = useSFU();
  const { servers, currentlyViewingServer } = useServerManagement();
  const { serverDetailsList, sockets } = useSockets();
  const { announce } = useVoiceSounds();
  const userId = useUserId();
  const settings = useSettings();
  const cuePolicy = useRef(new VoiceConnectionCuePolicy());
  const cueSerial = useRef(0);
  type MoveCue = { host: string; source: string; channel: string; requestId: string; account: string; generation: string; epoch: number; promoted: boolean };
  const moveCue = useRef<MoveCue | undefined>(undefined);
  const [moveRevision, setMoveRevision] = useState(0);
  const liveRoom = JSON.stringify([userId, currentServerConnected, currentChannelConnected]);
  const cueScope = connectionState === SFUConnectionState.DISCONNECTED ? JSON.stringify([userId, "disconnected"]) : liveRoom;
  const socketGeneration = sockets?.[currentServerConnected]?.id;
  const epoch = useRef({ identity: "", terminal: true, value: 0 });
  const identity = JSON.stringify([userId, currentServerConnected, socketGeneration]);
  const terminal = connectionState === SFUConnectionState.DISCONNECTED;
  if (epoch.current.identity !== identity || (terminal && !epoch.current.terminal)) epoch.current.value++;
  epoch.current.identity = identity; epoch.current.terminal = terminal;
  const live = useRef({ room: liveRoom, state: connectionState, host: currentServerConnected, channel: currentChannelConnected, account: userId, generation: socketGeneration, epoch: epoch.current.value });
  live.current = { room: liveRoom, state: connectionState, host: currentServerConnected, channel: currentChannelConnected, account: userId, generation: socketGeneration, epoch: epoch.current.value };
  const pending = moveCue.current;
  if (pending && (terminal || pending.epoch !== epoch.current.value ||
    (currentChannelConnected !== pending.source && currentChannelConnected !== pending.channel))) moveCue.current = undefined;
  // Cancel decoding as well as playback before new-room phrases enter the queue.
  useEffect(() => {
    cancelVoiceAnnouncements();
    return cancelVoiceAnnouncements;
  }, [cueScope, connectionState, socketGeneration]);
  useEffect(() => {
    cuePolicy.current.reset(); cancelVoiceAnnouncements();
  }, [userId]);
  useEffect(() => {
    cancelVoiceAnnouncements();
  }, [settings.isMuted, settings.isDeafened, settings.isServerDeafened, settings.outputDeviceID, settings.outputVolume,
    settings.peerVoiceCues.dnd, settings.peerVoiceCues.enabled, settings.peerVoiceCues.joinVolume, settings.peerVoiceCues.leaveVolume,
    settings.connectSoundEnabled, settings.disconnectSoundEnabled, settings.connectSoundVolume, settings.disconnectSoundVolume,
    settings.customConnectSoundFile, settings.customDisconnectSoundFile, settings.voiceAnnouncements]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ host: string; source: string; channel: string; requestId: string; account: string; generation: string; phase: "promoting" | "promoted" | "failed" }>).detail;
      const current = live.current;
      if (!detail?.requestId || !detail.generation || detail.host !== current.host || detail.account !== current.account ||
        detail.generation !== current.generation || current.state === SFUConnectionState.DISCONNECTED) return;
      if (detail.phase === "promoting") {
        if (current.state !== SFUConnectionState.CONNECTED || current.channel !== detail.source) return;
        moveCue.current = { ...detail, epoch: current.epoch, promoted: false };
      } else {
        const cue = moveCue.current;
        if (!cue || cue.requestId !== detail.requestId || cue.epoch !== current.epoch ||
          cue.source !== detail.source || cue.channel !== detail.channel) return;
        if (detail.phase === "failed") moveCue.current = undefined;
        else if (detail.phase === "promoted") cue.promoted = true;
        else return;
      }
      setMoveRevision(revision => revision + 1);
    };
    window.addEventListener("voice_move_playback_status", handler);
    return () => window.removeEventListener("voice_move_playback_status", handler);
  }, []);
  useEffect(() => {
    localDiagnostic({phase: "socket", operation: "voice-state", action: "finish", code: diagnosticCode(connectionState)});
    if (connectionError) {
      const code = connectionError === "Media policy changed; reconnecting" ? "media-policy-changed" :
        connectionError === "Connection lost" ? "connection-lost" : diagnosticCode(connectionError);
      localDiagnostic({phase: "socket", operation: "voice-state", action: "receive", code});
    }
  }, [connectionState, connectionError]);

  // The connect sound. The engine used to play it partway through the flow; it
  // now plays when the call is actually up.
  // Whether this call ever came up, which `wasConnected` cannot answer — it
  // tracks the current state. "It dropped" and "it never connected" differ.
  const everConnected = useRef(false);
  useEffect(() => {
    const nowConnected = connectionState === SFUConnectionState.CONNECTED;
    const state = nowConnected ? "connected" : connectionState === SFUConnectionState.DISCONNECTED ? "disconnected" : "recovering";
    const cue = moveCue.current;
    const destination = cue && cue.channel === currentChannelConnected;
    // A destination state may render before commitMove's promise settles. Hold
    // its generic connection cue until that exact local promotion succeeds/fails.
    if (nowConnected && destination && !cue.promoted) return;
    const event = cuePolicy.current.update(liveRoom, state);
    if (nowConnected && destination && cue.promoted) {
      announce("moved", `${cue.generation}:${cue.requestId}`, () => live.current.room === liveRoom && live.current.epoch === cue.epoch && live.current.state === SFUConnectionState.CONNECTED);
      moveCue.current = undefined;
    } else if (event) {
      const serial = ++cueSerial.current;
      announce(event, `${liveRoom}:${serial}`, () => live.current.state === connectionState &&
        (event === "disconnected" || live.current.room === liveRoom));
    }
    if (nowConnected) everConnected.current = true;
  }, [connectionState, liveRoom, announce, moveRevision, currentServerConnected, currentChannelConnected]);
  const previousAudio = useRef({ muted: settings.isMuted, deafened: settings.isDeafened });
  useEffect(() => {
    const previous = previousAudio.current;
    previousAudio.current = { muted: settings.isMuted, deafened: settings.isDeafened };
    if (connectionState !== SFUConnectionState.CONNECTED) return;
    const eligible = () => live.current.room === liveRoom && live.current.state === SFUConnectionState.CONNECTED;
    if (previous.deafened !== settings.isDeafened) {
      announce(settings.isDeafened ? "outputMuted" : "outputUnmuted", `${liveRoom}:${++cueSerial.current}`, eligible);
    } else if (previous.muted !== settings.isMuted) {
      announce(settings.isMuted ? "microphoneMuted" : "microphoneUnmuted", `${liveRoom}:${++cueSerial.current}`, eligible);
    }
  }, [settings.isMuted, settings.isDeafened, connectionState, liveRoom, announce]);

  // A fresh call is a fresh verdict. Without this, one dropped call makes every
  // later failure in the session read as "it dropped".
  useEffect(() => {
    if (connectionState === SFUConnectionState.CONNECTING) everConnected.current = false;
  }, [connectionState]);

  /*
   * Where the call was, kept because the engine forgets before the toast runs:
   * giving up clears `serverId` and `roomId` in the same update.
   */
  const lastHost = useRef("");
  const lastChannelId = useRef("");
  useEffect(() => {
    if (currentServerConnected) lastHost.current = currentServerConnected;
    if (currentChannelConnected) lastChannelId.current = currentChannelConnected;
  }, [currentServerConnected, currentChannelConnected]);

  /*
   * Telling somebody the call dropped. **Only once the engine has stopped
   * trying**: DISCONNECTED, not FAILED, which still has retries left (GRYT-668).
   */
  useEffect(() => {
    if (!connectionError) return;
    if (connectionState !== SFUConnectionState.DISCONNECTED) return;

    const host = currentServerConnected || lastHost.current;
    const name = host ? servers[host]?.name || host : "";
    const channelId = currentChannelConnected || lastChannelId.current;
    // A refused call room is said by whoever started or answered the call.
    if (connectionError !== "reconnect-failed" && channelId.startsWith("dm_")) return;
    const channel = host
      ? serverDetailsList[host]?.channels?.find((c) => c.id === channelId)
      : undefined;

    /*
     * Which words. Gryt has no relay, so a network that will not carry a direct
     * path cannot carry a call — a guess that is only fair after every attempt.
     */
    const message =
      connectionError === "reconnect-failed"
        ? everConnected.current
          ? "The call dropped and could not be picked back up. Try joining again."
          : "Could not reach the voice server after several attempts. This network " +
            "may not allow voice traffic through, which is common on mobile data."
        : connectionError;

    if (!host) {
      toast.error(message, { id: "voice-connection", duration: 8000 });
      return;
    }

    toast.error(
      <ServerErrorToast
        iconSrc={serverIconSrc(host, name, serverDetailsList)}
        seed={name}
        serverName={name}
        channelName={channel?.name}
        message={message}
      />,
      { id: "voice-connection", duration: 8000 },
    );
  }, [
    connectionError,
    connectionState,
    currentServerConnected,
    currentChannelConnected,
    servers,
    serverDetailsList,
  ]);

  // Leaving a server while in one of its voice channels should end the call.
  // This reads the whole server map, which is what the engine is kept away from.
  useEffect(() => {
    // Any state but DISCONNECTED, not just CONNECTED: a call waiting on a socket
    // that is never coming back holds the microphone open (GRYT-1322).
    if (connectionState === SFUConnectionState.DISCONNECTED) return;
    if (!currentServerConnected) return;
    if (currentlyViewingServer?.host === currentServerConnected) return;
    if (servers[currentServerConnected]) return;
    disconnect().catch((error) => {
      console.error("[Voice] Error disconnecting from a removed server:", error);
    });
  }, [servers, currentServerConnected, connectionState, currentlyViewingServer?.host, disconnect]);

  // The server hanging up on us, which it does when the same account takes the
  // channel on another device. useSocketEvents raises this from three places.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ host?: string; reason?: string }>).detail;

      // Being kicked from one server should not drop a call on another. The
      // host has always been in the payload; the old code did this check too.
      if (detail?.host && currentServerConnected && detail.host !== currentServerConnected) {
        return;
      }

      disconnect().catch((error) => {
        console.error("[Voice] Error during server-initiated disconnect:", error);
      });

      // The UI moves the person to the text channel and says why.
      window.dispatchEvent(
        new CustomEvent("voice_disconnect_text_switch", { detail }),
      );
    };

    window.addEventListener("server_voice_disconnect", handler);
    return () => window.removeEventListener("server_voice_disconnect", handler);
  }, [currentServerConnected, disconnect]);
}

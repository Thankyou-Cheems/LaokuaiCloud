import { useCamera, useScreenShare } from "@gryt/voice";
import { useCallback, useEffect, useState } from "react";

import type { Client } from "../types/clients";

interface RoomMediaParams {
  serverHost?: string;
  currentServerConnected: string | null;
  currentChannelId?: string;
  currentConnectionId?: string;
  clientsForHost: Record<string, Client>;
  videoStreams?: Record<string, MediaStream>;
}

function liveVideo(stream?: MediaStream | null): boolean {
  return Boolean(stream?.getVideoTracks().some(track => track.readyState === "live" && track.enabled && !track.muted));
}

/** Announcements alone are not media: loading/failed/ended routes leave the chat its room. */
export function useRoomMedia({ serverHost, currentServerConnected, currentChannelId,
  currentConnectionId, clientsForHost, videoStreams }: RoomMediaParams): boolean {
  const { cameraEnabled, cameraStream, cameraError } = useCamera();
  const { screenShareActive, screenVideoStream } = useScreenShare();
  const calculate = useCallback(() => {
    if (!serverHost || currentServerConnected !== serverHost || !currentChannelId) return false;
    const peers = Object.entries(clientsForHost).filter(([id, client]) => id !== currentConnectionId && client.voiceChannelId === currentChannelId);
    if ((cameraEnabled && !cameraError && liveVideo(cameraStream)) || (screenShareActive && liveVideo(screenVideoStream))) return true;
    const claimed = new Set(Object.values(clientsForHost).flatMap(client => [client.cameraStreamID, client.screenShareVideoStreamID]).filter(Boolean));
    // Same legacy camera fallback as VoiceView: an announced camera whose old id
    // is absent can use an unclaimed live SFU video stream from this connection.
    const unclaimedCamera = Object.entries(videoStreams ?? {}).some(([id, stream]) => !claimed.has(id) && liveVideo(stream));
    return peers.some(([, client]) => Boolean(
      (client.screenShareEnabled && liveVideo(videoStreams?.[client.screenShareVideoStreamID ?? ""])) ||
      (client.cameraEnabled && (liveVideo(videoStreams?.[client.cameraStreamID ?? ""]) || unclaimedCamera))
    ));
  }, [serverHost, currentServerConnected, currentChannelId, currentConnectionId, clientsForHost,
    videoStreams, cameraEnabled, cameraStream, cameraError, screenShareActive, screenVideoStream]);
  const [, refresh] = useState(calculate);
  useEffect(() => {
    const streams = [...new Set([cameraStream, screenVideoStream, ...Object.values(videoStreams ?? {})].filter((stream): stream is MediaStream => Boolean(stream)))];
    const tracks = streams.flatMap(stream => stream.getVideoTracks());
    const update = () => refresh(calculate());
    update();
    for (const stream of streams) for (const event of ["addtrack", "removetrack"]) stream.addEventListener(event, update);
    for (const track of tracks) for (const event of ["ended", "mute", "unmute"]) track.addEventListener(event, update);
    // MediaStreamTrack.stop()/enabled changes do not emit ended; no render when
    // the boolean is unchanged, and no timer when there are no video tracks.
    const timer = streams.length ? window.setInterval(update, 250) : undefined;
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      for (const stream of streams) for (const event of ["addtrack", "removetrack"]) stream.removeEventListener(event, update);
      for (const track of tracks) for (const event of ["ended", "mute", "unmute"]) track.removeEventListener(event, update);
    };
  }, [calculate, cameraStream, screenVideoStream, videoStreams]);
  return calculate();
}

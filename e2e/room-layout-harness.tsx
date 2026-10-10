import "../src/style.css";

import { VoiceConfigProvider } from "@gryt/voice";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { publishLocalVoiceMode } from "../src/lib/voiceModeStore";
import { registrations } from "../src/packages/common/src/hooks/singletonHook";
import { setLanguagePreference } from "../src/packages/i18n";
import { ChannelDescription } from "../src/packages/socket/src/components/ChannelDescription";
import { WelcomeMessage } from "../src/packages/socket/src/components/ChatMessage";
import { ConnectedUser } from "../src/packages/socket/src/components/connectedUser";
import { RoomCallBar } from "../src/packages/socket/src/components/RoomCallBar";
import { ServerSidebar } from "../src/packages/socket/src/components/ServerSidebar";
import { VoiceSheetButton } from "../src/packages/socket/src/components/VoiceSheetButton";
import { VoiceView } from "../src/packages/socket/src/components/VoiceView";
import { useChannelSidebarWidth } from "../src/packages/socket/src/hooks/useChannelSidebarWidth";
import type { Client } from "../src/packages/socket/src/types/clients";
import { useVoiceConfigFromSettings } from "../src/packages/webRTC/src/adapters/voiceConfig";
void setLanguagePreference("zh-CN");
publishLocalVoiceMode({ v: 1, seq: 1, inputMode: "voice_activity", squad: "armed", transmit: "ready" });
const noop = () => {};
const base: Client = { nickname: "老蒯", color: "purple", streamID: "mic", isMuted: false, isDeafened: false, isAFK: false, hasJoinedChannel: true, voiceChannelId: "room" };
export function Harness() {
  const config = useVoiceConfigFromSettings([]);
  const sizing = useChannelSidebarWidth();
  const contentRef = useRef<HTMLDivElement>(null);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [peer, setPeer] = useState<Client>({ ...base, nickname: "队友", serverUserId: "peer" });
  const [leaves, setLeaves] = useState(0);
  const heldStream = useRef<MediaStream | null>(null);
  const heldTrack = useRef<MediaStreamTrack | null>(null);
  const syntheticCanvas = useRef<HTMLCanvasElement | null>(null);
  const frameTimer = useRef<number | undefined>(undefined);
  const retainFrames = (canvas: HTMLCanvasElement) => {
    syntheticCanvas.current = canvas;
    window.clearInterval(frameTimer.current);
    frameTimer.current = window.setInterval(() => canvas.getContext("2d")!.fillRect(0, 0, 10, 10), 100);
  };
  const clients = { self: base, peer };
  const voice = { serverHost: "synthetic-room", currentServerConnected: "synthetic-room", currentChannelId: "room", currentConnectionId: "self", isConnecting: false, clientsSpeaking: {}, clientsForHost: clients, videoStreams: streams };
  const start = (kind: "camera" | "screen", other = false) => {
    Object.values(streams).forEach(stream => stream.getTracks().forEach(track => track.stop()));
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d")!; context.fillStyle = "#356d79"; context.fillRect(0, 0, 320, 180);
    const stream = canvas.captureStream(10);
    retainFrames(canvas);
    setStreams({ [stream.id]: stream });
    setPeer({ ...peer, voiceChannelId: other ? "other" : "room", cameraEnabled: kind === "camera", cameraStreamID: kind === "camera" ? stream.id : undefined, screenShareEnabled: kind === "screen", screenShareVideoStreamID: kind === "screen" ? stream.id : undefined });
  };
  const narrow = new URLSearchParams(location.search).has("narrow");
  return <VoiceConfigProvider config={config}>
    <div className="gryt-app" data-gryt="server-view" style={{ display: "flex", flexDirection: "column", height: "calc(100dvh / var(--gryt-ui-scale, 1) - 48px)", minHeight: 0, position: "relative", gap: 8, padding: 8 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 8, overflow: "hidden" }}>
        {!narrow && <ServerSidebar sidebarOpen sidebarWidthPx={sizing.width} resizing={sizing.dragging} resizeHandle={sizing.resizeHandle} hoverPx={8} contentRef={contentRef}
          isUnreachableWhileConnected={false} onMouseLeave={noop} serverName="老蒯的服务器" serverRole="owner" pinned onTogglePinned={noop} onOpenSettings={noop} onOpenInvites={noop} onOpenReports={noop} pendingReportCount={0} updateAvailable={false} onLeave={noop}
          channels={[{ id: "room", name: "开黑语音", type: "voice", clients: ["self", "peer"] }]} sidebarItems={[]} serverHost="synthetic-room" clients={clients} members={[]} currentChannelId="room" currentServerConnected="synthetic-room"
          showVoiceView={false} isConnecting={false} currentConnectionId="self" selectedChannelId="room" onChannelClick={noop} clientsSpeaking={{ self: true }} canManage={false}
          onEditItem={noop} onDeleteItem={noop} onMoveItem={noop} onReorder={noop} onAddItem={noop} onDisconnectUser={undefined} currentUserRole="owner" adminActions={undefined} />}
        {!narrow && <VoiceView showVoiceView voiceWidth={`${Math.min(600, innerWidth * 0.45)}px`} {...voice} />}
        <div data-gryt="conversation-pane" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>开黑聊天 <ChannelDescription text="频道说明很长，使用鼠标或键盘查看完整说明，而不是挤占聊天宽度。" /></h2>
          <WelcomeMessage channelName="开黑聊天" />
          <div style={{ width: 240 }} data-testid="member-pane">
            <ConnectedUser nickname="老蒯和队友的很长昵称" serverUserId="synthetic-member" serverHost="synthetic-room" isSelf isSpeaking isMuted={false} isDeafened={false} isAFK={false} />
            <ConnectedUser nickname="短名" serverUserId="short" serverHost="synthetic-room" isSpeaking={false} isMuted isDeafened={false} isAFK={false} />
          </div>
          {narrow && <VoiceSheetButton connected {...voice} />}
        </div>
      </div>
      <RoomCallBar onDisconnect={() => setLeaves(value => value + 1)} />
    </div>
    <div data-testid="fixture-tools" style={{ height: 48, overflow: "auto" }}>
      <button onClick={() => start("camera")}>camera</button><button onClick={() => start("screen")}>screen</button><button onClick={() => start("camera", true)}>other-room</button>
      <button onClick={() => { setStreams({}); setPeer({ ...peer, cameraEnabled: true, cameraStreamID: "missing" }); }}>failed</button>
      <button onClick={() => Object.values(streams).forEach(stream => stream.getTracks().forEach(track => track.stop()))}>stop-track</button>
      <button onClick={() => { setPeer({ ...peer, cameraEnabled: false, screenShareEnabled: false }); setStreams({}); }}>remove</button>
      <button onClick={() => {
        const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
        canvas.getContext("2d")!.fillRect(0, 0, 64, 64);
        heldTrack.current = canvas.captureStream(10).getVideoTracks()[0];
        retainFrames(canvas);
        heldStream.current = new MediaStream();
        setStreams({ [heldStream.current.id]: heldStream.current });
        setPeer({ ...peer, voiceChannelId: "room", cameraEnabled: true, cameraStreamID: heldStream.current.id, screenShareEnabled: false });
      }}>empty-stream</button>
      <button onClick={() => {
        if (heldStream.current && heldTrack.current) {
          heldStream.current.addTrack(heldTrack.current);
          heldStream.current.dispatchEvent(new MediaStreamTrackEvent("addtrack", { track: heldTrack.current }));
        }
      }}>add-track</button>
      <button onClick={() => publishLocalVoiceMode({ v: 1, seq: 2, inputMode: "voice_activity", squad: "suppressed", transmit: "ready" })}>suppressed-ack</button>
      <output data-testid="leave-count">{leaves}</output>
    </div>
  </VoiceConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<>{registrations.filter(entry => entry.useBody.name === "useSettingsHook").map(entry => entry.render())}<Harness /></>);

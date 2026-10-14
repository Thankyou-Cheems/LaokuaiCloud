/* eslint-disable react-refresh/only-export-components -- Standalone offline DOM fixture. */
import "../src/style.css";

import { VoiceConfigProvider } from "@gryt/voice";
import { Reorder } from "motion/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { registrations } from "../src/packages/common/src/hooks/singletonHook";
import { setServerAccessToken } from "../src/packages/common/src/utils/tokenStorage";
import { setLanguagePreference } from "../src/packages/i18n";
import { ConnectedUser } from "../src/packages/socket/src/components/connectedUser";
import { SidebarDragRow } from "../src/packages/socket/src/components/SidebarDragRow";
import { useVoiceMemberDrag } from "../src/packages/socket/src/components/useVoiceMemberDrag";
import { VoiceDraggableMember } from "../src/packages/socket/src/components/VoiceDraggableMember";
import type { VoiceDragSnapshot } from "../src/packages/socket/src/components/voiceMemberDragPolicy";
import { VoiceMemberDropZone } from "../src/packages/socket/src/components/VoiceMemberDropZone";
import type { Client } from "../src/packages/socket/src/types/clients";
import { useVoiceConfigFromSettings } from "../src/packages/webRTC/src/adapters/voiceConfig";

void setLanguagePreference("zh-CN");
const events = new Map<string, Set<(value?: unknown) => void>>();
const sent: { event: string; payload: Record<string, unknown> }[] = [];
const socket = { id: "actor-generation", connected: true,
  on(event: string, callback: (value?: unknown) => void) { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(callback); },
  off(event: string, callback: (value?: unknown) => void) { events.get(event)?.delete(callback); },
  emit(event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); window.dispatchEvent(new Event("fixture-request")); },
};
const reply = (event: string, value?: unknown) => { for (const callback of [...events.get(event) ?? []]) callback(value); };
// A synthetic, unverified JWT used solely by the real local send helper. No server is contacted.
setServerAccessToken("fixture-a", `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`);
const initialPeer: Client = { nickname: "队友", serverUserId: "peer", voiceChannelId: "source", hasJoinedChannel: true,
  voiceMoveStagingSupported: true, isMuted: false, isDeafened: false, isAFK: false, streamID: "", color: "blue" };

function Harness() {
  const config = useVoiceConfigFromSettings([]);
  const [revision, setRevision] = useState(0);
  const [peer, setPeer] = useState(initialPeer);
  const [mode, setMode] = useState("owner");
  const [enabled, setEnabled] = useState(true);
  const [destination, setDestination] = useState(true);
  const [destinationText, setDestinationText] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [sorts, setSorts] = useState(0);
  const [sortingDisabled, setSortingDisabled] = useState(false);
  const [shown, setShown] = useState(true);
  useEffect(() => { const changed = () => setRevision(value => value + 1); window.addEventListener("fixture-request", changed); return () => window.removeEventListener("fixture-request", changed); }, []);
  const channels = [{ id: "source", name: "原房间", type: "voice" as const },
    ...(destination ? [{ id: "destination", name: "目标房间", type: destinationText ? "text" as const : "voice" as const }] : []),
    { id: "text", name: "文本频道", type: "text" as const }];
  const snapshot: VoiceDragSnapshot = { host: "fixture-a", generation: socket.id, connected: socket.connected, enabled,
    canDisconnect: mode !== "member", role: mode, roles: [], members: new Map([["peer", { role: mode === "equal" ? "owner" : "member" }]]),
    channels, authoritativeChannels: channels,
    clients: { peerConnection: peer, ...(duplicate ? { secondDevice: { ...peer, voiceMoveStagingSupported: false } } : {}) },
  };
  const confirm = (status: string, wrong = false) => {
    const request = sent.findLast(value => value.event === "voice:move:user")?.payload;
    if (!request) return;
    reply("voice:move:result", { ...request, requestId: request.requestId, v: 1, generation: wrong ? "old-generation" : "peerConnection",
      status, sourceChannelId: "source", destinationChannelId: "destination", error: "fixture_failure" });
    setRevision(value => value + 1);
    if (status === "committed" && !wrong) setPeer(value => ({ ...value, voiceChannelId: "destination" }));
  };
  return <VoiceConfigProvider config={config}><div className="gryt-app" style={{ padding: 20 }}>
    <div style={{ display: "flex", gap: 24 }}>
      {shown && <DragRooms snapshot={snapshot} sortingDisabled={sortingDisabled} onClick={() => setClicks(value => value + 1)} onSort={() => setSorts(value => value + 1)} />}
      <DragRooms snapshot={{ ...snapshot, host: "fixture-b" }} sortingDisabled={sortingDisabled} onClick={() => setClicks(value => value + 1)} onSort={() => setSorts(value => value + 1)} />
    </div>
    <button onClick={() => confirm("committed")}>commit</button><button onClick={() => confirm("failed")}>fail</button><button onClick={() => confirm("committed", true)}>wrong-generation</button>
    <button onClick={() => setEnabled(false)}>disable-server</button><button onClick={() => setMode("member")}>ordinary-member</button>
    <button onClick={() => setMode("equal")}>equal-rank</button><button onClick={() => setDestination(false)}>remove-destination</button>
    <button onClick={() => setDestinationText(true)}>text-destination</button>
    <button onClick={() => setDuplicate(true)}>second-device</button><button onClick={() => setPeer({ ...peer, voiceChannelId: "destination" })}>server-moved</button>
    <button onClick={() => { socket.id = "new-generation"; setRevision(value => value + 1); }}>replace-socket</button>
    <button onClick={() => { socket.connected = false; reply("disconnect"); setRevision(value => value + 1); }}>disconnect</button>
    <button onClick={() => setShown(false)}>unmount</button>
    <button onClick={() => setSortingDisabled(true)}>disable-sorting</button>
    <output data-testid="sent">{JSON.stringify(sent.map(value => ({ event: value.event, payload: { ...value.payload, accessToken: undefined } })))}</output>
    <output data-testid="revision">{revision}</output><output data-testid="clicks">{clicks}</output><output data-testid="sorts">{sorts}</output>
    <output data-testid="actor-room">source</output><output data-testid="listeners">{[...events.values()].reduce((sum, set) => sum + set.size, 0)}</output>
    <Toaster />
  </div></VoiceConfigProvider>;
}
function DragRooms({ snapshot, onClick, onSort, sortingDisabled }: { snapshot: VoiceDragSnapshot; onClick: () => void; onSort: () => void; sortingDisabled: boolean }) {
  const drag = useVoiceMemberDrag(snapshot, socket as unknown as Socket);
  return <section data-testid={snapshot.host} style={{ width: 280 }}>
    <Reorder.Group as="div" axis="y" values={snapshot.channels} onReorder={onSort}>
    {snapshot.channels.map(channel => <SidebarDragRow as="div" value={channel} key={channel.id} onDragStart={onSort} drag={sortingDisabled ? false : undefined}
      style={{ padding: 10, marginBottom: 24, border: "1px solid gray", minHeight: 60 }}>
      <VoiceMemberDropZone drag={drag} channelId={channel.id} channelName={channel.name}>
      <button onClick={onClick}>{channel.name}</button>
      {snapshot.clients.peerConnection.voiceChannelId === channel.id && <VoiceDraggableMember drag={drag} clientId="peerConnection">
        <ConnectedUser serverHost={snapshot.host} serverUserId="peer" nickname="队友" isSpeaking={false} isMuted={false} isDeafened={false} isAFK={false} />
        <button data-testid="volume-control" onClick={onClick}>Volume control</button>
      </VoiceDraggableMember>}
      </VoiceMemberDropZone>
    </SidebarDragRow>)}
    </Reorder.Group>
  </section>;
}
createRoot(document.getElementById("root")!).render(<>{registrations.filter(entry => entry.useBody.name === "useSettingsHook").map(entry => entry.render())}<Harness /></>);

import "../src/style.css";

import { GrytUiI18nProvider, grytUiZhCN } from "@gryt/ui/i18n";
import type { ReceiveAutoLevelIdentity } from "@gryt/voice";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";

import { RECEIVE_CORRECTION_LABELS_EN,RECEIVE_CORRECTION_LABELS_ZH } from "../src/lib/receiveCorrection";
import { ReceiveCorrectionRegistry } from "../src/lib/receiveCorrectionRegistry";
import { registrations } from "../src/packages/common/src/hooks/singletonHook";
import { setLanguagePreference, useTranslation } from "../src/packages/i18n";
import { useSettings } from "../src/packages/settings";
import { ProfileEditor } from "../src/packages/settings/src/components/profileSettings";
import { loadAudioFromCache } from "../src/packages/settings/src/hooks/useAudioSettings";
import { loadForUser } from "../src/packages/settings/src/hooks/userStorage";
import { ReceiveCorrectionRing } from "../src/packages/socket/src/components/ReceiveCorrectionRing";
import { RemoteReceiveCorrection } from "../src/packages/socket/src/components/RemoteReceiveCorrection";
import { VoiceModeGlyph } from "../src/packages/socket/src/components/VoiceModeIcon";
import { ReceiveCorrectionProvider } from "../src/packages/webRTC/src/components/ReceiveCorrectionAdapter";
import { ReceiveLevelingProvider } from "../src/packages/webRTC/src/components/ReceiveLevelingAdapter";
import { VoiceAudioControls } from "../src/packages/webRTC/src/components/VoiceAudioControls";

/** Synthetic external SDK boundary; production registry and display are real. */
function TelemetryFixture() {
  const [fixture] = useState(() => {
    const registry = new ReceiveCorrectionRegistry();
    let identity: ReceiveAutoLevelIdentity | undefined;
    let sequence = 0;
    const track = { id: "fixture-physical-track", readyState: "live" };
    const control = { setRole() {}, setMuted() {}, dispose() {}, setIdentity(value: ReceiveAutoLevelIdentity | undefined) { identity = value; } };
    const sources = { primary: { receiveCleanup: control, stream: { mediaStream: { getAudioTracks: () => [track] } } } };
    const bind = () => registry.reconcile({ host: "fixture-server", connected: true, sources, clients: [{ serverUserId: "fixture-member", streamID: "primary" }] });
    const emit = (mode: "normal" | "pause" | "limited" | "unavailable") => {
      if (!identity) return;
      registry.acceptBatch({ kind: "receive-auto-levels", schemaVersion: 1, snapshots: [{ ...identity,
        sequence: ++sequence, audioTimeSeconds: sequence / 5, status: mode === "limited" ? "limited" : mode === "unavailable" ? "unavailable" : "settled",
        limitReasons: mode === "limited" ? ["noise_budget"] : mode === "unavailable" ? ["unsupported_sample_rate"] : [],
        learnedAutoGainDb: mode === "unavailable" ? null : 7.4, appliedAutoGainDb: mode === "unavailable" ? null : mode === "pause" ? 0 : 6.2,
        targetAutoGainDb: mode === "unavailable" ? null : 7.4, acceptedSpeechSeconds: 8, speechWindowSeconds: 5,
        estimatorReliability: mode === "unavailable" ? "invalid" : "established", compressionGainReductionDb: 3 }] });
    };
    return { registry, bind, emit, track };
  });
  useLayoutEffect(() => { fixture.bind(); return () => fixture.registry.clear(); }, [fixture]);
  const readings = useSyncExternalStore(fixture.registry.subscribe, fixture.registry.getSnapshot);
  return <ReceiveCorrectionProvider value={readings}>
    <button onClick={() => fixture.emit("normal")}>Telemetry measured</button>
    <button onClick={() => fixture.emit("pause")}>Telemetry pause</button>
    <button onClick={() => fixture.emit("limited")}>Telemetry limited</button>
    <button onClick={() => fixture.emit("unavailable")}>Telemetry unavailable</button>
    <button onClick={() => { fixture.track.id = "fixture-replacement-track"; fixture.bind(); }}>Telemetry replace track</button>
    <button onClick={() => fixture.registry.acceptBatch({ kind: "receive-auto-levels", schemaVersion: 1, snapshots: [] })}>Telemetry missing</button>
    <div data-testid="bound-correction"><RemoteReceiveCorrection host="fixture-server" member="fixture-member" streamId="primary" /></div>
    <div data-testid="other-server-correction"><RemoteReceiveCorrection host="other-server" member="fixture-member" streamId="primary" /></div>
  </ReceiveCorrectionProvider>;
}

export function Harness() {
  const { i18n } = useTranslation();
  const prefs = useSettings();
  const applyAudio = useRef(prefs.applyAudioData);
  applyAudio.current = prefs.applyAudioData;
  const [ready, setReady] = useState(false);
  useEffect(() => { void loadForUser("INTEGRATION_SYNTHETIC_USER").then(() => {
    applyAudio.current(loadAudioFromCache()); setReady(true);
  }); }, []);
  const [scope, setScope] = useState<"default" | "a">("default");
  const [names, setNames] = useState({ default: "Fixture D", a: "Fixture A" });
  const [runtime, setRuntime] = useState<"active" | "degraded" | "suspended">("active");
  const [ack, setAck] = useState(false);
  return <GrytUiI18nProvider locale={i18n.resolvedLanguage} labels={i18n.resolvedLanguage === "zh-CN" ? grytUiZhCN : undefined}>
    <div className="gryt-app p-3 max-w-full">
      <output data-testid="ready">{String(ready)}</output>
      <button onClick={() => void setLanguagePreference("zh-CN")}>Chinese</button>
      <button onClick={() => void setLanguagePreference("en")}>English</button>
      <button onClick={() => setScope("default")}>Default scope</button>
      <button onClick={() => setScope("a")}>Server A scope</button>
      <ProfileEditor key={scope} nickname={names[scope]} avatarUrl={null} initial="F" uploading={false} removing={false}
        scopedToServer={scope === "a" ? "Fixture Server A" : undefined}
        onSaveNickname={async name => {
          if (scope === "a") throw new Error("nickname-rejected");
          setNames(old => ({ ...old, default: name }));
        }} onPickAvatar={() => {}} onRemoveAvatar={() => {}} />
      <output data-testid="names">{JSON.stringify(names)}</output>
      <ReceiveLevelingProvider value={{ available: true, enabled: prefs.receiveLevelingEnabled,
        runtime, reason: runtime === "degraded" ? "worklet-unavailable" : undefined, latencyMs: runtime === "degraded" ? 0 : 6,
        setEnabled: prefs.setReceiveLevelingEnabled }}>
        <div data-testid="row"><VoiceAudioControls /></div>
        <div data-testid="capsule"><VoiceAudioControls direction="column" /></div>
      </ReceiveLevelingProvider>
      <button onClick={() => setRuntime("degraded")}>Degraded fixture</button>
      <button onClick={() => setRuntime("suspended")}>Suspend fixture</button>
      <output data-testid="volumes">{JSON.stringify({ mic: prefs.micVolume, output: prefs.outputVolume, muted: prefs.isMuted, deafened: prefs.isDeafened })}</output>
      <button onClick={() => setAck(true)}>Gate ACK</button>
      <VoiceModeGlyph state={{ v: 1, seq: 0, inputMode: "voice_activity", squad: ack ? "suppressed" : "armed", transmit: ack ? "squad-suppressed" : "pending" }} />
      <div data-testid="real-correction"><RemoteReceiveCorrection /></div>
      <div data-testid="fixture-correction"><ReceiveCorrectionRing learnedAutoGainDb={3.2} appliedAutoGainDb={ack ? 0 : 3.2} state="stable" labels={i18n.resolvedLanguage === "zh-CN" ? RECEIVE_CORRECTION_LABELS_ZH : RECEIVE_CORRECTION_LABELS_EN} /></div>
      <TelemetryFixture />
      <Toaster />
    </div>
  </GrytUiI18nProvider>;
}
createRoot(document.getElementById("root")!).render(<>{registrations.filter(entry => entry.useBody.name === "useSettingsHook").map(entry => entry.render())}<Harness /></>);

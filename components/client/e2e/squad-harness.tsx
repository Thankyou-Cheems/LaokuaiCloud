import "../src/style.css";

import type { TransmissionState } from "@gryt/voice";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SquadSnapshot } from "../src/lib/squadMode";
import { deriveVoiceMode } from "../src/lib/voiceMode";
import { setLanguagePreference } from "../src/packages/i18n";
import { SquadControl } from "../src/packages/settings/src/components/squadSettings";
import { loadAudioFromCache, useAudioSettings } from "../src/packages/settings/src/hooks/useAudioSettings";
import { loadForUser } from "../src/packages/settings/src/hooks/userStorage";
import { VoiceModeGlyph } from "../src/packages/socket/src/components/VoiceModeIcon";

export function Harness() {
  const prefs = useAudioSettings();
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SquadSnapshot>({ status: "standby", gateEnabled: false, suppressed: false, heldCount: 0, global: false });
  const [gate, setGate] = useState<TransmissionState>({ status: "disabled", generation: 0 });
  const [unknown, setUnknown] = useState(false);
  useEffect(() => {
    void loadForUser("SQUAD_FIXTURE_USER").then(() => { prefs.applyAudioData(loadAudioFromCache()); setReady(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const semantic = deriveVoiceMode({ inputMode: prefs.inputMode, pttActive: false, manualMuted: prefs.isMuted,
    serverMuted: prefs.isServerMuted, squadEnabled: prefs.squadConfig.enabled, squadStatus: state.status,
    gateStatus: gate.status, requestedSuppression: state.suppressed });
  return <div className="gryt-app p-4">
    <output data-testid="ready">{String(ready)}</output>
    <SquadControl config={prefs.squadConfig} onChange={config => { prefs.setSquadConfig(config); if (!config.enabled) setState({ ...state, status: "off", gateEnabled: false, suppressed: false }); }}
      otherKeys={["Ctrl+KeyM"]} state={state} transmission={gate} retry={() => setGate({ status: "ready", generation: 2 })} />
    <VoiceModeGlyph state={unknown ? null : { ...semantic, seq: 0 }} />
    <button onClick={() => { setState({ ...state, status: "suppressed", suppressed: true, gateEnabled: true, heldCount: 1 }); setGate({ status: "recovering", reason: "awaiting-suppression-ack", generation: 1 }); }}>Request</button>
    <button onClick={() => setGate({ status: "suppressed", generation: 1 })}>ACK</button>
    <button onClick={() => { setState({ ...state, status: "armed", suppressed: false, gateEnabled: true, heldCount: 0 }); setGate({ status: "recovering", generation: 2 }); }}>Fresh recovery</button>
    <button onClick={() => setGate({ status: "failed", reason: "pipeline-error", generation: 2 })}>Failure</button>
    <button onClick={() => prefs.setIsMuted(true)}>Manual mute</button>
    <button onClick={() => setUnknown(true)}>Old peer</button>
    <button onClick={() => void setLanguagePreference("zh-CN")}>Chinese</button>
    <button onClick={() => void setLanguagePreference("en")}>English</button>
    <output className="block break-all text-xs" data-testid="config">{JSON.stringify(prefs.squadConfig)}</output>
    <output className="block break-all text-xs" data-testid="other-audio">{JSON.stringify({ compressor: prefs.compressorEnabled, amount: prefs.compressorAmount, rn: prefs.rnnoiseEnabled, agc: prefs.autoGainEnabled, mic: prefs.micVolume, gate: prefs.noiseGate, esports: prefs.eSportsModeEnabled })}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

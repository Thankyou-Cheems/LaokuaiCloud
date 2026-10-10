/* eslint-disable react-refresh/only-export-components -- Standalone headless fixture root. */
import "../src/style.css";

import { VoiceConfigProvider } from "@gryt/voice";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { useOverlayViewportBounds } from "../src/lib/useOverlayViewportBounds";
import { registrations } from "../src/packages/common/src/hooks/singletonHook";
import { setLanguagePreference } from "../src/packages/i18n";
import { useSettings } from "../src/packages/settings";
import { UpdatesSettings } from "../src/packages/settings/src/components/aboutSettings";
import { Settings } from "../src/packages/settings/src/components/settings";
import { ConfirmDialog } from "../src/packages/socket/src/components/ConfirmDialog";
import { ConnectedUser } from "../src/packages/socket/src/components/connectedUser";
import { ReceiveCorrectionRing } from "../src/packages/socket/src/components/ReceiveCorrectionRing";
import { RoomCallBar } from "../src/packages/socket/src/components/RoomCallBar";
import { useVoiceConfigFromSettings } from "../src/packages/webRTC/src/adapters/voiceConfig";
import {EffectiveVoicePolicyProvider} from "../src/packages/webRTC/src/components/EffectiveVoicePolicy";
import { TransmitSpeechProvider } from "../src/packages/webRTC/src/components/TransmitSpeechAdapter";
import {VoiceMoveRecoveryNotice} from "../src/packages/webRTC/src/components/VoiceMoveRecoveryNotice";
void setLanguagePreference("zh-CN");
const scale = Number(new URLSearchParams(location.search).get("scale") || 1);
const forced=new URLSearchParams(location.search).get("forced")==="1";
document.documentElement.style.zoom = String(scale);
document.documentElement.style.setProperty("--gryt-ui-scale", String(scale));
function Harness() {
  useOverlayViewportBounds();
  const config = useVoiceConfigFromSettings([]);
  const { openSettings, isMuted, setIsMuted,inputMode } = useSettings();
  const [confirm, setConfirm] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [recoveryNotice,setRecoveryNotice]=useState(false);
  const [recoveryRetries,setRecoveryRetries]=useState(0);
  return <VoiceConfigProvider config={config}><EffectiveVoicePolicyProvider value={forced ? {inputMode:"push_to_talk",requiredPushToTalk:true,
    serverMuted:false,serverDeafened:false,canSpeak:false} : undefined}><div className="gryt-app" style={{display:"flex",flexDirection:"column",height:"calc(100dvh / var(--gryt-ui-scale))",padding:8,gap:8}}>
    <div style={{flex:1,minHeight:0,overflow:"auto"}}>
      <button onClick={() => openSettings("updates")}>Open version</button>
      <button onClick={() => openSettings("audio")}>Open audio</button>
      <button onClick={() => setConfirm(true)}>Open confirm</button>
      <button onClick={() => setIsMuted(true)}>Mute fixture</button>
      <button onClick={() => setSpeaking(!speaking)}>Speech fixture</button>
      <button onClick={()=>setRecoveryNotice(true)}>Recovery fixture</button>
      <button onClick={()=>void setLanguagePreference("en")}>English fixture</button>
      {recoveryNotice && <VoiceMoveRecoveryNotice onRetry={()=>setRecoveryRetries(value=>value+1)}/>}
      <output data-testid="recovery-retries">{recoveryRetries}</output>
      <output data-testid="muted">{String(isMuted)}</output>
      <output data-testid="mode-preference">{inputMode}</output>
      <TransmitSpeechProvider value={speaking}><div data-testid="member-pane" style={{width:240,maxWidth:"100%"}}><ConnectedUser nickname="老蒯和队友的很长昵称" serverUserId="fixture" serverHost="fixture" isSelf isSpeaking={false} isMuted={false} isDeafened={false} isAFK={false}/></div></TransmitSpeechProvider>
      <ReceiveCorrectionRing compact learnedAutoGainDb={12.3} appliedAutoGainDb={3} state="stable" />
      <section data-testid="version-inline"><UpdatesSettings /></section>
    </div>
    <RoomCallBar />
    <Settings />
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="确认操作" description={"长说明".repeat(200)} confirmLabel="确认" onConfirm={() => {}} />
  </div></EffectiveVoicePolicyProvider></VoiceConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<>{registrations.filter(entry => entry.useBody.name === "useSettingsHook").map(entry => entry.render())}<Harness /></>);

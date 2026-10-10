import "../src/style.css";

import { useState } from "react";
import { createRoot } from "react-dom/client";

import { SingletonHooks } from "../src/packages/common";
import { getGlobalLevel, setGlobalLevel, shouldNotifyForMessage } from "../src/packages/common/src/hooks/notificationPrefs";
import { getLanguagePreference } from "../src/packages/i18n";
import { CameraSettings } from "../src/packages/settings/src/components/cameraSettings";
import { useSettings } from "../src/packages/settings/src/hooks/useSettings";
import { useVoiceConfigFromSettings } from "../src/packages/webRTC/src/adapters/voiceConfig";

export function Harness() {
  const s=useSettings(); const config=useVoiceConfigFromSettings([]);
  const [camera,setCamera]=useState(false); const [notification,setNotification]=useState(getGlobalLevel());
  const values={language:getLanguagePreference(),compressor:s.compressorEnabled,agc:s.autoGainEnabled,rn:s.rnnoiseEnabled,
    receive:s.receiveLevelingEnabled,squad:s.squadConfig,mic:s.micVolume,output:s.outputVolume,gate:s.noiseGate,release:s.noiseGateRelease,
    message:s.messageSoundEnabled,connect:s.connectSoundEnabled,disconnect:s.disconnectSoundEnabled,connectVolume:s.connectSoundVolume,
    desktop:s.desktopNotificationsEnabled,badge:s.notificationBadgeEnabled,camera:s.cameraQuality,cameraFps:s.cameraFps,
    screen:s.screenShareQuality,screenFps:s.screenShareFps,gaming:s.screenShareGamingMode,custom:s.customMessageSoundFile};
  return <div className="gryt-app p-4">
    <output data-testid="ready">{String(s.settingsLoaded)}</output><output data-testid="values">{JSON.stringify(values)}</output>
    <output data-testid="voice">{JSON.stringify(config)}</output><output data-testid="notification">{notification}</output>
    <output data-testid="decisions">{JSON.stringify([false,true].map(mentionsMe=>shouldNotifyForMessage("fixture",{conversation_id:"channel",sender_server_id:"other"},{myId:"me",viewingThisServer:false,windowFocused:false,mentionsMe})))}</output>
    <button onClick={()=>{s.setCompressorEnabled(true);s.setCameraQuality("native");s.setScreenShareQuality("native");s.setScreenShareGamingMode(true);s.setMessageSoundEnabled(true);setGlobalLevel("all");setNotification("all");}}>Save explicit legacy choices</button>
    <button onClick={()=>setCamera(true)}>Open camera settings</button>{camera&&<CameraSettings/>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<><SingletonHooks/><Harness/></>);

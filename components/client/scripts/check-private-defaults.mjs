/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
const load=async file=>import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(read(file),{mode:"transform"})).toString("base64")}`);
const squad=await load("src/lib/squadMode.ts");
const peer=await load("src/lib/peerVoiceCues.ts");
const transport=await load("src/lib/voiceTransportPreset.ts");
const announcements=await load("src/lib/voiceAnnouncements.ts");
const packs=read("src/packages/webRTC/src/adapters/voiceSoundPacks.ts");
const volumeFunction=stripTypeScriptTypes(packs.slice(packs.indexOf("export function voiceSoundDefaultVolume"),packs.indexOf("export function voiceSoundUrl"))).replace("export ","");
const voiceSoundDefaultVolume=new Function("MANBO_PACK_AVAILABLE",`${volumeFunction}\nreturn voiceSoundDefaultVolume;`)(false);
const audio=stripTypeScriptTypes(read("src/packages/settings/src/hooks/useAudioSettings.ts"));
const declarations=audio.slice(audio.indexOf("export const AUDIO_DEFAULTS"),audio.indexOf("export function useAudioSettings" )).replaceAll("export ","");
const getSource=read("src/packages/settings/src/hooks/userStorage.ts");
const getter=stripTypeScriptTypes(getSource.slice(getSource.indexOf("export function getUserValue"),getSource.indexOf("export function setUserValue"))).replace("export ","");
const cache={};
const {AUDIO_DEFAULTS,loadAudioFromCache,getUserValue}=new Function("cache","SQUAD_DEFAULTS","resolveSquadConfig","PEER_CUE_DEFAULTS","resolvePeerCueSettings","sharedVoicePreset","migrateVoiceTransportPreset","VOICE_TRANSPORT_SETTINGS_KEY","MANBO_PACK_AVAILABLE","resolveVoiceAnnouncements","voiceSoundDefaultVolume",`${getter}\n${declarations}\nreturn {AUDIO_DEFAULTS,loadAudioFromCache,getUserValue};`)(cache,squad.SQUAD_DEFAULTS,squad.resolveSquadConfig,peer.PEER_CUE_DEFAULTS,peer.resolvePeerCueSettings,transport.sharedVoicePreset,transport.migrateVoiceTransportPreset,transport.VOICE_TRANSPORT_SETTINGS_KEY,false,announcements.resolveVoiceAnnouncements,voiceSoundDefaultVolume);
assert.equal(AUDIO_DEFAULTS.noiseGateMode,"automatic");
assert.equal(loadAudioFromCache().noiseGateMode,"automatic");
cache.noiseGateMode="manual";assert.equal(loadAudioFromCache().noiseGateMode,"manual");delete cache.noiseGateMode;
assert.deepEqual(Object.fromEntries(["compressorEnabled","autoGainEnabled","rnnoiseEnabled","receiveLevelingEnabled","messageSoundEnabled","connectSoundEnabled","disconnectSoundEnabled","desktopNotificationsEnabled","notificationBadgeEnabled"].map(k=>[k,AUDIO_DEFAULTS[k]])),
  {compressorEnabled:false,autoGainEnabled:false,rnnoiseEnabled:true,receiveLevelingEnabled:true,messageSoundEnabled:false,connectSoundEnabled:true,disconnectSoundEnabled:true,desktopNotificationsEnabled:true,notificationBadgeEnabled:true});
assert.equal(AUDIO_DEFAULTS.micVolume,50); assert.equal(AUDIO_DEFAULTS.outputVolume,100);
assert.equal(AUDIO_DEFAULTS.noiseGate,1); assert.equal(AUDIO_DEFAULTS.noiseGateRelease,200);
assert.equal(AUDIO_DEFAULTS.connectSoundVolume,30); assert.equal(AUDIO_DEFAULTS.disconnectSoundVolume,30);
assert.equal(loadAudioFromCache().squadConfig.enabled,true); assert.equal(loadAudioFromCache().squadConfig.processDetection,true);
Object.assign(cache,{compressorEnabled:true,messageSoundEnabled:true,rnnoiseEnabled:false,receiveLevelingEnabled:false,micVolume:0,outputDeviceID:"",customMessageSoundFile:null});
const old=loadAudioFromCache(); for(const [k,v] of Object.entries(cache)) assert.equal(old[k],v,k);
for(const v of [false,0,null,"","native"]) { cache.cameraQuality=v; assert.equal(getUserValue("cameraQuality","720p"),v); }
const moduleSource=stripTypeScriptTypes(read("src/packages/common/src/hooks/notificationPrefs.ts")).replace(/^import .*;$/gm,"").replace(/^export /gm,"");
const storage=new Map(); const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
const prefs=()=>new Function("localStorage",`${moduleSource}\nreturn {getGlobalLevel,shouldNotifyForMessage,setGlobalLevel};`)(localStorage);
let p=prefs(); assert.equal(p.getGlobalLevel(),"mentions");
const ctx={myId:"me",viewingThisServer:false,windowFocused:false};
const msg={conversation_id:"general",sender_server_id:"other"};
assert.equal(p.shouldNotifyForMessage("fixture",msg,ctx),false);
assert.equal(p.shouldNotifyForMessage("fixture",msg,{...ctx,mentionsMe:true}),true);
assert.equal(p.shouldNotifyForMessage("fixture",msg,{...ctx,mentionsMe:true,viewingThisServer:true,windowFocused:true}),false);
for(const global of ["all","none","mentions"]) {storage.set("gryt_notification_prefs",JSON.stringify({global,servers:{}}));assert.equal(prefs().getGlobalLevel(),global);}
storage.set("gryt_notification_prefs",JSON.stringify({fixture:{server:"none"}})); assert.equal(prefs().getGlobalLevel(),"all");
const hooks=read("src/packages/settings/src/hooks/useSettings.ts"),init=read("src/packages/settings/src/hooks/settingsStorage.ts");
for(const key of ["cameraQuality","screenShareQuality"]) {
  assert.ok(hooks.includes(`getUserValue("${key}", "720p")`)); assert.ok(init.includes(`${key}: "720p"`));
}
assert.ok(hooks.includes('getUserValue("screenShareGamingMode", false)'));
const control=read("src/packages/webRTC/src/components/ScreenShareControl.tsx");
assert.ok(!control.includes("withAudio: true")); assert.ok(control.includes("setPicker(mode)"));
const picker=read("src/packages/webRTC/src/components/ScreenSharePickerModal.tsx");
assert.ok(picker.includes("const [includeAudio, setIncludeAudio] = useState(false)"));
assert.ok(!picker.includes("if (!inElectron) return null"));
const camera=read("src/packages/settings/src/components/cameraSettings.tsx");
const mount=camera.slice(camera.indexOf("// Preview is an explicit action"),camera.indexOf("// Restart preview"));
assert.ok(!mount.includes("startPreview()")); assert.ok(camera.includes("onClick={startPreview}"));
const notify=read("src/packages/lib/desktopNotification.ts");
const show=notify.slice(notify.indexOf("export function showDesktopNotification"));
assert.ok(show.includes('Notification.permission !== "granted"')); assert.ok(!show.includes("requestPermission"));
for(const file of ["src/packages/socket/src/hooks/useChat.ts","src/packages/socket/src/hooks/useSocketEvents.ts"]) {
  const code=read(file); assert.ok(code.includes("shouldNotifyForMessage"));
}
fs.writeFileSync("startup-private-defaults.json",JSON.stringify({status:"passed",scope:"actual cache getter/audio load/notification decision; retained unmounted legacy camera/picker helpers; no media or physical input",oldExplicitValuesPreserved:true},null,2));
console.log("PASS private defaults, old explicit/legacy preferences, automatic/manual gate choice, mentions decision and unmounted legacy media helpers");

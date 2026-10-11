import { setDefaultVoicePlatform } from "./platform/index.js";
import { webPlatform } from "./platform/web.js";

/* Registers the web platform, so importing this package is enough. */
setDefaultVoicePlatform(webPlatform);

export { webPlatform };
export * from "./engine.js";
export { BrowserHybridPeer, borrowHybridPublication } from "./webrtc/hybrid/BrowserHybridPeer.js";
export type { BrowserHybridPeerOptions } from "./webrtc/hybrid/BrowserHybridPeer.js";
export { SfuDecodedAudioMonitor } from "./webrtc/hybrid/SfuDecodedAudioMonitor.js";
export type { SfuAudioEvidence } from "./webrtc/hybrid/SfuDecodedAudioMonitor.js";
export { HybridReceivePortAdapter } from "./webrtc/hybrid/HybridReceivePortAdapter.js";
export type { HybridReceivePortOptions } from "./webrtc/hybrid/HybridReceivePortAdapter.js";
export { BrowserHybridVoiceSession } from "./webrtc/hybrid/BrowserHybridVoiceSession.js";
export type { BrowserHybridVoiceState, BrowserHybridVoiceOptions } from "./webrtc/hybrid/BrowserHybridVoiceSession.js";

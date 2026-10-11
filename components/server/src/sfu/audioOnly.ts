import { CAP_SHARE_SCREEN, CAP_SHARE_VIDEO, CAP_VIDEO_CHECKED } from "./clientToken";

/** Explicit opt-in; changing role labels alone does not enforce media. */
export function audioOnlyEnabled(): boolean { return process.env.VOICE_AUDIO_ONLY === "true"; }
export function enforceAudioOnly(capabilities: readonly string[]): string[] {
  if (!audioOnlyEnabled()) return [...capabilities];
  return [...new Set([...capabilities.filter(c => c !== CAP_SHARE_VIDEO && c !== CAP_SHARE_SCREEN), CAP_VIDEO_CHECKED])];
}

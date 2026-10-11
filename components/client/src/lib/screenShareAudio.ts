import { type CopyI18n,englishCopy } from "./copyI18n.ts";
/**
 * What "include audio" picks up, which differs by platform and source. Windows
 * captures per process; macOS captures the machine either way (GRYT-564).
 */
export function audioScopeHint(platform: string, sourceId: string | null, i18n: CopyI18n = englishCopy): string {
  const isWindows = platform === "win32";
  const isWindowSource = sourceId?.startsWith("window:") ?? false;

  if (isWindows && isWindowSource) {
    return i18n.t("shellFull.screenShareAudio_ts_f58c34eac3");
  }

  if (isWindows) {
    return i18n.t("shellFull.screenShareAudio_ts_8c7de971bf");
  }

  return i18n.t("shellFull.screenShareAudio_ts_56d777418f");
}

/** Mirrors CaptureProblem in electron/captureHealth.ts. */
export type ScreenAudioProblem = "permission" | "failed" | "no-audio";

/** What to tell somebody whose share is going out without its sound. */
export function screenAudioProblemMessage(problem: string, i18n: CopyI18n = englishCopy): string | null {
  switch (problem) {
    case "permission":
      return i18n.t("shellFull.screenShareAudio_ts_b84a397cd3");
    case "failed":
      return i18n.t("shellFull.screenShareAudio_ts_5b6a127816");
    case "no-audio":
      return i18n.t("shellFull.screenShareAudio_ts_3358f4d515");
    default:
      return null;
  }
}

/**
 * The audio stream id a screen share announces. Empty once capture has stopped, even mid-share.
 * The first stream's id wins after that, since replaceTrack leaves the transceiver's msid on it.
 */
export function screenAudioStreamId(
  shareActive: boolean,
  audioStream: { id: string } | null | undefined,
  transceiverStreamId: string | null,
): string {
  if (!shareActive || !audioStream) return "";
  return transceiverStreamId || audioStream.id;
}

/** The platform, as coarsely as the user agent states it. */
export function currentPlatform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux|X11/.test(ua)) return "linux";
  return "";
}

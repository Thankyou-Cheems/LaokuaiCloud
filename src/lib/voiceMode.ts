export interface VoiceModeState {
  v: 1; seq: number;
  inputMode: "voice_activity" | "push_to_talk";
  squad: "off" | "standby" | "armed" | "suppressed" | "resuming" | "unavailable";
  transmit: "normal" | "manual-muted" | "server-muted" | "ptt-idle" | "squad-suppressed" | "resuming" | "pending" | "suspended" | "error";
}
export function parseVoiceMode(value: unknown): VoiceModeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["v", "seq", "inputMode", "squad", "transmit"].includes(k))) return null;
  if (v.v !== 1 || !Number.isSafeInteger(v.seq) || (v.seq as number) < 0
    || !["voice_activity", "push_to_talk"].includes(v.inputMode as string)
    || !["off", "standby", "armed", "suppressed", "resuming", "unavailable"].includes(v.squad as string)
    || !["normal", "manual-muted", "server-muted", "ptt-idle", "squad-suppressed", "resuming", "pending", "suspended", "error"].includes(v.transmit as string)) return null;
  return { v: 1, seq: v.seq as number, inputMode: v.inputMode as VoiceModeState["inputMode"],
    squad: v.squad as VoiceModeState["squad"], transmit: v.transmit as VoiceModeState["transmit"] };
}
export function deriveVoiceMode(input: {
  inputMode: VoiceModeState["inputMode"]; pttActive: boolean; manualMuted: boolean; serverMuted: boolean;
  squadEnabled: boolean; squadStatus: string; gateStatus: string; requestedSuppression: boolean;
}): Omit<VoiceModeState, "seq"> {
  const awaitingSuppression = input.requestedSuppression && input.gateStatus !== "suppressed";
  const squad: VoiceModeState["squad"] = awaitingSuppression ? "armed" : input.gateStatus === "recovering" ? "resuming"
    : input.gateStatus === "suppressed" ? "suppressed" : !input.squadEnabled ? "off" : input.squadStatus === "unavailable" ? "unavailable"
      : ["standby", "unconfigured"].includes(input.squadStatus) ? "standby" : "armed";
  const transmit: VoiceModeState["transmit"] = input.serverMuted ? "server-muted" : input.manualMuted ? "manual-muted"
    : input.gateStatus === "failed" ? "error" : input.gateStatus === "suspended" ? "suspended"
      : input.gateStatus === "suppressed" ? "squad-suppressed" : awaitingSuppression ? "pending" : input.gateStatus === "recovering" ? "resuming"
        : input.requestedSuppression ? "pending" : input.inputMode === "push_to_talk" && !input.pttActive ? "ptt-idle" : "normal";
  return { v: 1, inputMode: input.inputMode, squad, transmit };
}

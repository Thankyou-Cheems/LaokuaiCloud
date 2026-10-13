/** Transport intent only. SDP/encoder evidence must come from the Voice SDK. */
export const VOICE_TRANSPORT_SETTINGS_KEY = "voiceTransportPresetV1";
export const STANDARD_SFU_BITRATE_BPS = 16_000;
export const STANDARD_PEER_BITRATE_BPS = 64_000;
export interface VoiceTransportPreset {
  schemaVersion: 1;
  selection: "shared-20" | "custom";
  maxBitrateBps: number;
  packetTimeMs: 10 | 20 | 40 | 60;
  channels: 1;
  variableBitrate: true;
  requestDtx: boolean;
  requestInbandFec: boolean;
}

export function sharedVoicePreset(): VoiceTransportPreset {
  // Retain the persisted selection key so existing standard users migrate without a prompt.
  // The constrained community's SFU profile trades packet overhead for speech capacity.
  return { schemaVersion: 1, selection: "shared-20", maxBitrateBps: STANDARD_SFU_BITRATE_BPS,
    packetTimeMs: 60, channels: 1, variableBitrate: true,
    requestDtx: true, requestInbandFec: true };
}

/** Standard peer quality is separate from SFU ingress. Explicit custom limits stay exact. */
export function peerVoicePreset(preset: VoiceTransportPreset): VoiceTransportPreset {
  return preset.selection === "custom" ? { ...preset } : { ...sharedVoicePreset(), maxBitrateBps: STANDARD_PEER_BITRATE_BPS, packetTimeMs: 20 };
}

export function voicePresetCodec(preset: VoiceTransportPreset) {
  return { codec: "opus" as const, maxBitrateBps: preset.maxBitrateBps, packetTimeMs: preset.packetTimeMs,
    channels: 1 as const, vbr: true as const, dtx: preset.requestDtx, fec: preset.requestInbandFec };
}

export function readVoiceTransportPreset(value: unknown): VoiceTransportPreset | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || (row.selection !== "shared-20" && row.selection !== "custom") ||
    typeof row.maxBitrateBps !== "number" || !Number.isInteger(row.maxBitrateBps) ||
    row.maxBitrateBps < 6_000 || row.maxBitrateBps > 128_000 ||
    (row.packetTimeMs !== 10 && row.packetTimeMs !== 20 && row.packetTimeMs !== 40 && row.packetTimeMs !== 60) ||
    row.channels !== 1 || row.variableBitrate !== true ||
    typeof row.requestDtx !== "boolean" || typeof row.requestInbandFec !== "boolean") return;
  if (row.selection === "shared-20") return sharedVoicePreset();
  return { schemaVersion: 1, selection: "custom", maxBitrateBps: row.maxBitrateBps,
    packetTimeMs: row.packetTimeMs, channels: 1, variableBitrate: true,
    requestDtx: row.requestDtx, requestInbandFec: row.requestInbandFec };
}

/** Preserve the legacy flag; it cannot prove an explicit bandwidth choice.
 * Only a valid new custom record preserves custom bandwidth. */
export function migrateVoiceTransportPreset(stored: unknown, legacyEsports: unknown) {
  const valid = readVoiceTransportPreset(stored);
  return { preset: valid ?? sharedVoicePreset(), needsPersist: !valid,
    legacyEsportsRetained: legacyEsports === true,
    reviewLegacyBandwidth: !valid && legacyEsports === true };
}

/** Server channel cap is an upper bound, not permission to raise a client's limit. */
export function boundedVoiceBitrate(preset: VoiceTransportPreset, channelCap: unknown): number {
  return typeof channelCap === "number" && Number.isFinite(channelCap) && channelCap > 0
    ? Math.min(preset.maxBitrateBps, Math.floor(channelCap)) : preset.maxBitrateBps;
}

import { z } from "zod";
import type { VoiceQualityReport, VoiceQualityRequest, VoiceQualityUpdate } from "./voiceQualityContract";
import {
  VOICE_QUALITY_MAX_RTT_MS, VOICE_QUALITY_MAX_JITTER_MS,
  VOICE_QUALITY_MIN_SAMPLE_WINDOW_MS, VOICE_QUALITY_MAX_SAMPLE_WINDOW_MS,
  VOICE_QUALITY_MAX_PACKETS_PER_SECOND,
  VOICE_QUALITY_TTL_MS,
} from "./voiceQualityContract";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sampleSchema = z.strictObject({
  windowMs: z.number().min(VOICE_QUALITY_MIN_SAMPLE_WINDOW_MS).max(VOICE_QUALITY_MAX_SAMPLE_WINDOW_MS),
  packetsReceived: count,
  packetsLost: count,
}).refine((sample) => sample.packetsReceived + sample.packetsLost <=
  VOICE_QUALITY_MAX_PACKETS_PER_SECOND * sample.windowMs / 1000);

const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionGeneration: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  iceRttMs: z.number().min(0).max(VOICE_QUALITY_MAX_RTT_MS).nullable(),
  uplink: z.strictObject({
    rttMs: z.number().min(0).max(VOICE_QUALITY_MAX_RTT_MS).nullable(),
    sample: sampleSchema.nullable(),
  }).nullable(),
  receive: z.strictObject({
    jitterMaxMs: z.number().min(0).max(VOICE_QUALITY_MAX_JITTER_MS).nullable(),
    sample: sampleSchema.nullable(),
  }).nullable(),
});

export function parseVoiceQualityReport(value: unknown): VoiceQualityReport | null {
  const result = reportSchema.safeParse(value);
  return result.success ? result.data : null;
}

const requestSchema = z.strictObject({
  accessToken: z.string().min(1).max(8192),
  report: reportSchema,
});

export function parseVoiceQualityRequest(value: unknown): VoiceQualityRequest | null {
  const result = requestSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** One socket owns one store. Clearing data preserves replay watermarks. */
export class VoiceQualityStore {
  private generation = 0;
  private seq = 0;
  private known = false;

  constructor(private readonly clientId: string) {}

  accept(report: VoiceQualityReport, receivedAt: number): VoiceQualityUpdate | null {
    if (report.connectionGeneration < this.generation ||
        (report.connectionGeneration === this.generation && report.seq <= this.seq)) return null;
    this.generation = report.connectionGeneration;
    this.seq = report.seq;
    this.known = true;
    return {
      schemaVersion: 1, clientId: this.clientId, report,
      receivedAt, expiresAt: receivedAt + VOICE_QUALITY_TTL_MS,
    };
  }

  clear(receivedAt: number): VoiceQualityUpdate | null {
    if (!this.known) return null;
    this.known = false;
    return {
      schemaVersion: 1, clientId: this.clientId, report: null,
      receivedAt, expiresAt: receivedAt,
    };
  }
}

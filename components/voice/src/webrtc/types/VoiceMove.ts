export interface VoiceMoveChannelSettings {
  requirePushToTalk: boolean;
  disableRnnoise: boolean;
  maxBitrate: number | null;
  eSportsMode: boolean;
}

export interface PrepareVoiceMove {
  requestId: string;
  sourceChannelId: string;
  destinationChannelId: string;
  joinToken: unknown;
  sfuUrls: readonly string[];
  expiresAt: number;
  channelSettings: VoiceMoveChannelSettings;
}

export interface VoiceMoveConfirmation {
  requestId: string;
  generation: string;
  sourceChannelId: string;
  destinationChannelId: string;
  status: "pending" | "aborted" | "committed";
}

/** Implemented by the authenticated signaling adapter, never inferred from a media socket. */
export interface VoiceMoveAuthority {
  readonly generation: string;
  readonly stagingSupported: boolean;
  confirmCommit(requestId: string): Promise<VoiceMoveConfirmation>;
  onInvalidated(handler: (reason: string) => void): () => void;
  /** True only after this move's destination config and final transmit gate acknowledged it. */
  isDestinationPolicyApplied(requestId: string, settings: VoiceMoveChannelSettings): boolean;
}

export class VoiceMoveError extends Error {
  constructor(readonly code: string) {
    super(`Voice move: ${code}`);
    this.name = "VoiceMoveError";
  }
}

/** Maximum decode-proof age when committing a media switch. */
export const HYBRID_MEDIA_PROOF_MAX_AGE_MS = 500;
/** Continuity tolerance for an already verified live peer and its path evidence. */
export const HYBRID_MEDIA_HEALTH_MAX_AGE_MS = 3000;
/** Sampling cadence; this is not a deadline for obtaining new media proof. */
export const HYBRID_PEER_STATS_POLL_MS = 500;

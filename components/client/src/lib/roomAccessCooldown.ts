/** A server rate-limit refusal applies to this signalling socket, including late replies. */
export class RoomAccessCooldown {
  private until = 0;
  constructor(private now: () => number = () => performance.now()) {}
  observe(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const error = value as {error?: unknown; retryAfterMs?: unknown};
    if (error.error !== "rate_limited" || typeof error.retryAfterMs !== "number" ||
        !Number.isFinite(error.retryAfterMs) || error.retryAfterMs <= 0) return;
    this.until = Math.max(this.until, this.now() + Math.min(error.retryAfterMs, 3_600_000));
  }
  remaining(): number {return Math.max(0, Math.ceil(this.until - this.now()));}
}

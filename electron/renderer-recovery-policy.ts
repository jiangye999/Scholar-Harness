export interface RendererRecoveryDecision {
  allowed: boolean;
  attempt: number;
  maxAttempts: number;
  retryAfterMs: number;
}

/**
 * Limits automatic renderer recoveries so a broken page cannot enter an
 * unbounded reload loop.
 */
export class RendererRecoveryPolicy {
  private attemptTimestamps: number[] = [];

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new Error("windowMs must be a positive number");
    }
  }

  tryAcquire(now = Date.now()): RendererRecoveryDecision {
    this.prune(now);

    if (this.attemptTimestamps.length >= this.maxAttempts) {
      const oldestAttempt = this.attemptTimestamps[0] ?? now;
      return {
        allowed: false,
        attempt: this.attemptTimestamps.length,
        maxAttempts: this.maxAttempts,
        retryAfterMs: Math.max(0, oldestAttempt + this.windowMs - now),
      };
    }

    this.attemptTimestamps.push(now);
    return {
      allowed: true,
      attempt: this.attemptTimestamps.length,
      maxAttempts: this.maxAttempts,
      retryAfterMs: 0,
    };
  }

  getAttemptCount(now = Date.now()): number {
    this.prune(now);
    return this.attemptTimestamps.length;
  }

  reset(): void {
    this.attemptTimestamps = [];
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.attemptTimestamps = this.attemptTimestamps.filter(timestamp => timestamp > cutoff);
  }
}

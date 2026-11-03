/** A speed limit (token bucket). `take(bytes)` waits until those bytes may pass. A rate of 0 means
 * no limit. Several downloads and connections share one limiter; each waits its turn. */
export class Limiter {
  private tokens = 0
  private last = Date.now()
  private queue: Promise<void> = Promise.resolve()

  constructor(public rate = 0) {}

  setRate(rate: number): void {
    this.rate = Math.max(0, rate)
  }

  take(bytes: number): Promise<void> {
    if (!(this.rate > 0)) return Promise.resolve()
    const turn = this.queue.then(() => this.wait(bytes))
    this.queue = turn.catch(() => {})
    return turn
  }

  private async wait(bytes: number): Promise<void> {
    for (;;) {
      if (!(this.rate > 0)) return
      const now = Date.now()
      // A burst of a quarter second at most.
      this.tokens = Math.min(
        this.rate / 4 + bytes,
        this.tokens + ((now - this.last) / 1000) * this.rate
      )
      this.last = now
      if (this.tokens >= bytes) {
        this.tokens -= bytes
        return
      }
      const ms = Math.min(250, Math.ceil(((bytes - this.tokens) / this.rate) * 1000))
      await new Promise((r) => setTimeout(r, Math.max(5, ms)))
    }
  }
}

/** Waits for every limiter in turn. */
export async function takeAll(limiters: (Limiter | undefined)[], bytes: number): Promise<void> {
  for (const limiter of limiters) if (limiter) await limiter.take(bytes)
}

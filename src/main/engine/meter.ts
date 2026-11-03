/** Bytes per second over the last few seconds, in quarter-second buckets. */
export class SpeedMeter {
  private readonly buckets: number[]
  private readonly bucketMs = 250
  private head = 0
  private headAt = 0

  constructor(private readonly windowMs = 2000) {
    this.buckets = new Array(Math.ceil(windowMs / this.bucketMs)).fill(0)
  }

  private roll(now: number): void {
    const slot = Math.floor(now / this.bucketMs)
    if (this.headAt === 0) this.headAt = slot
    const steps = Math.min(this.buckets.length, slot - this.headAt)
    for (let i = 0; i < steps; i++) {
      this.head = (this.head + 1) % this.buckets.length
      this.buckets[this.head] = 0
    }
    if (slot > this.headAt) this.headAt = slot
  }

  add(bytes: number, now = Date.now()): void {
    this.roll(now)
    this.buckets[this.head] += bytes
  }

  /** Bytes/s, leaving out the bucket still filling. */
  rate(now = Date.now()): number {
    this.roll(now)
    let sum = 0
    for (let i = 0; i < this.buckets.length; i++) if (i !== this.head) sum += this.buckets[i]
    return sum / ((this.windowMs - this.bucketMs) / 1000)
  }
}

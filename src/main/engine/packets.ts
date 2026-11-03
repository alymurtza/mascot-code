/**
 * The file split into packets: fixed-size byte ranges, each fetched by one connection at a time
 * (two near the end, when a slow one is fetched again elsewhere). `filled[i]` is how many bytes
 * from the packet's start are on disk.
 */
export interface Lease {
  index: number
  /** Byte range to fetch, inclusive. */
  start: number
  end: number
}

/** Near the end, a packet with more than this left is fetched by a second connection too. */
const ENDGAME_MIN = 256 * 1024

export class PacketTable {
  readonly count: number
  readonly filled: Uint32Array
  /** How many connections hold each packet. */
  private readonly holders: Uint8Array
  private doneCount = 0
  private cursor = 0

  constructor(
    readonly size: number,
    readonly packetSize: number,
    filled?: ArrayLike<number>
  ) {
    this.count = Math.max(1, Math.ceil(size / packetSize))
    this.filled = new Uint32Array(this.count)
    this.holders = new Uint8Array(this.count)
    if (filled && filled.length === this.count) {
      for (let i = 0; i < this.count; i++) this.filled[i] = Math.min(filled[i], this.length(i))
    }
    for (let i = 0; i < this.count; i++) if (this.isDone(i)) this.doneCount++
  }

  /** A packet size for a file of `size` bytes: around 200 packets, 512 KiB to 16 MiB. */
  static packetSizeFor(size: number): number {
    const unit = 256 * 1024
    const target = Math.min(16 * 1024 * 1024, Math.max(512 * 1024, size / 200))
    return Math.ceil(target / unit) * unit
  }

  length(index: number): number {
    return Math.min(this.packetSize, this.size - index * this.packetSize)
  }

  isDone(index: number): boolean {
    return this.filled[index] >= this.length(index)
  }

  get done(): number {
    return this.doneCount
  }

  get complete(): boolean {
    return this.doneCount === this.count
  }

  get active(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) if (this.holders[i] > 0 && !this.isDone(i)) n++
    return n
  }

  /** Packets started but not finished, and nobody fetching them. */
  get partDone(): number {
    let n = 0
    for (let i = 0; i < this.count; i++)
      if (this.filled[i] > 0 && !this.isDone(i) && this.holders[i] === 0) n++
    return n
  }

  /** Bytes on disk. */
  get received(): number {
    let total = 0
    for (let i = 0; i < this.count; i++) total += this.filled[i]
    return total
  }

  /** How many more connections could get something to fetch right now. */
  get available(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) {
      if (this.isDone(i)) continue
      if (this.holders[i] === 0) n++
      else if (this.holders[i] === 1 && this.length(i) - this.filled[i] > ENDGAME_MIN) n++
    }
    return n
  }

  private leaseOf(index: number): Lease {
    this.holders[index]++
    const start = index * this.packetSize
    return { index, start: start + this.filled[index], end: start + this.length(index) - 1 }
  }

  /** The next packet nobody holds; near the end, a slow one someone else is fetching, so two
   * connections race for it. Null when there's nothing worth fetching. */
  lease(): Lease | null {
    for (let n = 0; n < this.count; n++) {
      const i = (this.cursor + n) % this.count
      if (this.holders[i] === 0 && !this.isDone(i)) {
        this.cursor = i + 1
        return this.leaseOf(i)
      }
    }
    // End-game: the held packet with the most left, if it's worth racing for.
    let best = -1
    let bestLeft = ENDGAME_MIN
    for (let i = 0; i < this.count; i++) {
      if (this.isDone(i) || this.holders[i] !== 1) continue
      const left = this.length(i) - this.filled[i]
      if (left > bestLeft) {
        best = i
        bestLeft = left
      }
    }
    return best >= 0 ? this.leaseOf(best) : null
  }

  /** Bytes up to `position` (absolute, exclusive) of a packet are on disk. */
  progress(index: number, position: number): void {
    if (this.isDone(index)) return
    const filled = Math.min(this.length(index), position - index * this.packetSize)
    if (filled > this.filled[index]) {
      this.filled[index] = filled
      if (this.isDone(index)) this.doneCount++
    }
  }

  release(index: number): void {
    if (this.holders[index] > 0) this.holders[index]--
  }

  /** Forget a packet's bytes (they were found to be bad). */
  reset(index: number): void {
    if (this.isDone(index)) this.doneCount--
    this.filled[index] = 0
  }
}

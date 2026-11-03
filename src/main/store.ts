import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** A JSON file in the app's data folder, written atomically (temp file then rename) and at
 * most every `delayMs`. */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private pending: T | null = null
  constructor(
    private readonly name: string,
    private readonly delayMs = 500
  ) {}

  /** Looked up when used: the data folder is only set once the app starts. */
  get path(): string {
    return join(app.getPath('userData'), this.name)
  }

  read(): T | undefined {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as T
    } catch {
      return undefined
    }
  }

  write(value: T): void {
    this.pending = value
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending === null) return
    const value = this.pending
    this.pending = null
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temp = this.path + '.tmp'
      writeFileSync(temp, JSON.stringify(value))
      renameSync(temp, this.path)
    } catch (error) {
      console.error('[mascot] could not save', this.path, error)
    }
  }
}

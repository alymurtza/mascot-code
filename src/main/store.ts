import { app } from 'electron'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'

/** Writes JSON all the way to the disk in a temp file, then puts it in place. */
export function writeJsonSync(path: string, value: unknown): void {
  const temp = path + '.tmp'
  const fd = openSync(temp, 'w')
  try {
    writeSync(fd, JSON.stringify(value))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
}

/** A JSON file in the app's data folder, written at most every `delayMs`. Each write goes all
 * the way to the disk in a temp file before it replaces the file, and the previous copy stays as
 * `.bak`, so a power cut or crash in the middle leaves a readable copy. */
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
    for (const path of [this.path, this.path + '.bak']) {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as T
      } catch {
        // Missing or unreadable: try the backup.
      }
    }
    // Neither can be read: keep the broken file aside rather than writing over it.
    if (existsSync(this.path)) {
      try {
        renameSync(this.path, `${this.path}.broken-${Date.now()}`)
      } catch {
        // Left where it is.
      }
    }
    return undefined
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
      if (existsSync(this.path)) {
        // The new copy goes to the disk first; only then does the old one become the backup.
        const temp = this.path + '.new'
        writeJsonSync(temp, value)
        renameSync(this.path, this.path + '.bak')
        renameSync(temp, this.path)
      } else writeJsonSync(this.path, value)
    } catch (error) {
      console.error('[mascot] could not save', this.path, error)
    }
  }
}

import { useEffect, useState } from 'react'

/** The time now, updated every `everyMs`, for countdowns and "in 5 min". */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

/** "2026-10-26T15:00" an hour from now, for datetime inputs. */
export function inAnHour(): string {
  const t = new Date(Date.now() + 60 * 60_000)
  return localInput(t, true)
}

export function localInput(t: Date, roundToHour = false): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${roundToHour ? '00' : pad(t.getMinutes())}`
}

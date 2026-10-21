import { formatClock, type Crossing, type SunDay } from '../sunTimes'

/** Dates, spans and wording shared by the daylight page's charts, cards and table. */

export const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]

/** "21 giugno", or "21 giu" when short; `date` is UTC midnight of the day. */
export function dayLabel(date: number, short = false): string {
  const d = new Date(date)
  const month = MONTHS[d.getUTCMonth()]
  return `${d.getUTCDate()} ${short ? month.slice(0, 3) : month}`
}

/** Hours of light (or of light plus twilight) as an interval of local clock hours; null when there is none. */
export function span(c: Crossing, noon: number): [number, number] | null {
  if (c === 'down') return null
  if (c === 'up') return [noon - 12, noon + 12]
  return [c.rise, c.set]
}

/** Gridline hours for a set of day lengths: 4–6 ticks on a clean step, within 0–24 h. */
export function hourTicks(values: number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  for (const step of [0.25, 0.5, 1, 2, 3, 4, 6]) {
    const lo = Math.max(0, Math.floor((min - step / 2) / step) * step)
    const hi = Math.min(24, Math.ceil((max + step / 2) / step) * step)
    if ((hi - lo) / step <= 6) {
      const ticks = []
      for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t)
      return ticks
    }
  }
  return [0, 6, 12, 18, 24]
}

/** "alba 05:35 · tramonto 20:49", or what happens instead near the poles. */
export function sunSummary(day: SunDay): string {
  if (day.sun === 'up') return 'il sole non tramonta'
  if (day.sun === 'down') return day.civil === 'down' ? 'notte polare, senza crepuscolo' : 'il sole non sorge, solo crepuscolo'
  return `alba ${formatClock(day.sun.rise)} · tramonto ${formatClock(day.sun.set)}${day.sun.set >= 23.9917 ? ' (dopo mezzanotte)' : ''}`
}

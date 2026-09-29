/** Local time and UTC offsets of IANA zones, via Intl (daylight saving included). */

const timeFormats = new Map<string, Intl.DateTimeFormat>()
const offsetFormats = new Map<string, Intl.DateTimeFormat>()

function cached(map: Map<string, Intl.DateTimeFormat>, zone: string, options: Intl.DateTimeFormatOptions) {
  let f = map.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('it-IT', { ...options, timeZone: zone })
    map.set(zone, f)
  }
  return f
}

/** "14:32" in the zone; null for an unknown zone. */
export function localTime(zone: string, now: Date): string | null {
  try {
    return cached(timeFormats, zone, { hour: '2-digit', minute: '2-digit' }).format(now)
  } catch {
    return null
  }
}

/** Offset from UTC in minutes (e.g. 120 for Rome in summer, 330 for India); null for an unknown zone. */
export function offsetMinutes(zone: string, now: Date): number | null {
  try {
    const name = cached(offsetFormats, zone, { timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value
    const m = name?.match(/GMT([+-−])?(\d{1,2})?(?::(\d{2}))?/)
    if (!m) return null
    const sign = m[1] === '-' || m[1] === '−' ? -1 : 1
    return sign * (Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0))
  } catch {
    return null
  }
}

/** "UTC+2", "UTC−3:30", "UTC". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const abs = Math.abs(minutes)
  const hm = abs % 60 ? `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}` : String(abs / 60)
  return `UTC${minutes < 0 ? '−' : '+'}${hm}`
}

/** Distinct offsets in use right now across the zones, west to east (many zones share one offset). */
export function distinctOffsets(zones: readonly string[], now: Date): number[] {
  const set = new Set<number>()
  for (const z of zones) {
    const m = offsetMinutes(z, now)
    if (m != null) set.add(m)
  }
  return [...set].sort((a, b) => a - b)
}

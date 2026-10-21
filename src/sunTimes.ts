import { offsetMinutes } from './time'

/**
 * Sunrise, sunset and civil twilight of a place on a local calendar day, from NOAA's solar equations (Meeus):
 * within a minute of published tables between the polar circles, a few minutes close to them. Times are local
 * clock hours (daylight saving included), as the place's own clocks show them.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const MINUTE = 60_000
const HOUR = 3_600_000
export const DAY = 86_400_000

/** The sun's centre at sunrise and sunset: 34′ of refraction plus the 16′ solar radius below the horizon. */
const SUNRISE_ALTITUDE = -0.833
/** Civil twilight ends with the sun 6° below the horizon. */
const CIVIL_ALTITUDE = -6

/** Rise and set as local clock hours after midnight; 'up' / 'down' when the sun stays above / below all day. */
export type Crossing = { rise: number; set: number } | 'up' | 'down'

export type SunDay = {
  /** The local calendar day, as UTC midnight of that date. */
  date: number
  /** Solar noon, local clock hours. */
  noon: number
  /** Sunrise and sunset. Near the poles a sunset can fall after midnight (> 24) or a sunrise before it (< 0). */
  sun: Crossing
  /** Civil dawn and dusk ('up': light all night, the white nights). */
  civil: Crossing
  /** Hours between sunrise and sunset: 0 in the polar night, 24 under the midnight sun. */
  daylight: number
  /** UTC offset at noon, minutes. */
  offset: number
}

/** UTC offset in minutes of a place at an instant. */
export type OffsetAt = (ms: number) => number

/** Declination (degrees) and equation of time (minutes) of the sun at an instant. */
function sunPosition(ms: number): { decl: number; eqTime: number } {
  const t = (ms / DAY + 2440587.5 - 2451545) / 36525 // Julian centuries since J2000
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 // mean longitude
  const m = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t) // orbit eccentricity
  const center =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  const omega = (125.04 - 1934.136 * t) * RAD
  const lambda = (l0 + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD // apparent longitude
  const obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega)) * RAD
  const y = Math.tan(obliquity / 2) ** 2
  const l = l0 * RAD
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * l) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l) -
      0.5 * y * y * Math.sin(4 * l) -
      1.25 * e * e * Math.sin(2 * m))
  return { decl: Math.asin(Math.sin(obliquity) * Math.sin(lambda)) * DEG, eqTime }
}

/** Hour angle (degrees from noon) at which the sun's centre is at `altitude`. */
function hourAngle(lat: number, decl: number, altitude: number): number | 'up' | 'down' {
  const cos =
    (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD))
  if (cos < -1) return 'up'
  if (cos > 1) return 'down'
  return Math.acos(cos) * DEG
}

/**
 * Instant (ms) of a crossing on the morning (-1) or evening (+1) side of solar noon, refined with the sun's position
 * at that time rather than at noon: the declination moves up to 0.4° a day, minutes near the polar circles.
 */
function crossingAt(noon: number, lat: number, altitude: number, angle: number, side: -1 | 1): number {
  const eqNoon = sunPosition(noon).eqTime
  let t = noon + side * angle * 4 * MINUTE
  for (let i = 0; i < 2; i++) {
    const { decl, eqTime } = sunPosition(t)
    const h = hourAngle(lat, decl, altitude)
    if (typeof h !== 'number') break // grazing the altitude: keep the noon estimate
    t = noon - (eqTime - eqNoon) * MINUTE + side * h * 4 * MINUTE
  }
  return t
}

function crossing(noon: number, lat: number, altitude: number): { rise: number; set: number } | 'up' | 'down' {
  const angle = hourAngle(lat, sunPosition(noon).decl, altitude)
  if (typeof angle !== 'number') return angle
  return { rise: crossingAt(noon, lat, altitude, angle, -1), set: crossingAt(noon, lat, altitude, angle, 1) }
}

/** Sun times of the local day `date` (UTC midnight of that calendar date) at a place. */
export function sunDay(lat: number, lon: number, date: number, offsetAt: OffsetAt): SunDay {
  // The solar noon nearest to the clocks' noon: in zones far from their meridian (Kiribati at UTC+14) it falls on
  // another UTC date.
  const clockNoon = date + 12 * HOUR - offsetAt(date + 12 * HOUR) * MINUTE
  let noon = clockNoon
  for (let i = 0; i < 2; i++) {
    const utcNoon = date + (720 - 4 * lon - sunPosition(noon).eqTime) * MINUTE
    noon = utcNoon + Math.round((clockNoon - utcNoon) / DAY) * DAY
  }
  const local = (ms: number) => (ms + offsetAt(ms) * MINUTE - date) / HOUR
  const toLocal = (c: ReturnType<typeof crossing>): Crossing =>
    typeof c === 'string' ? c : { rise: local(c.rise), set: local(c.set) }
  const sun = crossing(noon, lat, SUNRISE_ALTITUDE)
  return {
    date,
    noon: local(noon),
    sun: toLocal(sun),
    civil: toLocal(crossing(noon, lat, CIVIL_ALTITUDE)),
    daylight: sun === 'up' ? 24 : sun === 'down' ? 0 : (sun.set - sun.rise) / HOUR,
    offset: offsetAt(noon),
  }
}

/**
 * UTC offset of a zone at any instant around a year, asking Intl once a day and bisecting each change (daylight
 * saving) to the minute. Without a zone, `fallback` minutes.
 */
export function zoneOffsets(zone: string | null, year: number, fallback: number): OffsetAt {
  const at = (ms: number) => (zone ? offsetMinutes(zone, new Date(ms)) : null) ?? fallback
  const start = Date.UTC(year, 0, 1) - 2 * DAY
  const end = Date.UTC(year + 1, 0, 1) + 2 * DAY
  const changes: { from: number; offset: number }[] = [{ from: -Infinity, offset: at(start) }]
  for (let t = start + DAY; t <= end; t += DAY) {
    const before = changes[changes.length - 1].offset
    const offset = at(t)
    if (offset === before) continue
    let lo = t - DAY
    let hi = t
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE
      if (at(mid) === before) lo = mid
      else hi = mid
    }
    changes.push({ from: hi, offset })
  }
  return (ms) => {
    let offset = changes[0].offset
    for (const c of changes) {
      if (ms < c.from) break
      offset = c.offset
    }
    return offset
  }
}

/** Mean solar time, to the hour: the stand-in when a place's zone is unknown. */
export const solarOffset = (lon: number) => Math.round(lon / 15) * 60

/** Every day of a year at a place, in its zone's clock time. */
export function sunYear(lat: number, lon: number, zone: string | null, year: number): SunDay[] {
  const offsetAt = zoneOffsets(zone, year, solarOffset(lon))
  const days: SunDay[] = []
  for (let d = Date.UTC(year, 0, 1); d < Date.UTC(year + 1, 0, 1); d += DAY) days.push(sunDay(lat, lon, d, offsetAt))
  return days
}

/** Today's calendar date in a zone, as UTC midnight of that date. */
export function localDate(zone: string | null, now: Date, fallback = 0): number {
  const local = new Date(now.getTime() + ((zone ? offsetMinutes(zone, now) : null) ?? fallback) * MINUTE)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
}

/** Today's sunrise and sunset at a place (single day: the zone is asked directly). */
export function sunToday(lat: number, lon: number, zone: string | null, now: Date): SunDay {
  const fallback = solarOffset(lon)
  const offsetAt = (ms: number) => (zone ? offsetMinutes(zone, new Date(ms)) : null) ?? fallback
  return sunDay(lat, lon, localDate(zone, now, fallback), offsetAt)
}

// ---------------------------------------------------------------- formatting (it-IT)

/** "05:34" from local hours, rounded to the minute and wrapped to the clock (see dayShift for the day). */
export function formatClock(hours: number): string {
  const minutes = ((Math.round(hours * 60) % 1440) + 1440) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** -1 / +1 when a time rounds to the day before / after (a sunset past midnight), else 0. */
export function dayShift(hours: number): number {
  return Math.floor(Math.round(hours * 60) / 1440)
}

/** "15 h 14 min", "9 h", "45 min"; whole minutes. */
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`
}

/** Signed change in minutes: "+2 min", "−1 h 05 min", "±0 min" (− is the minus sign, as in formatOffset). */
export function formatChange(hours: number): string {
  const minutes = Math.round(hours * 60)
  if (!minutes) return '±0 min'
  return `${minutes > 0 ? '+' : '−'}${formatDuration(Math.abs(minutes) / 60)}`
}

import { describe, expect, it } from 'vitest'
import { dayShift, formatChange, formatClock, formatDuration, sunToday, sunYear, type Crossing } from './sunTimes'

const year = 2026
const on = (days: ReturnType<typeof sunYear>, month: number, day: number) =>
  days.find((d) => d.date === Date.UTC(year, month - 1, day))!

const rome = sunYear(41.8933, 12.4829, 'Europe/Rome', year)
const reykjavik = sunYear(64.1355, -21.8954, 'Atlantic/Reykjavik', year)
const sydney = sunYear(-33.8679, 151.2073, 'Australia/Sydney', year)
const tromso = sunYear(69.6496, 18.957, 'Europe/Oslo', year)

/** Within `minutes` of an "hh:mm" clock time (published tables round to the minute). */
function near(hours: number, clock: string, minutes = 2) {
  const [h, m] = clock.split(':').map(Number)
  expect(Math.abs(hours - (h + m / 60)) * 60).toBeLessThanOrEqual(minutes)
}

function times(c: Crossing) {
  if (typeof c === 'string') throw new Error(`no crossing: ${c}`)
  return c
}

describe('sunYear', () => {
  it('matches published sunrise and sunset times', () => {
    near(times(on(rome, 6, 21).sun).rise, '05:35')
    near(times(on(rome, 6, 21).sun).set, '20:48')
    near(times(on(rome, 12, 21).sun).rise, '07:34')
    near(times(on(rome, 12, 21).sun).set, '16:42')
    near(times(on(sydney, 6, 21).sun).rise, '07:00')
    near(times(on(sydney, 12, 21).sun).set, '20:05')
    near(on(reykjavik, 12, 21).daylight, '04:07')
  })

  it('follows daylight saving time on the local clocks', () => {
    // Europe moves the clocks forward on 29 March 2026: sunrise jumps by about an hour.
    const jump = times(on(rome, 3, 29).sun).rise - times(on(rome, 3, 28).sun).rise
    expect(jump).toBeGreaterThan(0.95)
    expect(on(rome, 3, 29).offset - on(rome, 3, 28).offset).toBe(60)
    // Sydney is on summer time in December (UTC+11).
    expect(on(sydney, 12, 21).offset).toBe(660)
  })

  it('lets a sunset fall after midnight', () => {
    const set = times(on(reykjavik, 6, 21).sun).set
    expect(dayShift(set)).toBe(1)
    near(set - 24, '00:03')
    expect(on(reykjavik, 6, 21).civil).toBe('up') // no darkness at all: white night
  })

  it('knows the polar night and the midnight sun', () => {
    expect(on(tromso, 12, 21).sun).toBe('down')
    expect(on(tromso, 12, 21).daylight).toBe(0)
    expect(on(tromso, 6, 21).sun).toBe('up')
    expect(on(tromso, 6, 21).daylight).toBe(24)
    // Published spans: about 27 Nov – 15 Jan without sunrise, 18 May – 25 Jul without sunset.
    expect(tromso.filter((d) => d.sun === 'down').length).toBeGreaterThan(44)
    expect(tromso.filter((d) => d.sun === 'down').length).toBeLessThan(52)
    expect(tromso.filter((d) => d.sun === 'up').length).toBeGreaterThan(64)
    expect(tromso.filter((d) => d.sun === 'up').length).toBeLessThan(72)
  })

  it('keeps solar noon on the local day far from the zone meridian', () => {
    // Kiritimati keeps UTC+14 at 157° W: noon would land on the wrong UTC date without the correction.
    const kiritimati = sunYear(1.87, -157.43, 'Pacific/Kiritimati', year)
    for (const d of kiritimati) expect(d.noon).toBeGreaterThan(11.5)
    expect(on(kiritimati, 6, 21).daylight).toBeGreaterThan(12)
    expect(on(kiritimati, 6, 21).daylight).toBeLessThan(12.5)
  })

  it('covers every day, leap years included', () => {
    expect(rome).toHaveLength(365)
    expect(sunYear(41.9, 12.5, 'Europe/Rome', 2028)).toHaveLength(366)
  })

  it('falls back to solar time without a zone', () => {
    const days = sunYear(41.8933, 12.4829, null, year)
    expect(on(days, 6, 21).offset).toBe(60)
    expect(on(days, 6, 21).daylight).toBeCloseTo(on(rome, 6, 21).daylight, 5)
  })
})

describe('sunToday', () => {
  it('uses the calendar day of the place', () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in Auckland.
    const day = sunToday(-36.85, 174.76, 'Pacific/Auckland', new Date(Date.UTC(2026, 11, 31, 20)))
    expect(day.date).toBe(Date.UTC(2027, 0, 1))
    expect(day.daylight).toBeGreaterThan(14)
  })
})

describe('formatting', () => {
  it('formats clock times, durations and changes', () => {
    expect(formatClock(5.5)).toBe('05:30')
    expect(formatClock(24.05)).toBe('00:03')
    expect(formatClock(23.999)).toBe('00:00')
    expect(dayShift(23.999)).toBe(1)
    expect(dayShift(-0.5)).toBe(-1)
    expect(formatDuration(15.2333)).toBe('15 h 14 min')
    expect(formatDuration(24)).toBe('24 h')
    expect(formatDuration(0.75)).toBe('45 min')
    expect(formatChange(1 / 30)).toBe('+2 min')
    expect(formatChange(-65 / 60)).toBe('−1 h 05 min')
    expect(formatChange(0.001)).toBe('±0 min')
  })
})

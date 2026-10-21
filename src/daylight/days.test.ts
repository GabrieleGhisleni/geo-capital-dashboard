import { describe, expect, it } from 'vitest'
import type { SunDay } from '../sunTimes'
import { dayLabel, hourTicks, span, sunSummary } from './days'

const day = (sun: SunDay['sun'], civil: SunDay['civil'] = sun): SunDay => ({
  date: Date.UTC(2026, 5, 21),
  noon: 13.2,
  sun,
  civil,
  daylight: 0,
  offset: 120,
})

describe('days', () => {
  it('labels dates in Italian', () => {
    expect(dayLabel(Date.UTC(2026, 5, 21))).toBe('21 giugno')
    expect(dayLabel(Date.UTC(2026, 11, 1), true)).toBe('1 dic')
  })

  it('turns crossings into spans of local hours', () => {
    expect(span({ rise: 5.5, set: 20.8 }, 13.2)).toEqual([5.5, 20.8])
    expect(span('up', 13.5)).toEqual([1.5, 25.5]) // a full day around solar noon
    expect(span('down', 13.5)).toBeNull()
  })

  it('picks clean hour ticks', () => {
    expect(hourTicks([4.1, 21.1])).toEqual([0, 4, 8, 12, 16, 20, 24])
    expect(hourTicks([9.13, 15.23])).toEqual([8, 10, 12, 14, 16, 18])
    expect(hourTicks([12.05, 12.2])).toEqual([11.75, 12, 12.25, 12.5])
    expect(hourTicks([0, 24])).toEqual([0, 4, 8, 12, 16, 20, 24])
  })

  it('describes the day, polar ones included', () => {
    expect(sunSummary(day({ rise: 5.58, set: 20.8 }))).toBe('alba 05:35 · tramonto 20:48')
    expect(sunSummary(day({ rise: 2.92, set: 24.05 }, 'up'))).toBe('alba 02:55 · tramonto 00:03 (dopo mezzanotte)')
    expect(sunSummary(day('up'))).toBe('il sole non tramonta')
    expect(sunSummary(day('down', { rise: 9.5, set: 13.9 }))).toBe('il sole non sorge, solo crepuscolo')
    expect(sunSummary(day('down'))).toBe('notte polare, senza crepuscolo')
  })
})

import { describe, expect, it } from 'vitest'
import { isNight, nightPolygon, subsolarPoint } from './sun'

describe('subsolarPoint', () => {
  it('puts the sun near Greenwich at noon UTC and over the Tropic of Cancer at the June solstice', () => {
    const [lon, lat] = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0)))
    expect(Math.abs(lon)).toBeLessThan(1)
    expect(lat).toBeCloseTo(23.44, 0)
  })

  it('moves west by 15° per hour', () => {
    const [a] = subsolarPoint(new Date(Date.UTC(2026, 2, 1, 12, 0)))
    const [b] = subsolarPoint(new Date(Date.UTC(2026, 2, 1, 13, 0)))
    expect(a - b).toBeCloseTo(15, 0)
  })
})

describe('night', () => {
  const juneNoon = new Date(Date.UTC(2026, 5, 21, 12, 0))

  it('knows day from night', () => {
    expect(isNight(juneNoon, 12.5, 41.9)).toBe(false) // Rome at noon
    expect(isNight(juneNoon, 151.2, -33.9)).toBe(true) // Sydney at 22:00
    expect(isNight(juneNoon, 0, 85)).toBe(false) // polar day
    expect(isNight(juneNoon, 0, -85)).toBe(true) // polar night
  })

  it('closes the polygon over the dark pole', () => {
    const ring = nightPolygon(juneNoon).geometry.coordinates[0]
    expect(ring.at(-2)).toEqual([-180, -90])
    expect(ring[0]).toEqual(ring.at(-1))
    const december = nightPolygon(new Date(Date.UTC(2026, 11, 21, 12, 0))).geometry.coordinates[0]
    expect(december.at(-2)).toEqual([-180, 90])
  })
})

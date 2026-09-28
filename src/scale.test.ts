import { describe, expect, it } from 'vitest'
import { colorAt, formatMetric, logDomain, metricValue, niceLogTicks, RAMPS, scalePosition } from './scale'

describe('logDomain', () => {
  it('trims outliers to the 2nd–98th percentile on large sets', () => {
    const values = [1, ...Array.from({ length: 98 }, (_, i) => 1000 * (i + 1)), 1e12]
    const [lo, hi] = logDomain(values)!
    expect(lo).toBeGreaterThan(3)
    expect(hi).toBeLessThan(6)
  })

  it('ignores non-positive and non-finite values', () => {
    expect(logDomain([0, -5, NaN, 100, 1000])).toEqual([2, 3])
  })

  it('widens a degenerate domain', () => {
    expect(logDomain([50, 50])).toEqual([Math.log10(50) - 0.5, Math.log10(50) + 0.5])
  })

  it('returns null without usable values', () => {
    expect(logDomain([0, NaN])).toBeNull()
  })
})

describe('scalePosition', () => {
  it('maps log values into 0–1 and clamps', () => {
    expect(scalePosition(100, [1, 3])).toBe(0.5)
    expect(scalePosition(1, [1, 3])).toBe(0)
    expect(scalePosition(1e9, [1, 3])).toBe(1)
  })
})

describe('niceLogTicks', () => {
  it('uses decades on wide ranges', () => {
    expect(niceLogTicks([3.2, 8.1])).toEqual([1e4, 1e5, 1e6, 1e7, 1e8])
  })

  it('falls back to finer round steps on narrow ranges', () => {
    const ticks = niceLogTicks([Math.log10(40), Math.log10(600)])
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.every((t) => t >= 40 && t <= 600)).toBe(true)
  })

  it('thins out to the requested maximum', () => {
    expect(niceLogTicks([0, 9], 4).length).toBeLessThanOrEqual(4)
  })
})

describe('colorAt', () => {
  it('returns the ramp ends and interpolates between stops', () => {
    const ramp = RAMPS.population
    expect(colorAt(0, ramp)).toBe(ramp[0])
    expect(colorAt(1, ramp)).toBe(ramp[ramp.length - 1])
    expect(colorAt(0.5, ['#000000', '#ffffff'])).toBe('#808080')
  })
})

describe('metricValue', () => {
  it('computes density and handles missing data', () => {
    expect(metricValue({ population: 1000, area: 10 }, 'density')).toBe(100)
    expect(metricValue({ population: 1000, area: null }, 'density')).toBeNull()
    expect(metricValue({ population: 1000 }, 'none')).toBeNull()
  })
})

describe('formatMetric (US$)', () => {
  it('uses Italian Mln/Mld units instead of the ambiguous Bln', () => {
    expect(formatMetric(5_051_000_000_000, 'gdp')).toBe('5051 Mld $') // it-IT groups thousands only from 5 digits
    expect(formatMetric(2_550_000_000, 'gdp')).toBe('2,6 Mld $')
    expect(formatMetric(60_496, 'gdpPerCapita')).toBe('60.496 $')
  })
})

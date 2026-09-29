import { describe, expect, it } from 'vitest'
import {
  buildScale,
  colorAt,
  formatMetric,
  formatShare,
  linearDomain,
  logDomain,
  metricValue,
  niceLinearTicks,
  niceLogTicks,
  positionOn,
  RAMPS,
  scalePosition,
} from './scale'

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

describe('linear scales', () => {
  it('uses a linear scale for life expectancy and a log one for the rest', () => {
    expect(buildScale([55, 70, 85], 'lifeExpectancy')?.kind).toBe('linear')
    expect(buildScale([1e3, 1e6], 'population')?.kind).toBe('log')
  })

  it('maps values linearly into 0–1 and clamps', () => {
    const scale = buildScale([60, 80], 'lifeExpectancy')!
    expect(positionOn(70, scale)).toBe(0.5)
    expect(positionOn(50, scale)).toBe(0)
    expect(positionOn(90, scale)).toBe(1)
  })

  it('trims outliers and widens a degenerate domain', () => {
    const values = [10, ...Array.from({ length: 98 }, (_, i) => 60 + i * 0.2), 200]
    const [lo, hi] = linearDomain(values)!
    expect(lo).toBeGreaterThan(50)
    expect(hi).toBeLessThan(100)
    expect(linearDomain([70, 70])).toEqual([69, 71])
    expect(linearDomain([])).toBeNull()
  })

  it('places round, evenly spaced ticks', () => {
    expect(niceLinearTicks([52.3, 85.1])).toEqual([60, 70, 80])
    expect(niceLinearTicks([0, 100])).toEqual([0, 25, 50, 75, 100])
  })
})

describe('formatShare', () => {
  it('formats shares of a whole in Italian', () => {
    expect(formatShare(2_748_109, 58_915_656)).toBe('4,7%')
    expect(formatShare(10_000_000, 58_915_656)).toBe('17%')
    expect(formatShare(1, 58_915_656)).toBe('<0,1%')
  })

  it('returns null without a whole', () => {
    expect(formatShare(5, 0)).toBeNull()
    expect(formatShare(null, 10)).toBeNull()
  })
})

it('formats life expectancy in years', () => {
  expect(formatMetric(83.456, 'lifeExpectancy')).toBe('83,5 anni')
  expect(metricValue({ lifeExpectancy: 80 }, 'lifeExpectancy')).toBe(80)
})

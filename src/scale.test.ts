import { describe, expect, it } from 'vitest'
import { classIndex, metricValue, niceRound, quantileBreaks, rampFor, RAMP_LIGHT } from './scale'

describe('quantileBreaks', () => {
  it('splits a uniform range into ascending thresholds', () => {
    const values = Array.from({ length: 700 }, (_, i) => i + 1)
    const breaks = quantileBreaks(values, 7)
    expect(breaks).toHaveLength(6)
    expect([...breaks].sort((a, b) => a - b)).toEqual(breaks)
    expect(breaks[0]).toBe(100)
  })

  it('collapses duplicate thresholds for skewed data', () => {
    const values = [...Array(50).fill(1), 1000]
    expect(quantileBreaks(values, 7)).toEqual([])
  })

  it('ignores non-finite values', () => {
    expect(quantileBreaks([NaN, Infinity, 5, 10], 2)).toEqual([10])
  })
})

describe('classIndex', () => {
  it('counts thresholds at or below the value', () => {
    expect(classIndex(5, [10, 20])).toBe(0)
    expect(classIndex(10, [10, 20])).toBe(1)
    expect(classIndex(99, [10, 20])).toBe(2)
  })
})

describe('niceRound', () => {
  it('keeps two significant digits', () => {
    expect(niceRound(58_993_475)).toBe(59_000_000)
    expect(niceRound(0.1234)).toBeCloseTo(0.12)
  })
})

describe('rampFor', () => {
  it('spreads colors across the ramp ends', () => {
    const r = rampFor(3, RAMP_LIGHT)
    expect(r).toEqual([RAMP_LIGHT[0], RAMP_LIGHT[3], RAMP_LIGHT[6]])
  })
})

describe('metricValue', () => {
  it('computes density and handles missing data', () => {
    expect(metricValue({ population: 1000, area: 10 }, 'density')).toBe(100)
    expect(metricValue({ population: 1000, area: null }, 'density')).toBeNull()
    expect(metricValue({ population: 1000 }, 'none')).toBeNull()
  })
})

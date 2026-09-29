import type { MultiPolygon, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { labelPoint } from './labelPoint'

const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
]

describe('labelPoint', () => {
  it('centers a square', () => {
    const [x, y] = labelPoint({ type: 'Polygon', coordinates: [square(10, 0, 2)] })!
    expect(x).toBeCloseTo(11, 1)
    expect(y).toBeCloseTo(1, 1)
  })

  it('stays inside a U shape, where the centroid falls in the gap', () => {
    const u: Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6], [0, 0]]],
    }
    const [x, y] = labelPoint(u)!
    const inGap = x > 2 && x < 4 && y > 2
    expect(inGap).toBe(false)
    expect(x >= 0 && x <= 6 && y >= 0 && y <= 6).toBe(true)
  })

  it('labels the largest part of a multipolygon', () => {
    const islands: MultiPolygon = { type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [square(20, 20, 4)]] }
    const [x, y] = labelPoint(islands)!
    expect(x).toBeCloseTo(22, 0)
    expect(y).toBeCloseTo(22, 0)
  })

  it('has no point for other geometries', () => {
    expect(labelPoint({ type: 'Point', coordinates: [0, 0] })).toBeNull()
    expect(labelPoint(null)).toBeNull()
  })
})

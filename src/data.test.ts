import { describe, expect, it } from 'vitest'
import { colorIndices } from './data'

describe('colorIndices', () => {
  it('gives neighbouring regions different colors', () => {
    // A wheel: a hub touching five regions that also touch each other in a ring.
    const adjacency = [[1, 2, 3, 4, 5], [0, 2, 5], [0, 1, 3], [0, 2, 4], [0, 3, 5], [0, 4, 1]]
    const colors = colorIndices(adjacency)
    adjacency.forEach((next, i) => next.forEach((j) => expect(colors[i]).not.toBe(colors[j])))
    expect(Math.max(...colors)).toBeLessThanOrEqual(3)
  })

  it('reuses the first color for regions without neighbours', () => {
    expect(colorIndices([[], []])).toEqual([0, 0])
  })
})

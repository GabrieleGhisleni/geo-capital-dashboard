import { describe, expect, it } from 'vitest'
import { readUrlState, writeUrlState } from './urlState'

describe('url state', () => {
  it('round-trips every field', () => {
    const s = {
      view: 'asia',
      metric: 'gdp',
      country: 'JPN',
      projection: 'mercator',
      background: 'relief',
      year: 1990,
      night: true,
    } as const
    expect(readUrlState(`#${writeUrlState(s)}`)).toEqual(s)
  })

  it('leaves defaults out of the address', () => {
    expect(writeUrlState({ view: 'europe', metric: 'population', projection: 'globe', background: 'plain' })).toBe('')
  })

  it('ignores unknown or malformed values', () => {
    expect(readUrlState('#v=mars&m=happiness&c=italy&p=cube&b=neon&y=12&n=yes')).toEqual({})
    expect(readUrlState('')).toEqual({})
  })
})

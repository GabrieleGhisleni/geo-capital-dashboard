import { describe, expect, it } from 'vitest'
import { distinctOffsets, formatOffset, localTime, offsetMinutes } from './time'

const summer = new Date(Date.UTC(2026, 6, 1, 12, 0))
const winter = new Date(Date.UTC(2026, 0, 15, 12, 0))

describe('time zones', () => {
  it('reads offsets with daylight saving', () => {
    expect(offsetMinutes('Europe/Rome', summer)).toBe(120)
    expect(offsetMinutes('Europe/Rome', winter)).toBe(60)
    expect(offsetMinutes('Asia/Kolkata', summer)).toBe(330)
    expect(offsetMinutes('America/New_York', winter)).toBe(-300)
    expect(offsetMinutes('UTC', winter)).toBe(0)
    expect(offsetMinutes('Not/AZone', winter)).toBeNull()
  })

  it('formats local time and offsets', () => {
    expect(localTime('Europe/Rome', summer)).toBe('14:00')
    expect(formatOffset(120)).toBe('UTC+2')
    expect(formatOffset(-210)).toBe('UTC−3:30')
    expect(formatOffset(0)).toBe('UTC')
  })

  it('merges zones sharing an offset', () => {
    expect(distinctOffsets(['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Harbin'], winter)).toEqual([360, 480])
    expect(distinctOffsets(['America/Chicago', 'America/Indiana/Knox', 'America/New_York'], winter)).toEqual([-360, -300])
  })
})

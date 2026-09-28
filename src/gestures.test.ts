import { describe, expect, it } from 'vitest'
import { classifyWheel, createWheelState, LATCH_MS, normalizeDelta, panDelta, type WheelLike } from './gestures'

const ev = (over: Partial<WheelLike>): WheelLike => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  ctrlKey: false,
  shiftKey: false,
  ...over,
})

/** Classifies a sequence of events spaced `gap` ms apart with a fresh latch. */
function run(events: Partial<WheelLike>[], gap = 16) {
  const state = createWheelState()
  return events.map((e, i) => classifyWheel(ev(e), state, 1000 + i * gap))
}

describe('classifyWheel', () => {
  it('lets pinch (ctrl+wheel) through to MapLibre', () => {
    expect(run([{ deltaY: -3.2, ctrlKey: true }, { deltaY: 1.7, deltaX: 0.4, ctrlKey: true }])).toEqual([
      'pinch',
      'pinch',
    ])
  })

  it.each([
    ['Linux Chrome, 120 px notch', { deltaY: 120 }],
    ['Linux Chrome, 100 px notch', { deltaY: -100 }],
    ['Chrome at 125% scaling', { deltaY: 96 }],
    ['Firefox Linux, 3 lines', { deltaMode: 1, deltaY: 3 }],
    ['Firefox page scrolling', { deltaMode: 2, deltaY: -1 }],
    ['macOS mouse wheel', { deltaY: 4.000244140625 * 3 }],
  ])('classifies a mouse wheel: %s', (_, e) => {
    expect(run([e])).toEqual(['wheel'])
  })

  it.each([
    ['fractional vertical scroll', { deltaY: 2.5 }],
    ['small integer vertical scroll', { deltaY: 6 }],
    ['diagonal scroll', { deltaX: 3, deltaY: 12 }],
    ['horizontal scroll', { deltaX: -40, deltaY: 0 }],
    ['fast fractional flick', { deltaY: 73.5 }],
  ])('classifies a trackpad pan: %s', (_, e) => {
    expect(run([e])).toEqual(['pan'])
  })

  it('keeps a fast trackpad swipe as pan even when a delta looks like a wheel notch', () => {
    expect(run([{ deltaY: 4.5 }, { deltaY: 38.25 }, { deltaY: 120 }, { deltaY: 100 }, { deltaY: 12 }])).toEqual([
      'pan',
      'pan',
      'pan',
      'pan',
      'pan',
    ])
  })

  it('keeps a mouse-wheel burst as wheel', () => {
    expect(run([{ deltaY: 120 }, { deltaY: 120 }, { deltaY: 240 }], 30)).toEqual(['wheel', 'wheel', 'wheel'])
  })

  it('releases the latch after a pause', () => {
    const state = createWheelState()
    expect(classifyWheel(ev({ deltaY: 2 }), state, 0)).toBe('pan')
    expect(classifyWheel(ev({ deltaY: 120 }), state, LATCH_MS - 1)).toBe('pan')
    expect(classifyWheel(ev({ deltaY: 120 }), state, 2 * LATCH_MS + 10)).toBe('wheel')
  })

  it('extends the latch with every event (long momentum tails stay pan)', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ deltaY: i === 30 ? 120 : 20 - i / 3 }))
    expect(new Set(run(events, LATCH_MS - 20))).toEqual(new Set(['pan']))
  })

  it('pinch does not break a latched pan', () => {
    const state = createWheelState()
    classifyWheel(ev({ deltaY: 2 }), state, 0)
    expect(classifyWheel(ev({ deltaY: 5, ctrlKey: true }), state, 10)).toBe('pinch')
    expect(classifyWheel(ev({ deltaY: 120 }), state, 20)).toBe('pan')
  })

  it('Shift+wheel always pans', () => {
    expect(run([{ deltaY: 120, shiftKey: true }])).toEqual(['pan'])
    expect(run([{ deltaMode: 1, deltaX: 3, shiftKey: true }])).toEqual(['pan'])
  })
})

describe('deltas', () => {
  it('normalizes lines and pages to pixels', () => {
    expect(normalizeDelta(ev({ deltaMode: 1, deltaX: 1, deltaY: -3 }))).toEqual([16, -48])
    expect(normalizeDelta(ev({ deltaMode: 2, deltaY: 1 }), 1000, 700)).toEqual([0, 700])
    expect(normalizeDelta(ev({ deltaX: 2.5, deltaY: -7 }))).toEqual([2.5, -7])
  })

  it('maps Shift+vertical wheel to a horizontal pan', () => {
    expect(panDelta(ev({ deltaY: 120, shiftKey: true }))).toEqual([120, 0])
    expect(panDelta(ev({ deltaX: -100, shiftKey: true }))).toEqual([-100, 0]) // Chrome already swaps the axes
    expect(panDelta(ev({ deltaX: 3, deltaY: -4 }))).toEqual([3, -4])
  })
})

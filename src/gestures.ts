import type { Map as MapLibre } from 'maplibre-gl'

/*
 * Trackpad-friendly wheel handling on top of MapLibre's scrollZoom:
 * - pinch (browsers send wheel + ctrlKey)       → MapLibre zooms around the pointer
 * - physical mouse wheel                         → MapLibre zooms
 * - two-finger trackpad scroll (and Shift+wheel) → we pan the map
 */

export type WheelKind = 'pinch' | 'wheel' | 'pan'

/** The subset of WheelEvent the classifier reads (deltaMode first: Firefox only reports lines if it is read first). */
export type WheelLike = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'shiftKey'>

/** Gesture latch: once classified, a burst of events keeps its kind until it pauses for LATCH_MS. */
export type WheelState = { kind: 'wheel' | 'pan' | null; until: number }

export const LATCH_MS = 180
export const LINE_HEIGHT_PX = 16
/** Smallest pixel delta a mouse-wheel notch produces in Chrome/Firefox on Linux and Windows (≈100–120). */
const MOUSE_NOTCH_MIN_PX = 50
/** macOS mouse wheels report multiples of this value (same constant as MapLibre's ScrollZoomHandler). */
const MAC_WHEEL_DELTA = 4.000244140625

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

export function createWheelState(): WheelState {
  return { kind: null, until: 0 }
}

/** Converts line/page deltas to pixels. */
export function normalizeDelta(e: WheelLike, pageWidth = 800, pageHeight = 600): [number, number] {
  const mode = e.deltaMode
  const kx = mode === DOM_DELTA_LINE ? LINE_HEIGHT_PX : mode === DOM_DELTA_PAGE ? pageWidth : 1
  const ky = mode === DOM_DELTA_LINE ? LINE_HEIGHT_PX : mode === DOM_DELTA_PAGE ? pageHeight : 1
  return [e.deltaX * kx, e.deltaY * ky]
}

const isIntegerish = (v: number) => Math.abs(v - Math.round(v)) < 0.01

function looksLikeMouseWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true // Firefox mouse wheel: ±3 lines (trackpads always report pixels)
  const { deltaX: dx, deltaY: dy } = e
  if (dx !== 0 || dy === 0) return false
  if (dy % MAC_WHEEL_DELTA === 0) return true
  return Math.abs(dy) >= MOUSE_NOTCH_MIN_PX && isIntegerish(dy)
}

/**
 * Classifies a wheel event. Pure apart from updating `state` (the gesture latch).
 * `now` is a millisecond timestamp (performance.now() or e.timeStamp).
 */
export function classifyWheel(e: WheelLike, state: WheelState, now: number): WheelKind {
  if (e.ctrlKey) return 'pinch' // trackpad pinch (or Ctrl+wheel): MapLibre zooms smoothly around the pointer
  let kind: 'wheel' | 'pan'
  if (e.shiftKey) kind = 'pan'
  else if (state.kind && now < state.until) kind = state.kind
  else kind = looksLikeMouseWheel(e) ? 'wheel' : 'pan'
  state.kind = kind
  state.until = now + LATCH_MS
  return kind
}

/** Pixel offset for map.panBy; Shift maps a vertical wheel onto horizontal panning. */
export function panDelta(e: WheelLike, pageWidth?: number, pageHeight?: number): [number, number] {
  const [dx, dy] = normalizeDelta(e, pageWidth, pageHeight)
  if (e.shiftKey) return [dx !== 0 ? dx : dy, 0]
  return [dx, dy]
}

/**
 * Installs trackpad panning. Keep map.scrollZoom enabled: pinch and mouse-wheel events are left
 * to MapLibre, pan events are stopped here (capture phase on the map container, which runs before
 * MapLibre's own listener on the canvas container). Returns the uninstaller.
 */
export function installWheelGestures(map: MapLibre): () => void {
  const container = map.getContainer()
  const canvasContainer = map.getCanvasContainer()
  const state = createWheelState()
  let pendingX = 0
  let pendingY = 0
  let frame = 0
  let lastEvent: WheelEvent | null = null

  const flush = () => {
    frame = 0
    const dx = pendingX
    const dy = pendingY
    pendingX = pendingY = 0
    if (dx || dy) map.panBy([dx, dy], { duration: 0 }, { originalEvent: lastEvent })
  }

  const onWheel = (e: WheelEvent) => {
    // Only the map surface; wheel over controls/attribution keeps its default behaviour.
    if (!(e.target instanceof Node) || !canvasContainer.contains(e.target)) return
    if (classifyWheel(e, state, e.timeStamp || performance.now()) !== 'pan') return
    e.preventDefault()
    e.stopPropagation()
    const [dx, dy] = panDelta(e, container.clientWidth, container.clientHeight)
    pendingX += dx
    pendingY += dy
    lastEvent = e
    if (!frame) frame = requestAnimationFrame(flush)
  }

  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => {
    container.removeEventListener('wheel', onWheel, { capture: true })
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
}

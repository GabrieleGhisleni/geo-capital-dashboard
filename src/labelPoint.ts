import type { Geometry, Position } from 'geojson'

/**
 * Where a region's name goes: the pole of inaccessibility (polylabel's grid search) of its largest part, so the
 * label sits well inside even crescent or U-shaped regions, where a centroid would fall outside. Longitudes are
 * scaled by cos(latitude) so "inside" is measured in roughly even units.
 */
export function labelPoint(geometry: Geometry | null): [number, number] | null {
  const polygons =
    geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
  let best: Position[][] | null = null
  let bestArea = 0
  for (const polygon of polygons) {
    const area = polygon[0] ? Math.abs(ringArea(polygon[0])) : 0
    if (area > bestArea) [best, bestArea] = [polygon, area]
  }
  if (!best) return null
  const [, s, , n] = bbox(best[0])
  const lat0 = (s + n) / 2
  const k = Math.cos((lat0 * Math.PI) / 180) || 1
  const rings = best.map((ring) => ring.map(([x, y]) => [x * k, y]))
  const [x, y] = poleOfInaccessibility(rings)
  return [x / k, y]
}

function ringArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return sum / 2
}

function bbox(ring: Position[]): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of ring) {
    w = Math.min(w, x)
    s = Math.min(s, y)
    e = Math.max(e, x)
    n = Math.max(n, y)
  }
  return [w, s, e, n]
}

type Cell = { x: number; y: number; h: number; d: number; max: number }

function cell(x: number, y: number, h: number, rings: Position[][]): Cell {
  const d = signedDistance(x, y, rings)
  return { x, y, h, d, max: d + h * Math.SQRT2 }
}

/** Grid refinement from polylabel (mapbox/polylabel, ISC): keep splitting the cells that could still hold a farther point. */
function poleOfInaccessibility(rings: Position[][]): [number, number] {
  const [w, s, e, n] = bbox(rings[0])
  const size = Math.min(e - w, n - s)
  if (size === 0) return [w, s]
  const precision = Math.max(e - w, n - s) / 200
  let h = size / 2
  const queue = new MaxHeap()
  for (let x = w; x < e; x += size) for (let y = s; y < n; y += size) queue.push(cell(x + h, y + h, h, rings))

  let best = centroidCell(rings)
  const middle = cell(w + (e - w) / 2, s + (n - s) / 2, 0, rings)
  if (middle.d > best.d) best = middle
  for (let c = queue.pop(); c; c = queue.pop()) {
    if (c.d > best.d) best = c
    if (c.max - best.d <= precision) continue
    h = c.h / 2
    queue.push(cell(c.x - h, c.y - h, h, rings))
    queue.push(cell(c.x + h, c.y - h, h, rings))
    queue.push(cell(c.x - h, c.y + h, h, rings))
    queue.push(cell(c.x + h, c.y + h, h, rings))
  }
  return [best.x, best.y]
}

function centroidCell(rings: Position[][]): Cell {
  const ring = rings[0]
  let [x, y, area] = [0, 0, 0]
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]]
    const f = a[0] * b[1] - b[0] * a[1]
    x += (a[0] + b[0]) * f
    y += (a[1] + b[1]) * f
    area += f * 3
  }
  return area === 0 ? cell(ring[0][0], ring[0][1], 0, rings) : cell(x / area, y / area, 0, rings)
}

/** Distance to the nearest edge, negative outside the polygon (holes count as outside). */
function signedDistance(x: number, y: number, rings: Position[][]): number {
  let inside = false
  let minSq = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i], ring[j]]
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
      minSq = Math.min(minSq, segmentDistanceSq(x, y, a, b))
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq)
}

function segmentDistanceSq(px: number, py: number, a: Position, b: Position): number {
  let [x, y] = a
  let dx = b[0] - x
  let dy = b[1] - y
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) [x, y] = b
    else if (t > 0) [x, y] = [x + dx * t, y + dy * t]
  }
  dx = px - x
  dy = py - y
  return dx * dx + dy * dy
}

/** Binary heap of cells by the best distance they could still contain. */
class MaxHeap {
  private items: Cell[] = []

  push(item: Cell) {
    const items = this.items
    items.push(item)
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1
      if (items[parent].max >= items[i].max) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }

  pop(): Cell | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (!items.length || !last) return top
    items[0] = last
    for (let i = 0; ; ) {
      const [l, r] = [2 * i + 1, 2 * i + 2]
      let m = i
      if (l < items.length && items[l].max > items[m].max) m = l
      if (r < items.length && items[r].max > items[m].max) m = r
      if (m === i) break
      ;[items[m], items[i]] = [items[i], items[m]]
      i = m
    }
    return top
  }
}

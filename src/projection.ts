import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

/*
 * Equal Earth (Šavrič, Patterson & Jenny 2018) rendered through MapLibre's Web Mercator pipeline.
 *
 * MapLibre only draws 'mercator' and 'globe', so for a flat equal-area view we project every
 * lon/lat with Equal Earth, scale the plane so the equator spans exactly the Mercator x range
 * [-π, π], and hand MapLibre the *fake* lon/lat whose Web Mercator position is that point
 * (lon = x, lat = atan(sinh(y))). Mercator's renderer is linear in its own plane, so it draws the
 * Equal Earth map; the uniform scale keeps areas proportional. The whole world ends up within
 * about ±65.54° of fake latitude, safely inside Mercator's ±85.05° limit.
 */

type BBox = [number, number, number, number]

const A1 = 1.340264
const A2 = -0.081106
const A3 = 0.000893
const A4 = 0.003796
const M = Math.sqrt(3) / 2
/** Equal Earth x of (λ=π, φ=0) is π/(M·A1); multiplying by M·A1 maps it onto Mercator's π. */
const SCALE = M * A1
const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const EPSILON = 1e-12
const ITERATIONS = 12
/** Longer segments are densified so curved meridians do not become long straight chords. */
const MAX_SEGMENT_DEG = 2

/** Raw Equal Earth on the unit sphere (radians in, planar units out). */
function forward(lambda: number, phi: number, out: number[]): void {
  const t = Math.asin(M * Math.sin(phi))
  const t2 = t * t
  const t6 = t2 * t2 * t2
  out[0] = (lambda * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
  out[1] = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
}

const tmp = [0, 0]

/** Equal Earth planar coordinates on the unit sphere (degrees in). Areas here are true areas × const. */
export function equalEarthXY(lon: number, lat: number): [number, number] {
  forward(lon * RAD, lat * RAD, tmp)
  return [tmp[0], tmp[1]]
}

function fakeLat(y: number): number {
  return Math.atan(Math.sinh(y * SCALE)) * DEG
}

/** lon/lat (degrees) → fake lon/lat that Web Mercator places where Equal Earth would. */
export function toEqualEarth(lon: number, lat: number): [number, number] {
  forward(lon * RAD, lat * RAD, tmp)
  return [tmp[0] * SCALE * DEG, fakeLat(tmp[1])]
}

/**
 * Inverse of toEqualEarth (Newton iteration on θ, as in the paper and d3-geo).
 * Latitude is clamped to ±90 for points above/below the map; longitudes outside the map
 * outline come back outside [-180, 180].
 */
export function fromEqualEarth(fakeLon: number, fakeLatDeg: number): [number, number] {
  const x = (fakeLon * RAD) / SCALE
  const y = Math.asinh(Math.tan(fakeLatDeg * RAD)) / SCALE
  let t = y
  let t2 = t * t
  let t6 = t2 * t2 * t2
  for (let i = 0; i < ITERATIONS; i++) {
    const fy = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y
    const fpy = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)
    const delta = fy / fpy
    t -= delta
    t2 = t * t
    t6 = t2 * t2 * t2
    if (Math.abs(delta) < EPSILON) break
  }
  const lambda = (M * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / Math.cos(t)
  const s = Math.max(-1, Math.min(1, Math.sin(t) / M))
  return [lambda * DEG, Math.asin(s) * DEG]
}

function projectPosition(p: Position): Position {
  forward(p[0] * RAD, p[1] * RAD, tmp)
  const out = [tmp[0] * SCALE * DEG, fakeLat(tmp[1])]
  for (let i = 2; i < p.length; i++) out.push(p[i])
  return out
}

/** Projects a line/ring, inserting vertices on segments longer than MAX_SEGMENT_DEG. */
function projectLine(line: Position[]): Position[] {
  const out: Position[] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    if (i > 0) {
      const q = line[i - 1]
      const dx = p[0] - q[0]
      const dy = p[1] - q[1]
      const span = Math.max(Math.abs(dx), Math.abs(dy))
      if (span > MAX_SEGMENT_DEG) {
        const steps = Math.ceil(span / MAX_SEGMENT_DEG)
        for (let k = 1; k < steps; k++) {
          const f = k / steps
          forward((q[0] + dx * f) * RAD, (q[1] + dy * f) * RAD, tmp)
          out.push([tmp[0] * SCALE * DEG, fakeLat(tmp[1])])
        }
      }
    }
    out.push(projectPosition(p))
  }
  return out
}

function projectLines(lines: Position[][]): Position[][] {
  const out: Position[][] = new Array(lines.length)
  for (let i = 0; i < lines.length; i++) out[i] = projectLine(lines[i])
  return out
}

const geometryCache = new WeakMap<Geometry, Geometry>()
const collectionCache = new WeakMap<FeatureCollection, FeatureCollection>()

/** Deep-maps a geometry into fake Equal Earth coordinates (memoized per input object). */
export function projectGeometry<G extends Geometry>(geometry: G): G {
  const cached = geometryCache.get(geometry)
  if (cached) return cached as G
  let out: Geometry
  switch (geometry.type) {
    case 'Point':
      out = { type: 'Point', coordinates: projectPosition(geometry.coordinates) }
      break
    case 'MultiPoint':
      out = { type: 'MultiPoint', coordinates: geometry.coordinates.map(projectPosition) }
      break
    case 'LineString':
      out = { type: 'LineString', coordinates: projectLine(geometry.coordinates) }
      break
    case 'MultiLineString':
      out = { type: 'MultiLineString', coordinates: projectLines(geometry.coordinates) }
      break
    case 'Polygon':
      out = { type: 'Polygon', coordinates: projectLines(geometry.coordinates) }
      break
    case 'MultiPolygon': {
      const polys = geometry.coordinates
      const coordinates: Position[][][] = new Array(polys.length)
      for (let i = 0; i < polys.length; i++) coordinates[i] = projectLines(polys[i])
      out = { type: 'MultiPolygon', coordinates }
      break
    }
    case 'GeometryCollection':
      out = { type: 'GeometryCollection', geometries: geometry.geometries.map((g) => projectGeometry(g)) }
      break
  }
  geometryCache.set(geometry, out)
  return out as G
}

/**
 * Projects every feature's geometry; properties and ids are shared, not copied.
 * Memoized per input collection, so calling it on every render is free.
 */
export function projectFeatureCollection<G extends Geometry | null, P>(
  fc: FeatureCollection<G, P>,
): FeatureCollection<G, P> {
  const cached = collectionCache.get(fc as FeatureCollection)
  if (cached) return cached as unknown as FeatureCollection<G, P>
  const features: Feature<G, P>[] = new Array(fc.features.length)
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i]
    features[i] = f.geometry ? { ...f, geometry: projectGeometry(f.geometry as Geometry) as G } : f
  }
  const out: FeatureCollection<G, P> = { type: 'FeatureCollection', features }
  collectionCache.set(fc as FeatureCollection, out as unknown as FeatureCollection)
  return out
}

const BBOX_SAMPLES = 32
const NEAR_GLOBAL_SPAN = 350

function sampledExtent(w: number, s: number, e: number, n: number): BBox {
  let minX = Infinity
  let maxX = -Infinity
  const lats: number[] = []
  for (let i = 0; i <= BBOX_SAMPLES; i++) lats.push(s + ((n - s) * i) / BBOX_SAMPLES)
  if (s < 0 && n > 0) lats.push(0) // meridians bulge outward most at the equator
  for (const lat of lats) {
    for (const lon of [w, e]) {
      forward(lon * RAD, lat * RAD, tmp)
      const x = tmp[0] * SCALE * DEG
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
  }
  // y depends on latitude only and is monotonic.
  return [minX, fakeLat(equalEarthXY(0, s)[1]), maxX, fakeLat(equalEarthXY(0, n)[1])]
}

/**
 * Transforms a lon/lat bbox [w, s, e, n] into a fake-coordinate bbox for fitBounds/cameraForBounds.
 * Edges are sampled because Equal Earth meridians curve.
 *
 * Antimeridian (east > 180): in Equal Earth the two halves sit on opposite edges of the map, so
 * - a near-global span (≥ 350°, e.g. Antarctica's [0, 359.8]) becomes the full map width;
 * - otherwise the larger of the two halves ([w, 180] or [-180, e − 360]) is used
 *   (Fiji, Oceania → west half; Kiribati → Line Islands half).
 */
export function projectBBox([w, s, e, n]: BBox): BBox {
  s = Math.max(-90, s)
  n = Math.min(90, n)
  if (e - w >= NEAR_GLOBAL_SPAN) return sampledExtent(-180, s, 180, n)
  if (e > 180) return 180 - w >= e - 180 ? sampledExtent(w, s, 180, n) : sampledExtent(-180, s, e - 360, n)
  if (w < -180) return -180 - w > e + 180 ? sampledExtent(w + 360, s, 180, n) : sampledExtent(-180, s, e, n)
  return sampledExtent(w, s, e, n)
}

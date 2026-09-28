import type { FeatureCollection, Geometry, Polygon, Position } from 'geojson'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import { describe, expect, it } from 'vitest'
import topoRaw from '../public/data/countries.topo.json?raw'
import {
  equalEarthXY,
  fromEqualEarth,
  projectBBox,
  projectFeatureCollection,
  projectGeometry,
  toEqualEarth,
} from './projection'

const MAX_MERCATOR_LAT = 85.051129
const FAKE_LAT_LIMIT = 65.542 // atan(sinh(y(90°) · M · A1))

const topo = JSON.parse(topoRaw) as Topology
const shapes = feature(topo, topo.objects[Object.keys(topo.objects)[0]]) as unknown as FeatureCollection<
  Geometry,
  { id: string }
>

function rings(g: Geometry): Position[][] {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  return []
}

function shoelace(ring: [number, number][]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(a) / 2
}

/** Densified outline of a lon/lat cell, so curved meridians are captured. */
function cell(lon: number, lat: number, size: number, steps = 50): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < steps; i++) pts.push([lon + (size * i) / steps, lat])
  for (let i = 0; i < steps; i++) pts.push([lon + size, lat + (size * i) / steps])
  for (let i = 0; i < steps; i++) pts.push([lon + size - (size * i) / steps, lat + size])
  for (let i = 0; i < steps; i++) pts.push([lon, lat + size - (size * i) / steps])
  return pts
}

describe('Equal Earth forward', () => {
  // Hand-derived from the paper's formulas: x = 2√3·λ·cosθ / (3(9A4θ⁸ + 7A3θ⁶ + 3A2θ² + A1)), y = A4θ⁹ + A3θ⁷ + A2θ³ + A1θ
  it.each([
    [90, 45, 1.1598544991029835, 0.8602310855220102],
    [180, 0, 2.7066299836960743, 0],
    [-30, -60, -0.3398433479285932, -1.0883008355053194],
    [0, 90, 0, 1.317362759157413],
  ])('equalEarthXY(%d, %d)', (lon, lat, x, y) => {
    const [px, py] = equalEarthXY(lon, lat)
    expect(px).toBeCloseTo(x, 12)
    expect(py).toBeCloseTo(y, 12)
  })

  it('maps the equator onto the full Mercator width and the poles inside ±85.05°', () => {
    expect(toEqualEarth(180, 0)[0]).toBeCloseTo(180, 10)
    expect(toEqualEarth(-180, 0)[0]).toBeCloseTo(-180, 10)
    const [, top] = toEqualEarth(0, 90)
    const [, bottom] = toEqualEarth(0, -90)
    expect(top).toBeCloseTo(FAKE_LAT_LIMIT, 2)
    expect(bottom).toBeCloseTo(-FAKE_LAT_LIMIT, 2)
    expect(top).toBeLessThan(MAX_MERCATOR_LAT)
  })
})

describe('fromEqualEarth', () => {
  it('round-trips a global grid to < 1e-6°', () => {
    let worst = 0
    for (let lat = -89; lat <= 89; lat += 2.5) {
      for (let lon = -180; lon <= 180; lon += 5) {
        const [fx, fy] = toEqualEarth(lon, lat)
        const [lon2, lat2] = fromEqualEarth(fx, fy)
        worst = Math.max(worst, Math.abs(lon2 - lon), Math.abs(lat2 - lat))
      }
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('round-trips the poles in latitude', () => {
    expect(fromEqualEarth(...toEqualEarth(40, 90))[1]).toBeCloseTo(90, 6)
    expect(fromEqualEarth(...toEqualEarth(-40, -90))[1]).toBeCloseTo(-90, 6)
  })

  it('clamps latitude for points above the map', () => {
    const [, lat] = fromEqualEarth(0, 80)
    expect(lat).toBe(90)
  })
})

describe('area preservation', () => {
  const trueRatio = (Math.sin((61 * Math.PI) / 180) - Math.sin((60 * Math.PI) / 180)) / Math.sin(Math.PI / 180)

  it('Equal Earth planar areas of 1°×1° cells scale like cos(lat)', () => {
    const eq = shoelace(cell(10, 0, 1).map(([lon, lat]) => equalEarthXY(lon, lat)))
    const north = shoelace(cell(10, 60, 1).map(([lon, lat]) => equalEarthXY(lon, lat)))
    expect(north / eq).toBeCloseTo(trueRatio, 6)
    expect(north / eq).toBeCloseTo(Math.cos((60.5 * Math.PI) / 180) / Math.cos((0.5 * Math.PI) / 180), 3)
    // Absolute scale: unit-sphere area of the cell.
    expect(eq).toBeCloseTo((Math.PI / 180) * Math.sin(Math.PI / 180), 8)
  })

  it('keeps areas proportional in the Web Mercator plane MapLibre renders', () => {
    const mercator = ([lon, lat]: [number, number]): [number, number] => {
      const [fx, fy] = toEqualEarth(lon, lat)
      return [(fx * Math.PI) / 180, Math.asinh(Math.tan((fy * Math.PI) / 180))]
    }
    const eq = shoelace(cell(-120, 0, 1).map(mercator))
    const north = shoelace(cell(40, 60, 1).map(mercator))
    const south = shoelace(cell(170, -61, 1).map(mercator))
    expect(north / eq).toBeCloseTo(trueRatio, 6)
    expect(south / eq).toBeCloseTo(trueRatio, 6)
  })
})

describe('projectGeometry', () => {
  it('maps every geometry type and keeps extra dimensions', () => {
    const [px, py] = toEqualEarth(10, 20)
    const p = projectGeometry({ type: 'Point', coordinates: [10, 20, 5] })
    expect(p.coordinates).toEqual([px, py, 5])
    const gc = projectGeometry({
      type: 'GeometryCollection',
      geometries: [
        { type: 'MultiPoint', coordinates: [[10, 20]] },
        { type: 'LineString', coordinates: [[10, 20], [11, 21]] },
        { type: 'MultiLineString', coordinates: [[[10, 20], [11, 21]]] },
        { type: 'MultiPolygon', coordinates: [[[[10, 20], [11, 20], [11, 21], [10, 20]]]] },
      ],
    })
    expect(gc.type).toBe('GeometryCollection')
    if (gc.type !== 'GeometryCollection') return
    expect(gc.geometries.map((g) => g.type)).toEqual(['MultiPoint', 'LineString', 'MultiLineString', 'MultiPolygon'])
    expect(gc.geometries[0].type === 'MultiPoint' && gc.geometries[0].coordinates[0]).toEqual([px, py])
  })

  it('densifies long segments so meridians follow the curved map edge', () => {
    const line = projectGeometry({ type: 'LineString', coordinates: [[180, -80], [180, 80]] })
    expect(line.coordinates.length).toBeGreaterThan(40)
    const mid = line.coordinates.find(([, lat]) => Math.abs(lat) < 1e-9)!
    expect(mid[0]).toBeCloseTo(180, 9) // the edge bulges out to x = 180 at the equator
  })

  it('does not mutate the input and memoizes per object', () => {
    const poly: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    const out = projectGeometry(poly)
    expect(poly.coordinates[0][1]).toEqual([1, 0])
    expect(projectGeometry(poly)).toBe(out)
  })
})

describe('projectFeatureCollection on countries.topo.json', () => {
  it('is fast and memoized', () => {
    const t0 = performance.now()
    const projected = projectFeatureCollection(shapes)
    const ms = performance.now() - t0
    console.info(`projectFeatureCollection(countries, ${shapes.features.length} features): ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(500)
    expect(projectFeatureCollection(shapes)).toBe(projected)
    expect(projected.features[0].properties).toBe(shapes.features[0].properties)
  })

  it('stays inside the map and creates no antimeridian streaks', () => {
    const projected = projectFeatureCollection(shapes)
    for (const f of projected.features) {
      let maxJump = 0
      for (const ring of rings(f.geometry)) {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = ring[i]
          expect(Math.abs(x)).toBeLessThanOrEqual(180 + 1e-9)
          expect(Math.abs(y)).toBeLessThanOrEqual(FAKE_LAT_LIMIT)
          if (i) maxJump = Math.max(maxJump, Math.abs(x - ring[i - 1][0]))
        }
      }
      expect(maxJump, f.properties.id).toBeLessThan(5)
    }
  })

  it.each(['RUS', 'FJI'])('%s keeps its pieces on both edges of the map', (id) => {
    const f = projectFeatureCollection(shapes).features.find((x) => x.properties.id === id)!
    const xs = rings(f.geometry).flat().map(([x]) => x)
    // Chukotka sits at ~66°N, where the map edge is already pulled in to x ≈ -129.
    expect(Math.min(...xs)).toBeLessThan(-100)
    expect(Math.max(...xs)).toBeGreaterThan(100)
    // Every ring lies on one side: no ring spans the whole map.
    for (const ring of rings(f.geometry)) {
      const rx = ring.map(([x]) => x)
      expect(Math.max(...rx) - Math.min(...rx)).toBeLessThan(180)
    }
  })
})

describe('projectBBox', () => {
  it('maps the whole world onto the map extent', () => {
    const [w, s, e, n] = projectBBox([-180, -90, 180, 90])
    expect(w).toBeCloseTo(-180, 9)
    expect(e).toBeCloseTo(180, 9)
    expect(s).toBeCloseTo(-FAKE_LAT_LIMIT, 2)
    expect(n).toBeCloseTo(FAKE_LAT_LIMIT, 2)
  })

  it('accounts for meridians bulging at the equator', () => {
    const [w, , e] = projectBBox([100, -10, 120, 10])
    expect(e).toBeCloseTo(toEqualEarth(120, 0)[0], 9)
    expect(w).toBeCloseTo(toEqualEarth(100, 10)[0], 9) // narrowest at the edge farthest from the equator
  })

  it('contains every projected vertex of each country', () => {
    let checked = 0
    for (const f of shapes.features) {
      const pts = rings(f.geometry).flat()
      const lons = pts.map(([x]) => x)
      const lats = pts.map(([, y]) => y)
      const bbox: [number, number, number, number] = [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ]
      if (bbox[2] - bbox[0] > 180) continue // split at the antimeridian (RUS, FJI, ATA, …)
      const [w, s, e, n] = projectBBox(bbox)
      for (const [x, y] of rings(projectGeometry(f.geometry)).flat()) {
        expect(x).toBeGreaterThanOrEqual(w - 1e-9)
        expect(x).toBeLessThanOrEqual(e + 1e-9)
        expect(y).toBeGreaterThanOrEqual(s - 1e-9)
        expect(y).toBeLessThanOrEqual(n + 1e-9)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('picks the larger half of antimeridian-crossing boxes', () => {
    const fiji = projectBBox([177.255, -18.264, 180.178, -16.153])
    expect(fiji[0]).toBeCloseTo(toEqualEarth(177.255, -18.264)[0], 9) // narrowest far from the equator
    expect(fiji[2]).toBeCloseTo(toEqualEarth(180, -16.153)[0], 9)
    const kiribati = projectBBox([172.933, 1.338, 202.824, 2.029])
    expect(kiribati[0]).toBeCloseTo(toEqualEarth(-180, 1.338)[0], 9)
    expect(kiribati[2]).toBeCloseTo(toEqualEarth(202.824 - 360, 2.029)[0], 9)
    const oceania = projectBBox([110, -48, 185, 2])
    expect(oceania[0]).toBeGreaterThan(0)
    const antarctica = projectBBox([0, -89.999, 359.815, -63.226])
    expect(antarctica[0]).toBeCloseTo(toEqualEarth(-180, -63.226)[0], 9)
    expect(antarctica[2]).toBeCloseTo(toEqualEarth(180, -63.226)[0], 9)
    const west = projectBBox([-185, 0, -170, 10])
    expect(west[0]).toBeCloseTo(toEqualEarth(-180, 0)[0], 9)
    expect(west[2]).toBeCloseTo(toEqualEarth(-170, 10)[0], 9)
  })
})

import type { FeatureCollection, Geometry } from 'geojson'
import { feature, neighbors } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { labelPoint } from './labelPoint'
import type { City, CityTuple, Country, History, HoverTarget, Meta, Metric, Region } from './types'

const BASE = import.meta.env.BASE_URL

export const dataUrl = (path: string) => `${BASE}data/${path}`
/** 4:3 SVG flag (flag-icons, copied by scripts/copy_flags.mjs), null for the few entities without an ISO code. */
export const flagUrl = (country: Pick<Country, 'iso2'>) => (country.iso2 ? `${BASE}flags/${country.iso2}.svg` : null)
export const glyphsUrl = () =>
  new URL(`${BASE}fonts/{fontstack}/{range}.pbf`, window.location.href).href.replace(
    /%7B(\w+)%7D/g,
    '{$1}',
  )

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function topoToGeo<P>(topo: Topology): FeatureCollection<Geometry, P> {
  const [name] = Object.keys(topo.objects)
  return feature(topo, topo.objects[name]) as unknown as FeatureCollection<Geometry, P>
}

export type Dataset = {
  countries: Record<string, Country>
  shapes: FeatureCollection<Geometry, { id: string }>
  cities: City[]
  citiesByCountry: Record<string, City[]>
  /** Countries sharing a land border (shared arcs in countries.topo.json), sorted by Italian name. */
  neighbors: Record<string, string[]>
  meta: Meta
}

/** Land neighbours from the topology: polygons that share a boundary arc. */
function countryNeighbors(topo: Topology, countries: Record<string, Country>): Record<string, string[]> {
  const [name] = Object.keys(topo.objects)
  const geometries = (topo.objects[name] as GeometryCollection).geometries ?? []
  const ids = geometries.map((g) => String(g.id ?? (g.properties as { id?: string } | undefined)?.id))
  const byName = (a: string, b: string) => (countries[a]?.name ?? a).localeCompare(countries[b]?.name ?? b, 'it')
  const out: Record<string, string[]> = {}
  neighbors(geometries as Parameters<typeof neighbors>[0]).forEach((list, i) => {
    out[ids[i]] = list.map((j) => ids[j]).filter((id) => countries[id]).sort(byName)
  })
  return out
}

export async function loadDataset(): Promise<Dataset> {
  const [countries, topo, rawCities, meta] = await Promise.all([
    getJson<Record<string, Country>>('countries.json'),
    getJson<Topology>('countries.topo.json'),
    getJson<Record<string, CityTuple[]>>('cities.json'),
    getJson<Meta>('meta.json'),
  ])
  const citiesByCountry: Record<string, City[]> = {}
  for (const [countryId, list] of Object.entries(rawCities)) {
    citiesByCountry[countryId] = list.map(([name, lat, lon, population]) => ({
      name,
      lat,
      lon,
      population,
      countryId,
    }))
  }
  return {
    countries,
    shapes: topoToGeo(topo),
    cities: Object.values(citiesByCountry).flat(),
    citiesByCountry,
    neighbors: countryNeighbors(topo, countries),
    meta,
  }
}

/** Greedy coloring: every region gets the lowest index none of its neighbours has (busiest regions first). */
export function colorIndices(adjacency: number[][]): number[] {
  const colors = new Array<number>(adjacency.length).fill(-1)
  const order = adjacency.map((_, i) => i).sort((a, b) => adjacency[b].length - adjacency[a].length)
  for (const i of order) {
    const taken = new Set(adjacency[i].map((j) => colors[j]))
    let c = 0
    while (taken.has(c)) c++
    colors[i] = c
  }
  return colors
}

function regionsFromTopo(topo: Topology, countryId: string): FeatureCollection<Geometry, Region> {
  const fc = topoToGeo<Region>(topo)
  const [name] = Object.keys(topo.objects)
  const geometries = (topo.objects[name] as GeometryCollection).geometries ?? []
  const colors = colorIndices(neighbors(geometries as Parameters<typeof neighbors>[0]))
  fc.features.forEach((f, i) => {
    f.properties = { ...f.properties, countryId, colorIndex: colors[i] ?? 0, label: labelPoint(f.geometry) }
  })
  return fc
}

/** Metrics with a yearly series (density is derived from the population series and today's area). */
export const HISTORY_METRICS = new Set<Metric>([
  'population',
  'density',
  'urbanShare',
  'gdp',
  'gdpPerCapita',
  'gdpPerCapitaPpp',
  'lifeExpectancy',
  'elderlyShare',
  'fertility',
  'co2PerCapita',
])

const historyCache = new Map<string, Promise<History>>()

/** Yearly series of a metric, fetched on first use (10–55 KB compressed each). */
export function loadHistory(metric: Metric): Promise<History> {
  const file = metric === 'density' ? 'population' : metric
  let pending = historyCache.get(file)
  if (!pending) {
    pending = getJson<{ from: number; values: History['values'] }>(`history/${file}.json`).then(({ from, values }) => {
      const length = Math.max(0, ...Object.values(values).map((v) => v.length))
      return { from, to: from + length - 1, values }
    })
    pending.catch(() => historyCache.delete(file))
    historyCache.set(file, pending)
  }
  return pending
}

/** A country's value for a year from its series (density: population over today's area). */
export function historyValue(history: History, country: Country, metric: Metric, year: number): number | null {
  const v = history.values[country.id]?.[year - history.from] ?? null
  if (v == null || metric !== 'density') return v
  return country.area ? v / country.area : null
}

const regionCache = new Map<string, Promise<FeatureCollection<Geometry, Region>>>()

export function loadRegions(countryId: string): Promise<FeatureCollection<Geometry, Region>> {
  let pending = regionCache.get(countryId)
  if (!pending) {
    pending = getJson<Topology>(`admin1/${countryId}.json`).then((t) => regionsFromTopo(t, countryId))
    pending.catch(() => regionCache.delete(countryId))
    regionCache.set(countryId, pending)
  }
  return pending
}

/** Country a map target belongs to (regions, capitals and cities included). */
export function targetCountryId(target: HoverTarget | null): string | null {
  if (!target) return null
  if (target.kind === 'country') return target.id
  if (target.kind === 'capital') return target.countryId
  if (target.kind === 'city') return target.city.countryId
  return target.region.countryId
}

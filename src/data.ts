import type { FeatureCollection, Geometry } from 'geojson'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import type { City, CityTuple, Country, Meta, Region } from './types'

const BASE = import.meta.env.BASE_URL

export const dataUrl = (path: string) => `${BASE}data/${path}`
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
  meta: Meta
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
    meta,
  }
}

const regionCache = new Map<string, Promise<FeatureCollection<Geometry, Region>>>()

export function loadRegions(countryId: string): Promise<FeatureCollection<Geometry, Region>> {
  let pending = regionCache.get(countryId)
  if (!pending) {
    pending = getJson<Topology>(`admin1/${countryId}.json`).then((t) => topoToGeo<Region>(t))
    pending.catch(() => regionCache.delete(countryId))
    regionCache.set(countryId, pending)
  }
  return pending
}

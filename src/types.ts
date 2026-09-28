export type Capital = {
  name: string
  lat: number
  lon: number
  population: number | null
}

export type Country = {
  id: string
  name: string
  nameEn: string
  iso2: string | null
  iso3: string | null
  continent: string
  subregion: string
  type: string
  population: number | null
  populationYear: number | null
  populationSource: string | null
  /** Current US$, World Bank. */
  gdp: number | null
  gdpYear: number | null
  gdpPerCapita: number | null
  gdpPerCapitaYear: number | null
  area: number | null
  areaSource: string | null
  capitals: Capital[]
  /** Natural Earth label point [lon, lat] and the zoom from which the name should appear. */
  label: [number, number] | null
  labelMinZoom: number | null
  bbox: [number, number, number, number]
  admin1Count: number
}

/** [name, lat, lon, population] — compact tuple to keep cities.json small. */
export type CityTuple = [string, number, number, number]

export type City = {
  name: string
  lat: number
  lon: number
  population: number
  countryId: string
}

export type Region = {
  id: string
  name: string
  type?: string
  iso?: string
  population?: number
  populationYear?: number
  area?: number
  capName?: string
  capLat?: number
  capLon?: number
  capPop?: number
}

export type Meta = {
  generatedAt: string
  sources: { name: string; url: string; license: string; usedFor: string }[]
}

export type Metric = 'population' | 'area' | 'density' | 'gdp' | 'gdpPerCapita' | 'none'

export type ViewId =
  | 'world'
  | 'europe'
  | 'asia'
  | 'africa'
  | 'north-america'
  | 'south-america'
  | 'oceania'

export type Projection = 'globe' | 'equal-earth' | 'mercator'

export type HoverTarget =
  | { kind: 'country'; id: string }
  | { kind: 'region'; region: Region }
  | { kind: 'city'; city: City }
  | { kind: 'capital'; countryId: string; capital: Capital }
  | { kind: 'region-capital'; region: Region }

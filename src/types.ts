export type Capital = {
  name: string
  lat: number
  lon: number
  population: number | null
  /** IANA zone of the nearest GeoNames place (e.g. Europe/Rome). */
  timezone?: string | null
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
  /** Life expectancy at birth in years, World Bank. */
  lifeExpectancy: number | null
  lifeExpectancyYear: number | null
  /** GDP per capita at purchasing power parity, current international $ (World Bank). */
  gdpPerCapitaPpp: number | null
  gdpPerCapitaPppYear: number | null
  /** Population aged 65 and over, % of total. */
  elderlyShare: number | null
  elderlyShareYear: number | null
  /** Births per woman. */
  fertility: number | null
  fertilityYear: number | null
  /** Urban population, % of total. */
  urbanShare: number | null
  urbanShareYear: number | null
  /** CO₂ emissions excluding land use, tonnes per person. */
  co2PerCapita: number | null
  co2PerCapitaYear: number | null
  area: number | null
  areaSource: string | null
  capitals: Capital[]
  /** Natural Earth label point [lon, lat] and the zoom from which the name should appear. */
  label: [number, number] | null
  labelMinZoom: number | null
  bbox: [number, number, number, number]
  admin1Count: number
  /** Every IANA zone used by the country's GeoNames places (several can share an offset). */
  timezones: string[]
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
  /** Current US$ (DOSE); gdp = per capita × the source's population. */
  gdp?: number
  gdpPerCapita?: number
  gdpYear?: number
  /** Years, OECD Regional Statistics. */
  lifeExpectancy?: number
  lifeExpectancyYear?: number
  capName?: string
  capLat?: number
  capLon?: number
  capPop?: number
  /** IANA zone of the regional capital (nearest GeoNames place). */
  timezone?: string
  /** Added on load: owning country, a color index that differs from every neighbouring region, and where the
   * name goes on the map (inside its largest part). */
  countryId: string
  colorIndex: number
  label: [number, number] | null
}

export type Meta = {
  generatedAt: string
  sources: { name: string; url: string; license: string; usedFor: string }[]
}

export type Metric =
  | 'population'
  | 'area'
  | 'density'
  | 'urbanShare'
  | 'gdp'
  | 'gdpPerCapita'
  | 'gdpPerCapitaPpp'
  | 'lifeExpectancy'
  | 'elderlyShare'
  | 'fertility'
  | 'co2PerCapita'
  | 'none'

export type ViewId =
  | 'world'
  | 'europe'
  | 'asia'
  | 'africa'
  | 'north-america'
  | 'south-america'
  | 'oceania'

export type Projection = 'globe' | 'equal-earth' | 'mercator'

/** Yearly World Bank series for the timeline: values[countryId][year - from]. */
export type History = { from: number; to: number; values: Record<string, (number | null)[]> }

/** Map background: flat colors, or NASA shaded relief under the fills. */
export type Background = 'plain' | 'relief'

export type HoverTarget =
  | { kind: 'country'; id: string }
  | { kind: 'region'; region: Region }
  | { kind: 'city'; city: City }
  | { kind: 'capital'; countryId: string; capital: Capital }
  | { kind: 'region-capital'; region: Region }

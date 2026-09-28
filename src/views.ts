import type { Metric, ViewId } from './types'

export type ViewDef = {
  id: ViewId
  label: string
  /** Natural Earth CONTINENT values in focus; empty = whole world. */
  continents: string[]
  /** [west, south, east, north]; east may exceed 180 to cross the antimeridian. */
  bounds: [number, number, number, number]
}

export const VIEWS: ViewDef[] = [
  { id: 'world', label: 'Mondo', continents: [], bounds: [-160, -55, 180, 75] },
  { id: 'europe', label: 'Europa', continents: ['Europe'], bounds: [-25, 34, 45, 71] },
  { id: 'asia', label: 'Asia', continents: ['Asia'], bounds: [25, -11, 150, 56] },
  { id: 'africa', label: 'Africa', continents: ['Africa'], bounds: [-19, -36, 53, 38] },
  {
    id: 'north-america',
    label: 'Nord America',
    continents: ['North America'],
    bounds: [-168, 6, -52, 72],
  },
  {
    id: 'south-america',
    label: 'Sud America',
    continents: ['South America'],
    bounds: [-83, -56, -34, 13],
  },
  { id: 'oceania', label: 'Oceania', continents: ['Oceania'], bounds: [110, -48, 185, 2] },
]

export const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v])) as Record<
  ViewId,
  ViewDef
>

export const CONTINENT_LABEL: Record<string, string> = {
  Europe: 'Europa',
  Asia: 'Asia',
  Africa: 'Africa',
  'North America': 'Nord America',
  'South America': 'Sud America',
  Oceania: 'Oceania',
  Antarctica: 'Antartide',
  'Seven seas (open ocean)': 'Oceani',
}

export const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'population', label: 'Popolazione', unit: 'abitanti' },
  { id: 'area', label: 'Superficie', unit: 'km²' },
  { id: 'density', label: 'Densità', unit: 'ab./km²' },
  { id: 'none', label: 'Nessuno', unit: '' },
]

export const SUBREGION_LABEL: Record<string, string> = {
  'Eastern Africa': 'Africa orientale',
  'Middle Africa': 'Africa centrale',
  'Northern Africa': 'Nordafrica',
  'Southern Africa': 'Africa australe',
  'Western Africa': 'Africa occidentale',
  Caribbean: 'Caraibi',
  'Central America': 'America centrale',
  'South America': 'Sud America',
  'Northern America': 'Nord America',
  'Central Asia': 'Asia centrale',
  'Eastern Asia': 'Asia orientale',
  'South-Eastern Asia': 'Sud-est asiatico',
  'Southern Asia': 'Asia meridionale',
  'Western Asia': 'Asia occidentale',
  'Eastern Europe': 'Europa orientale',
  'Northern Europe': 'Europa settentrionale',
  'Southern Europe': 'Europa meridionale',
  'Western Europe': 'Europa occidentale',
  'Australia and New Zealand': 'Australia e Nuova Zelanda',
  Melanesia: 'Melanesia',
  Micronesia: 'Micronesia',
  Polynesia: 'Polinesia',
  Antarctica: 'Antartide',
  'Seven seas (open ocean)': 'Oceani',
}

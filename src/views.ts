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

export type MetricGroup = 'Popolazione e territorio' | 'Economia' | 'Salute e società' | 'Ambiente' | null

/** `regional`: regions can carry it too. `group`: heading in the metric picker (null = no heading). */
export const METRICS: { id: Metric; label: string; unit: string; regional: boolean; group: MetricGroup }[] = [
  { id: 'population', label: 'Popolazione', unit: 'abitanti', regional: true, group: 'Popolazione e territorio' },
  { id: 'area', label: 'Superficie', unit: 'km²', regional: true, group: 'Popolazione e territorio' },
  { id: 'density', label: 'Densità', unit: 'ab./km²', regional: true, group: 'Popolazione e territorio' },
  { id: 'urbanShare', label: 'Popolazione urbana', unit: '%', regional: false, group: 'Popolazione e territorio' },
  { id: 'gdp', label: 'PIL', unit: 'US$', regional: true, group: 'Economia' },
  { id: 'gdpPerCapita', label: 'PIL pro capite', unit: 'US$', regional: true, group: 'Economia' },
  { id: 'gdpPerCapitaPpp', label: 'PIL p.c. (PPA)', unit: '$ internazionali', regional: false, group: 'Economia' },
  { id: 'lifeExpectancy', label: 'Aspettativa di vita', unit: 'anni', regional: true, group: 'Salute e società' },
  { id: 'elderlyShare', label: 'Over 65', unit: '%', regional: false, group: 'Salute e società' },
  { id: 'fertility', label: 'Figli per donna', unit: 'figli', regional: false, group: 'Salute e società' },
  { id: 'co2PerCapita', label: 'CO₂ pro capite', unit: 't/ab.', regional: false, group: 'Ambiente' },
  { id: 'none', label: 'Nessuno', unit: '', regional: false, group: null },
]

/** Longer explanations, shown as button titles. */
export const METRIC_HINT: Partial<Record<Metric, string>> = {
  gdpPerCapitaPpp: 'PIL pro capite a parità di potere d’acquisto: tiene conto dei prezzi locali',
  elderlyShare: 'Quota della popolazione con 65 anni o più',
  urbanShare: 'Quota della popolazione che vive in aree urbane',
  co2PerCapita: 'Emissioni di CO₂ per abitante, esclusi i cambi d’uso del suolo',
}

export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<Metric, (typeof METRICS)[number]>

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

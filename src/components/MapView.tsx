import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'
import {
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type PaddingOptions,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import { glyphsUrl, targetCountryId, type Dataset } from '../data'
import { installWheelGestures } from '../gestures'
import mapFonts from '../mapFonts.json'
import { fromEqualEarth, projectBBox, projectFeatureCollection, toEqualEarth } from '../projection'
import { nightPolygon } from '../sun'
import type { Background, City, HoverTarget, Projection, Region } from '../types'
import type { Theme } from '../useTheme'
import type { ViewDef } from '../views'

// Vite cannot follow MapLibre's computed worker URL, so point it at the bundled worker explicitly.
setWorkerUrl(workerUrl)

/** Scale position per feature id: 0–1 along the ramp, -1 = no data. Missing id = not colored. */
export type ValueMap = Record<string, number>

type SymbolLayout = NonNullable<Extract<StyleSpecification['layers'][number], { type: 'symbol' }>['layout']>
type BBox = [number, number, number, number]

type Props = {
  data: Dataset
  view: ViewDef
  projection: Projection
  /** 'relief': NASA shaded relief under semi-transparent fills (globe and Mercator only). */
  background: Background
  theme: Theme
  ramp: string[] | null
  countryValues: ValueMap
  focusIds: Set<string>
  selectedId: string | null
  /** Regions on the map: the selected country's, plus the one previewed on hover while studying. */
  regions: FeatureCollection<Geometry, Region> | null
  /** Only regions of countries with regional data for the metric: the others stay colored as a whole. */
  regionValues: ValueMap
  showCapitals: boolean
  showCities: boolean
  /** Country names on the map (hidden while studying, so they don't give answers away). */
  labels: boolean
  padding: PaddingOptions
  /** Clicks select countries (off while studying): drives the selection cursor. */
  interactive: boolean
  /** Bumped to re-frame the current view or selection (the "reset map" shortcut). */
  resetToken: number
  /** Night side shaded for this moment; null = off. */
  nightAt: Date | null
  /** Quiz "where is…?": every click goes to onMapClick (selection cursor everywhere, no selecting). */
  pickMode: boolean
  /** Quiz answer marks: where the user clicked and where the answer was, joined by a line. */
  quizMarks: { pick: [number, number]; answer: [number, number] } | null
  /** Region outlined for the regions quiz. */
  highlightRegionId: string | null
  /** Quiz progress per country: replaces the metric colors while set. */
  progress: Record<string, QuizStatus> | null
  onHover: (target: HoverTarget | null, x: number, y: number) => void
  /** A click that selects nothing (a region, a place of the selected country, empty map = null): phones show its
   * details, since they have no hover. Also called with null when the camera starts moving. */
  onInspect: (target: HoverTarget | null, x: number, y: number) => void
  onSelect: (countryId: string | null) => void
  /** Every click in pick mode: real lon/lat (also in Equal Earth) and the country under it, if any. */
  onMapClick: (lngLat: [number, number], countryId: string | null) => void
}

export type QuizStatus = 'ok' | 'ko' | 'todo'

const PALETTE = {
  light: {
    ocean: '#d5e3ec',
    land: '#f4f0e8',
    noData: '#e2ddd3',
    border: '#ffffff',
    outline: '#1d2330',
    text: '#1d2330',
    textMuted: '#5b6272',
    halo: 'rgba(255, 255, 255, 0.92)',
    dot: '#ffffff',
    sky: '#eaf1f6',
    horizon: '#ffffff',
    /** Tints that tell neighbouring regions apart when no metric colors them (no blue: it reads as sea). */
    regionTints: ['#f0dcb4', '#d3e4bd', '#f0c9c4', '#d9cdea', '#bfe0d6', '#f4e8a6'],
    night: '#0b1438',
    nightOpacity: 0.26,
    accent: '#5146c9',
    progress: { ok: '#3aa76d', ko: '#e0645c', todo: '#d8d2c6' },
  },
  dark: {
    ocean: '#15202b',
    land: '#2a2f38',
    noData: '#363c46',
    border: '#0f151c',
    outline: '#ffffff',
    text: '#f1f3f7',
    textMuted: '#aab2c0',
    halo: 'rgba(15, 21, 28, 0.9)',
    dot: '#0f151c',
    sky: '#0b1016',
    horizon: '#2a3a4c',
    regionTints: ['#57493a', '#3f5040', '#5a3f3f', '#483f5c', '#34514d', '#55522f'],
    night: '#000000',
    nightOpacity: 0.38,
    accent: '#8b83ff',
    progress: { ok: '#3f9e6b', ko: '#c95a53', todo: '#454b57' },
  },
} as const

/**
 * NASA GIBS "Blue Marble: shaded relief and bathymetry": public domain, no key, CORS open, levels 0–8 (MapLibre
 * overzooms beyond). The only runtime dependency on a third-party server, loaded only when the relief is chosen.
 */
const RELIEF_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'
const RELIEF_MAX_ZOOM = 8

const L = {
  relief: 'relief',
  night: 'night',
  regionTarget: 'region-target',
  quizLine: 'quiz-line',
  quizPoints: 'quiz-points',
  countryFill: 'country-fill',
  countryBorder: 'country-border',
  regionFill: 'region-fill',
  regionBorder: 'region-border',
  countryHover: 'country-hover',
  regionHover: 'region-hover',
  countrySelected: 'country-selected',
  countryLabel: 'country-label',
  citiesAll: 'cities-all',
  cities: 'cities',
  regionCap: 'region-cap',
  capital: 'capital',
} as const

/**
 * Cursor over what a click selects: a ring with a center dot in the app's accent color, outlined in white so it
 * reads on every fill. Elsewhere the map shows the plain arrow, and the closed hand while dragging.
 */
const SELECT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="8" fill="rgba(81,70,201,0.12)" stroke="#fff" stroke-width="4"/>' +
    '<circle cx="12" cy="12" r="8" fill="none" stroke="#5146c9" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="2.6" fill="#5146c9" stroke="#fff" stroke-width="1.2"/>' +
    '</svg>',
)}") 12 12, pointer`

const POINT_LAYERS = [L.capital, L.regionCap, L.cities, L.citiesAll]
const POLYGON_LAYERS = [L.regionFill, L.countryFill]
const HIT_RADIUS = 6
const FONT_MEDIUM = ['Manrope Medium']
const FONT_BOLD = ['Manrope Bold']
/** Glyph PBFs (Noto) cover scripts Manrope lacks; map the Manrope stack names onto them. */
const GLYPH_FALLBACK: Record<string, string> = {
  'Manrope Medium': 'Noto Sans Regular',
  'Manrope Bold': 'Noto Sans Bold',
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

function fontFaces(): StyleSpecification['font-faces'] {
  const base = new URL(`${import.meta.env.BASE_URL}fonts/map/`, window.location.href).href
  return Object.fromEntries(
    Object.entries(mapFonts).map(([name, faces]) => [
      name,
      faces.map((f) => ({ url: base + f.file, 'unicode-range': f['unicode-range'] })),
    ]),
  )
}

/** Continuous color from the `t` feature-state (0–1), with explicit no-data and uncolored states. */
function fillColor(ramp: string[] | null, land: string, noData: string): ExpressionSpecification {
  if (!ramp) return ['literal', land] as unknown as ExpressionSpecification
  const t: ExpressionSpecification = ['to-number', ['coalesce', ['feature-state', 't'], -2]]
  return [
    'case',
    ['<', t, -1.5],
    land,
    ['<', t, 0],
    noData,
    ['interpolate', ['linear'], t, ...ramp.flatMap((c, i) => [i / (ramp.length - 1), c])],
  ] as ExpressionSpecification
}

/**
 * Over the relief, fills turn see-through: metric colors stay readable but mountains and seabed show; with no metric
 * the land is left to the relief and only the countries out of focus get a light wash.
 */
function countryFillOpacity(relief: boolean, colored: boolean): ExpressionSpecification {
  const dim = relief ? (colored ? 0.25 : 0.45) : 0.3
  const base = relief ? (colored ? 0.62 : 0) : 1
  return [
    'case',
    ['boolean', ['feature-state', 'hidden'], false],
    0,
    ['boolean', ['feature-state', 'dim'], false],
    dim,
    base,
  ]
}

/** Regions without a value stay see-through while the country is colored as a whole (see syncAll). */
function regionFillOpacity(relief: boolean): ExpressionSpecification {
  return [
    'case',
    ['==', ['typeof', ['feature-state', 't']], 'number'],
    relief ? 0.62 : 1,
    ['boolean', ['feature-state', 'tint'], false],
    relief ? 0.4 : 1,
    0,
  ]
}

/** Regions: the metric's ramp where they have a value, otherwise a tint that differs from their neighbours'. */
function regionFillColor(ramp: string[] | null, p: Palette): ExpressionSpecification {
  const tints = p.regionTints
  const tint: ExpressionSpecification = [
    'match',
    ['%', ['coalesce', ['get', 'colorIndex'], 0], tints.length],
    ...tints.slice(0, -1).flatMap((c, i) => [i, c]),
    tints[tints.length - 1],
  ] as unknown as ExpressionSpecification
  if (!ramp) return tint
  return ['case', ['==', ['typeof', ['feature-state', 't']], 'number'], fillColor(ramp, p.land, p.noData), tint]
}

/** City dots grow gently with population (and zoom), always smaller than capitals. */
const cityIconSize: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  ['interpolate', ['linear'], ['sqrt', ['get', 'population']], 300, 0.45, 3000, 0.75],
  7,
  ['interpolate', ['linear'], ['sqrt', ['get', 'population']], 300, 0.6, 3000, 1],
]

type Palette = (typeof PALETTE)[Theme]

/**
 * Country names sit on the choropleth fill: dark ink on light fills, white ink on dark ones.
 * `t` (position on the color ramp) is copied onto the label points by syncAll.
 */
function countryLabelPaint(p: Palette) {
  const onDark: ExpressionSpecification = ['>', ['coalesce', ['get', 't'], -1], 0.58]
  return {
    'text-color': ['case', onDark, '#ffffff', p.text] as ExpressionSpecification,
    'text-halo-color': ['case', onDark, 'rgba(20, 22, 34, 0.55)', p.halo] as ExpressionSpecification,
  }
}

/** Dot icons, drawn on a canvas so symbol collision can keep labels from sitting on them. */
type DotSpec = { fill: string; stroke: string; size: number; line: number; core?: string }
const DOTS: Record<string, (p: Palette) => DotSpec> = {
  // Capitals are a bullseye (ring + center), so they read apart from the plain dots of big cities.
  'dot-capital': (p) => ({ fill: p.dot, stroke: p.text, size: 13, line: 2.2, core: p.text }),
  'dot-region': (p) => ({ fill: p.text, stroke: p.dot, size: 9, line: 1.6 }),
  'dot-city-strong': (p) => ({ fill: p.dot, stroke: p.text, size: 8, line: 1.4 }),
  'dot-city': (p) => ({ fill: p.dot, stroke: p.textMuted, size: 7, line: 1.2 }),
}
const DOT_PIXEL_RATIO = 3

function drawDot(spec: DotSpec) {
  const px = Math.ceil(spec.size * DOT_PIXEL_RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  const r = px / 2 - (spec.line * DOT_PIXEL_RATIO) / 2
  ctx.beginPath()
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2)
  ctx.fillStyle = spec.fill
  ctx.fill()
  ctx.lineWidth = spec.line * DOT_PIXEL_RATIO
  ctx.strokeStyle = spec.stroke
  ctx.stroke()
  if (spec.core) {
    ctx.beginPath()
    ctx.arc(px / 2, px / 2, px * 0.17, 0, Math.PI * 2)
    ctx.fillStyle = spec.core
    ctx.fill()
  }
  return ctx.getImageData(0, 0, px, px)
}

function syncDotImages(map: MapLibre, theme: Theme) {
  for (const [id, spec] of Object.entries(DOTS)) {
    const img = drawDot(spec(PALETTE[theme]))
    if (map.hasImage(id)) map.updateImage(id, img)
    else map.addImage(id, img, { pixelRatio: DOT_PIXEL_RATIO })
  }
}

function pointCollection<P>(items: P[], lngLat: (p: P) => [number, number] | null): FeatureCollection<Point, P> {
  const features: Feature<Point, P>[] = []
  for (const item of items) {
    const c = lngLat(item)
    if (c) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: item })
  }
  return { type: 'FeatureCollection', features }
}

/** Natural Earth's MIN_LABEL is tuned for its own maps; names show up this much earlier here. */
const LABEL_ZOOM_ADVANCE = 1.5

function countryLabelPoints(data: Dataset, values: ValueMap): FeatureCollection {
  return pointCollection(
    Object.values(data.countries)
      .filter((c) => c.continent !== 'Antarctica')
      .map((c) => ({
        id: c.id,
        name: c.name,
        population: c.population,
        minZoom: (c.labelMinZoom ?? 3) - LABEL_ZOOM_ADVANCE,
        t: values[c.id] ?? null,
      })),
    (c) => data.countries[c.id].label,
  )
}

/** All source data in real lon/lat; the equal-earth view re-projects it before handing it to MapLibre. */
function baseSources(data: Dataset) {
  const countries = Object.values(data.countries)
  return {
    countries: data.shapes as FeatureCollection,
    countryLabels: countryLabelPoints(data, {}),
    capitals: pointCollection(
      countries.flatMap((c) => c.capitals.map((cap) => ({ ...cap, countryId: c.id, sort: -(c.population ?? 0) }))),
      (c) => [c.lon, c.lat],
    ) as FeatureCollection,
    cities: pointCollection<City>(data.cities, (c) => [c.lon, c.lat]) as FeatureCollection,
  }
}

function inView<T extends FeatureCollection>(fc: T, projection: Projection): T {
  return projection === 'equal-earth' ? (projectFeatureCollection(fc) as T) : fc
}

function renderProjection(projection: Projection): 'globe' | 'mercator' {
  return projection === 'globe' ? 'globe' : 'mercator'
}

function buildStyle(data: Dataset, projection: Projection, theme: Theme): StyleSpecification {
  const p = PALETTE[theme]
  const src = baseSources(data)
  // Dot + optional label: when space is tight the name gives way, the dot stays.
  const place: SymbolLayout = {
    'text-field': ['get', 'name'],
    'text-font': FONT_MEDIUM,
    'text-size': 11,
    'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
    'text-radial-offset': 0.65,
    'text-justify': 'auto',
    'text-max-width': 8,
    'text-optional': true,
    'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'population'], 0]],
  }
  const halo = { 'text-halo-color': p.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 }

  return {
    version: 8,
    glyphs: glyphsUrl(),
    'font-faces': fontFaces(),
    projection: { type: renderProjection(projection) },
    sky: {
      'sky-color': p.sky,
      'horizon-color': p.horizon,
      'fog-color': p.sky,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.6, 7, 0],
    },
    sources: {
      countries: { type: 'geojson', data: inView(src.countries, projection), promoteId: 'id' },
      countryLabels: { type: 'geojson', data: inView(src.countryLabels, projection) },
      regions: { type: 'geojson', data: empty, promoteId: 'id' },
      capitals: { type: 'geojson', data: inView(src.capitals, projection) },
      cities: { type: 'geojson', data: inView(src.cities, projection) },
      regionCapitals: { type: 'geojson', data: empty },
      night: { type: 'geojson', data: empty },
      quizMarks: { type: 'geojson', data: empty },
      relief: {
        type: 'raster',
        tiles: [RELIEF_TILES],
        tileSize: 256,
        maxzoom: RELIEF_MAX_ZOOM,
        attribution: 'Rilievo: NASA Blue Marble (GIBS)',
      },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      {
        id: L.relief,
        type: 'raster',
        source: 'relief',
        layout: { visibility: 'none' },
        paint: reliefPaint(theme),
      },
      {
        id: L.countryFill,
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': fillColor(null, p.land, p.noData),
          'fill-opacity': countryFillOpacity(false, false),
          'fill-opacity-transition': { duration: 400 },
        },
      },
      {
        id: L.regionFill,
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': regionFillColor(null, p),
          'fill-opacity': regionFillOpacity(false),
        },
      },
      {
        id: L.regionBorder,
        type: 'line',
        source: 'regions',
        paint: { 'line-color': p.border, 'line-width': 0.9, 'line-opacity': 0.9 },
      },
      {
        id: L.countryBorder,
        type: 'line',
        source: 'countries',
        paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1.2] },
      },
      {
        id: L.night,
        type: 'fill',
        source: 'night',
        paint: { 'fill-color': p.night, 'fill-opacity': p.nightOpacity, 'fill-antialias': false },
      },
      {
        id: L.regionHover,
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': p.outline,
          'line-width': 1.6,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0],
        },
      },
      {
        id: L.countryHover,
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': p.outline,
          'line-width': 1.6,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0],
        },
      },
      {
        id: L.countrySelected,
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': p.outline,
          'line-width': 2.2,
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
        },
      },
      {
        id: L.regionTarget,
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': p.accent,
          'line-width': 3,
          'line-opacity': ['case', ['boolean', ['feature-state', 'target'], false], 1, 0],
        },
      },
      {
        id: L.quizLine,
        type: 'line',
        source: 'quizMarks',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': p.accent, 'line-width': 2, 'line-dasharray': [2, 2] },
      },
      {
        id: L.quizPoints,
        type: 'circle',
        source: 'quizMarks',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['match', ['get', 'kind'], 'pick', p.progress.ko, p.progress.ok],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      // Symbol layers are placed top-down: capitals first, then regional capitals, country names, cities.
      {
        id: L.citiesAll,
        type: 'symbol',
        source: 'cities',
        minzoom: 4.5,
        layout: {
          ...place,
          'icon-image': 'dot-city',
          'icon-size': cityIconSize,
          'text-field': ['step', ['zoom'], '', 5.5, ['get', 'name']],
          'text-size': 10.5,
        },
        paint: { 'text-color': p.textMuted, ...halo },
      },
      {
        id: L.cities,
        type: 'symbol',
        source: 'cities',
        filter: ['==', ['get', 'countryId'], ''],
        layout: { ...place, 'icon-image': 'dot-city-strong', 'icon-size': cityIconSize, 'text-size': 11 },
        paint: { 'text-color': p.textMuted, ...halo },
      },
      {
        id: L.regionCap,
        type: 'symbol',
        source: 'regionCapitals',
        layout: {
          ...place,
          'icon-image': 'dot-region',
          'icon-allow-overlap': true,
          'text-field': ['get', 'capName'],
          'text-font': FONT_BOLD,
          'text-size': 11.5,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'capPop'], ['get', 'population'], 0]],
        },
        paint: { 'text-color': p.text, ...halo },
      },
      {
        id: L.capital,
        type: 'symbol',
        source: 'capitals',
        layout: {
          ...place,
          'icon-image': 'dot-capital',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.55, 4, 0.85, 7, 1],
          'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 2.3, ['get', 'name']],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11.5, 6, 13.5],
          'symbol-sort-key': ['get', 'sort'],
        },
        paint: { 'text-color': p.text, ...halo },
      },
      // Country names go last in the style so they are placed first and win label collisions.
      {
        id: L.countryLabel,
        type: 'symbol',
        source: 'countryLabels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_BOLD,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.09,
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 14],
          'text-max-width': 8,
          'text-padding': 3,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'population'], 0]],
        },
        paint: {
          ...countryLabelPaint(p),
          'text-halo-width': 1.4,
          'text-opacity': ['step', ['zoom'], 0, 1.8, 1],
        },
      },
    ],
  }
}

/** The daylight imagery is toned down on the dark theme. */
function reliefPaint(theme: Theme) {
  return {
    'raster-brightness-max': theme === 'dark' ? 0.72 : 1,
    'raster-saturation': theme === 'dark' ? -0.25 : -0.05,
  }
}

function applyTheme(map: MapLibre, theme: Theme) {
  const p = PALETTE[theme]
  map.setPaintProperty(L.night, 'fill-color', p.night)
  map.setPaintProperty(L.night, 'fill-opacity', p.nightOpacity)
  for (const id of [L.regionTarget, L.quizLine]) map.setPaintProperty(id, 'line-color', p.accent)
  map.setPaintProperty(L.quizPoints, 'circle-color', ['match', ['get', 'kind'], 'pick', p.progress.ko, p.progress.ok])
  const relief = reliefPaint(theme)
  map.setPaintProperty(L.relief, 'raster-brightness-max', relief['raster-brightness-max'])
  map.setPaintProperty(L.relief, 'raster-saturation', relief['raster-saturation'])
  map.setPaintProperty('ocean', 'background-color', p.ocean)
  map.setSky({ ...map.getSky(), 'sky-color': p.sky, 'horizon-color': p.horizon, 'fog-color': p.sky })
  map.setPaintProperty(L.countryBorder, 'line-color', p.border)
  map.setPaintProperty(L.regionBorder, 'line-color', p.border)
  for (const id of [L.countryHover, L.regionHover, L.countrySelected]) map.setPaintProperty(id, 'line-color', p.outline)
  syncDotImages(map, theme)
  for (const id of [L.citiesAll, L.cities]) map.setPaintProperty(id, 'text-color', p.textMuted)
  for (const id of [L.regionCap, L.capital]) map.setPaintProperty(id, 'text-color', p.text)
  const labelPaint = countryLabelPaint(p)
  map.setPaintProperty(L.countryLabel, 'text-color', labelPaint['text-color'])
  map.setPaintProperty(L.countryLabel, 'text-halo-color', labelPaint['text-halo-color'])
  for (const id of [L.citiesAll, L.cities, L.regionCap, L.capital]) map.setPaintProperty(id, 'text-halo-color', p.halo)
}

function hoverTarget(f: MapGeoJSONFeature): HoverTarget | null {
  const props = f.properties
  switch (f.layer.id) {
    case L.capital:
      return {
        kind: 'capital',
        countryId: props.countryId,
        capital: {
          name: props.name,
          lat: props.lat,
          lon: props.lon,
          population: props.population ?? null,
          timezone: props.timezone ?? null,
        },
      }
    case L.regionCap:
      return { kind: 'region-capital', region: props as Region }
    case L.cities:
    case L.citiesAll:
      return {
        kind: 'city',
        city: { name: props.name, lat: props.lat, lon: props.lon, population: props.population, countryId: props.countryId },
      }
    case L.regionFill:
      return { kind: 'region', region: props as Region }
    case L.countryFill:
      return { kind: 'country', id: String(f.id ?? props.id) }
  }
  return null
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const readyRef = useRef(false)
  const latest = useRef(props)
  // Declared first so every effect below (and map event handlers) sees the current props.
  useEffect(() => {
    latest.current = props
  })
  const hovered = useRef<{ source: string; id: string | number } | null>(null)

  // Create the map once.
  useEffect(() => {
    const { data, projection, theme } = latest.current
    const map = new MapLibre({
      container: container.current!,
      style: buildStyle(data, projection, theme),
      center: [12, 48],
      zoom: 3,
      minZoom: 0.6,
      maxZoom: 10,
      attributionControl: {
        compact: true,
        customAttribution: 'Natural Earth · GeoNames · World Bank · Wikidata · DOSE · OECD · flag-icons',
      },
      renderWorldCopies: false,
      transformRequest: (url, type) => {
        if (type !== 'Glyphs') return { url }
        return { url: url.replace(/Manrope%20\w+/, (m) => encodeURIComponent(GLYPH_FALLBACK[decodeURIComponent(m)] ?? m)) }
      },
    })
    map.addControl(new NavigationControl({ visualizePitch: false, showCompass: false }), 'bottom-right')
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.on('styleimagemissing', () => syncDotImages(map, latest.current.theme))
    const uninstallGestures = installWheelGestures(map)
    mapRef.current = map
    if (import.meta.env.DEV) Object.assign(window, { __map: map })

    const setHover = (next: { source: string; id: string | number } | null) => {
      const prev = hovered.current
      if (prev && (!next || prev.source !== next.source || prev.id !== next.id)) {
        map.setFeatureState(prev, { hover: false })
      }
      if (next) map.setFeatureState(next, { hover: true })
      hovered.current = next
    }

    const pick = (x: number, y: number): MapGeoJSONFeature | undefined => {
      if (!readyRef.current || !map.getLayer(L.regionFill)) return undefined // style (re)loading
      const box: [[number, number], [number, number]] = [
        [x - HIT_RADIUS, y - HIT_RADIUS],
        [x + HIT_RADIUS, y + HIT_RADIUS],
      ]
      const layers = POINT_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
      const points = map.queryRenderedFeatures(box, { layers })
      if (points.length) return points[0]
      // Regions come first (also see-through ones): their tooltip carries the regional figures.
      return map.queryRenderedFeatures([x, y], { layers: POLYGON_LAYERS })[0]
    }

    /** Only what a click acts on gets the pointer; the rest of the map keeps the grab hand for panning. */
    const clickable = (target: HoverTarget | null) => {
      const { interactive, selectedId, pickMode } = latest.current
      if (pickMode) return true
      if (!interactive || !target) return false
      if (target.kind === 'country' || target.kind === 'capital') return true
      return target.kind === 'city' && target.city.countryId !== selectedId
    }

    map.on('mousemove', (e) => {
      const f = pick(e.point.x, e.point.y)
      const target = f ? hoverTarget(f) : null
      if (f && (f.layer.id === L.countryFill || f.layer.id === L.regionFill) && f.id != null) {
        setHover({ source: f.layer.source, id: f.id })
      } else {
        setHover(null)
      }
      if (!dragging) map.getCanvas().style.cursor = clickable(target) ? SELECT_CURSOR : ''
      latest.current.onHover(target, e.point.x, e.point.y)
    })
    let dragging = false
    map.on('dragstart', () => {
      dragging = true
      map.getCanvas().style.cursor = 'grabbing'
    })
    map.on('dragend', () => {
      dragging = false
      map.getCanvas().style.cursor = ''
    })
    map.on('mouseout', () => {
      setHover(null)
      latest.current.onHover(null, 0, 0)
    })
    map.on('click', (e) => {
      const f = pick(e.point.x, e.point.y)
      const target = f ? hoverTarget(f) : null
      const { selectedId, pickMode, projection } = latest.current
      if (pickMode) {
        const { lng, lat } = e.lngLat
        latest.current.onMapClick(projection === 'equal-earth' ? fromEqualEarth(lng, lat) : [lng, lat], targetCountryId(target))
        return
      }
      // Selecting the country already selected would do nothing: inspect it instead.
      const selects =
        clickable(target) &&
        !(target?.kind === 'country' && target.id === selectedId) &&
        !(target?.kind === 'capital' && target.countryId === selectedId)
      if (!selects) {
        latest.current.onInspect(target, e.point.x, e.point.y)
        return
      }
      if (target?.kind === 'country') latest.current.onSelect(target.id)
      if (target?.kind === 'capital') latest.current.onSelect(target.countryId)
      if (target?.kind === 'city') latest.current.onSelect(target.city.countryId)
    })
    map.on('movestart', () => latest.current.onInspect(null, 0, 0))
    map.on('load', () => {
      // MapLibre opens the compact attribution until the first drag; start folded into its ⓘ button instead
      // (a click opens it; on desktop the sources are also listed in the controls card).
      const attribution = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
      attribution?.classList.remove('maplibregl-compact-show')
      attribution?.removeAttribute('open')
      readyRef.current = true
      syncAll(map, latest.current)
      moveCamera(map, latest.current, false)
    })
    return () => {
      readyRef.current = false
      uninstallGestures()
      map.remove()
      mapRef.current = null
    }
  }, [])

  const { projection, theme, ramp, countryValues, focusIds, selectedId, regions, regionValues } = props
  const { showCapitals, showCities, labels, view, padding } = props

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.setProjection({ type: renderProjection(projection) })
    const src = baseSources(latest.current.data)
    for (const [id, fc] of Object.entries(src)) map.getSource<GeoJSONSource>(id)!.setData(inView(fc, projection))
    syncAll(map, latest.current)
    moveCamera(map, latest.current, false)
  }, [projection])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) {
      applyTheme(map, theme)
      syncColors(map, latest.current)
    }
  }, [theme])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) syncAll(map, latest.current)
  }, [ramp, countryValues, focusIds, selectedId, regions, regionValues, showCapitals, showCities, labels, props.background, props.progress, props.highlightRegionId, props.quizMarks])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) syncNight(map, latest.current)
  }, [props.nightAt, projection])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) moveCamera(map, latest.current, true)
  }, [view, selectedId, padding, props.resetToken])

  return <div ref={container} className="map" aria-label="Mappa interattiva" role="application" />
}

function syncNight(map: MapLibre, props: Props) {
  const fc: FeatureCollection = props.nightAt
    ? { type: 'FeatureCollection', features: [nightPolygon(props.nightAt)] }
    : empty
  map.getSource<GeoJSONSource>('night')!.setData(inView(fc, props.projection))
}

function syncColors(map: MapLibre, props: Props) {
  const p = PALETTE[props.theme]
  // Quiz progress: known, missed, still to do; countries outside the quiz keep the plain land color.
  const progressColor: ExpressionSpecification = [
    'match',
    ['coalesce', ['feature-state', 'progress'], ''],
    'ok',
    p.progress.ok,
    'ko',
    p.progress.ko,
    'todo',
    p.progress.todo,
    p.land,
  ]
  map.setPaintProperty(
    L.countryFill,
    'fill-color',
    props.progress ? progressColor : fillColor(props.ramp, p.land, p.noData),
  )
  map.setPaintProperty(L.regionFill, 'fill-color', regionFillColor(props.ramp, p))
}

/** Equal Earth is drawn from re-projected coordinates, which raster tiles cannot follow: no relief there. */
function reliefShown(background: Background, projection: Projection): boolean {
  return background === 'relief' && projection !== 'equal-earth'
}

function syncBackground(map: MapLibre, props: Props) {
  const relief = reliefShown(props.background, props.projection)
  map.setLayoutProperty(L.relief, 'visibility', relief ? 'visible' : 'none')
  map.setPaintProperty(L.countryFill, 'fill-opacity', countryFillOpacity(relief, Boolean(props.ramp)))
  map.setPaintProperty(L.regionFill, 'fill-opacity', regionFillOpacity(relief))
}

function syncAll(map: MapLibre, props: Props) {
  const { data, countryValues, focusIds, selectedId, regions, regionValues, projection } = props
  syncColors(map, props)
  syncBackground(map, props)

  // A country with regions on the map is drawn by them: colored by the metric when they have values,
  // tinted region by region when nothing colors the map; otherwise it keeps its own color under see-through
  // regions (their borders still divide it).
  const drawnByRegions = new Set<string>()
  for (const f of regions?.features ?? []) {
    if (!props.ramp || f.properties.id in regionValues) drawnByRegions.add(f.properties.countryId)
  }
  for (const id of Object.keys(data.countries)) {
    map.setFeatureState(
      { source: 'countries', id },
      {
        t: countryValues[id] ?? null,
        dim: selectedId ? id !== selectedId : !focusIds.has(id),
        hidden: drawnByRegions.has(id),
        selected: id === selectedId,
        progress: props.progress?.[id] ?? null,
      },
    )
  }

  const marks = props.quizMarks
  const markFc: FeatureCollection = marks
    ? {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [marks.pick, marks.answer] } },
          { type: 'Feature', properties: { kind: 'pick' }, geometry: { type: 'Point', coordinates: marks.pick } },
          { type: 'Feature', properties: { kind: 'answer' }, geometry: { type: 'Point', coordinates: marks.answer } },
        ],
      }
    : empty
  map.getSource<GeoJSONSource>('quizMarks')!.setData(inView(markFc, projection))
  syncNight(map, props)

  const labelValues = props.ramp && !props.progress ? countryValues : {}
  map.getSource<GeoJSONSource>('countryLabels')!.setData(inView(countryLabelPoints(data, labelValues), projection))
  map.getSource<GeoJSONSource>('regions')!.setData(regions ? inView(regions, projection) : empty)
  for (const f of regions?.features ?? []) {
    map.setFeatureState(
      { source: 'regions', id: f.properties.id },
      { t: regionValues[f.properties.id] ?? null, tint: !props.ramp, target: f.properties.id === props.highlightRegionId },
    )
  }
  const regionCaps = pointCollection(
    (regions?.features ?? []).map((f) => f.properties),
    (r) => (r.capLat != null && r.capLon != null ? [r.capLon, r.capLat] : null),
  )
  map.getSource<GeoJSONSource>('regionCapitals')!.setData(inView(regionCaps, projection))

  // Regional capitals already have their own marker: skip the same city in the cities layer.
  const capPoints = regionCaps.features.map((f) => f.geometry.coordinates)
  const shadowed = (selectedId ? (data.citiesByCountry[selectedId] ?? []) : [])
    .filter((c) =>
      capPoints.some(([lon, lat]) => Math.hypot((c.lon - lon) * Math.cos((lat * Math.PI) / 180), c.lat - lat) * 111 < 7),
    )
    .map((c) => c.name)
  const countryFilter: ExpressionSpecification = [
    'all',
    ['==', ['get', 'countryId'], selectedId ?? ''],
    ['!', ['in', ['get', 'name'], ['literal', shadowed]]],
  ]
  map.setFilter(L.cities, countryFilter)
  map.setFilter(L.citiesAll, ['!=', ['get', 'countryId'], selectedId ?? ''])
  // Small countries' names wait for their zoom; a selected country's name would sit on its regions.
  map.setFilter(L.countryLabel, [
    'all',
    ['>=', ['zoom'], ['get', 'minZoom']],
    ['!=', ['get', 'id'], selectedId ?? ''],
  ])

  const vis = (on: boolean) => (on ? 'visible' : 'none')
  for (const id of [L.capital, L.regionCap]) map.setLayoutProperty(id, 'visibility', vis(props.showCapitals))
  for (const id of [L.cities, L.citiesAll]) map.setLayoutProperty(id, 'visibility', vis(props.showCities))
  map.setLayoutProperty(L.countryLabel, 'visibility', vis(props.labels))
}

// cameraForBounds sizes bounds as if on a flat map; on the globe the country's near face bulges
// toward the viewer and ends up ~0.3–0.45 zoom levels too tight (QA: Brazil spilled under the panel).
const GLOBE_FIT_CORRECTION = 0.4

function moveCamera(map: MapLibre, props: Props, animate: boolean) {
  const { selectedId, data, view, padding, projection } = props
  const duration = animate ? 1200 : 0
  // The side cards are applied as persistent map padding; the fit only adds a small margin on top.
  map.setPadding(padding)
  const narrow = map.getContainer().clientWidth < 700
  if (!selectedId && view.id === 'world') {
    const center: [number, number] = projection === 'equal-earth' ? toEqualEarth(12, 25) : [12, 25]
    const zoom = projection === 'globe' ? (narrow ? 0.45 : 1.5) : narrow ? 0.2 : 1.1
    map.easeTo({ center, zoom, duration })
    return
  }
  const bbox: BBox = selectedId && data.countries[selectedId] ? data.countries[selectedId].bbox : view.bounds
  const [w, s, e, n] = projection === 'equal-earth' ? projectBBox(bbox) : bbox
  const camera = map.cameraForBounds([[w, s], [e, n]] as LngLatBoundsLike, { padding: 24, maxZoom: 7 })
  if (!camera) return // the cards leave no room (transient while the viewport is resizing)
  const zoom = (camera.zoom ?? map.getZoom()) - (projection === 'globe' ? GLOBE_FIT_CORRECTION : 0)
  map.easeTo({ center: camera.center, zoom, duration })
}

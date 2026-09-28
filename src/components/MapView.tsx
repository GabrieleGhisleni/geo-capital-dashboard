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
import { glyphsUrl, type Dataset } from '../data'
import { installWheelGestures } from '../gestures'
import mapFonts from '../mapFonts.json'
import { projectBBox, projectFeatureCollection, toEqualEarth } from '../projection'
import type { City, HoverTarget, Projection, Region } from '../types'
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
  theme: Theme
  ramp: string[] | null
  countryValues: ValueMap
  focusIds: Set<string>
  selectedId: string | null
  regions: FeatureCollection<Geometry, Region> | null
  /** Empty when the metric has no regional data: the country then stays colored as a whole. */
  regionValues: ValueMap
  showCapitals: boolean
  showCities: boolean
  /** Country names on the map (hidden while studying, so they don't give answers away). */
  labels: boolean
  padding: PaddingOptions
  onHover: (target: HoverTarget | null, x: number, y: number) => void
  onSelect: (countryId: string | null) => void
}

const PALETTE = {
  light: {
    ocean: '#d5e3ec',
    land: '#f4f0e8',
    noData: '#e2ddd3',
    border: '#ffffff',
    outline: '#1d2330',
    text: '#1d2330',
    textMuted: '#5b6272',
    countryLabel: '#6b6358',
    halo: 'rgba(255, 255, 255, 0.92)',
    dot: '#ffffff',
    sky: '#eaf1f6',
    horizon: '#ffffff',
  },
  dark: {
    ocean: '#15202b',
    land: '#2a2f38',
    noData: '#363c46',
    border: '#0f151c',
    outline: '#ffffff',
    text: '#f1f3f7',
    textMuted: '#aab2c0',
    countryLabel: '#c9c1b4',
    halo: 'rgba(15, 21, 28, 0.9)',
    dot: '#0f151c',
    sky: '#0b1016',
    horizon: '#2a3a4c',
  },
} as const

const L = {
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

const POINT_LAYERS = [L.capital, L.regionCap, L.cities, L.citiesAll]
const POLYGON_LAYERS = [L.regionFill, L.countryFill]
const HIT_RADIUS = 6
const FONT_MEDIUM = ['Manrope Medium']
const FONT_BOLD = ['Manrope Bold']
const FONT_SERIF = ['Fraunces SemiBold']
/** Glyph PBFs (Noto) cover scripts Manrope lacks; map the Manrope stack names onto them. */
const GLYPH_FALLBACK: Record<string, string> = {
  'Manrope Medium': 'Noto Sans Regular',
  'Manrope Bold': 'Noto Sans Bold',
  'Fraunces SemiBold': 'Noto Sans Bold',
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

/** Dot icons, drawn on a canvas so symbol collision can keep labels from sitting on them. */
const DOTS: Record<string, (p: Palette) => { fill: string; stroke: string; size: number; line: number }> = {
  'dot-capital': (p) => ({ fill: p.dot, stroke: p.text, size: 11, line: 2.4 }),
  'dot-region': (p) => ({ fill: p.text, stroke: p.dot, size: 9, line: 1.6 }),
  'dot-city-strong': (p) => ({ fill: p.dot, stroke: p.text, size: 8, line: 1.4 }),
  'dot-city': (p) => ({ fill: p.dot, stroke: p.textMuted, size: 7, line: 1.2 }),
}
const DOT_PIXEL_RATIO = 3

function drawDot(spec: ReturnType<(typeof DOTS)[string]>) {
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

/** All source data in real lon/lat; the equal-earth view re-projects it before handing it to MapLibre. */
function baseSources(data: Dataset) {
  const countries = Object.values(data.countries)
  return {
    countries: data.shapes as FeatureCollection,
    countryLabels: pointCollection(
      countries.filter((c) => c.continent !== 'Antarctica'),
      (c) => c.label,
    ) as FeatureCollection,
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
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      {
        id: L.countryFill,
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': fillColor(null, p.land, p.noData),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hidden'], false],
            0,
            ['boolean', ['feature-state', 'dim'], false],
            0.3,
            1,
          ],
          'fill-opacity-transition': { duration: 400 },
        },
      },
      {
        id: L.regionFill,
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': fillColor(null, p.land, p.noData),
          'fill-opacity': ['case', ['==', ['typeof', ['feature-state', 't']], 'number'], 1, 0],
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
        id: L.countryLabel,
        type: 'symbol',
        source: 'countryLabels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_SERIF,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.14,
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9.5, 5, 13],
          'text-max-width': 8,
          'text-padding': 4,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'population'], 0]],
        },
        paint: { 'text-color': p.countryLabel, ...halo, 'text-opacity': ['step', ['zoom'], 0, 2, 1] },
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
    ],
  }
}

function applyTheme(map: MapLibre, theme: Theme) {
  const p = PALETTE[theme]
  map.setPaintProperty('ocean', 'background-color', p.ocean)
  map.setSky({ ...map.getSky(), 'sky-color': p.sky, 'horizon-color': p.horizon, 'fog-color': p.sky })
  map.setPaintProperty(L.countryBorder, 'line-color', p.border)
  map.setPaintProperty(L.regionBorder, 'line-color', p.border)
  for (const id of [L.countryHover, L.regionHover, L.countrySelected]) map.setPaintProperty(id, 'line-color', p.outline)
  syncDotImages(map, theme)
  for (const id of [L.citiesAll, L.cities]) map.setPaintProperty(id, 'text-color', p.textMuted)
  for (const id of [L.regionCap, L.capital]) map.setPaintProperty(id, 'text-color', p.text)
  map.setPaintProperty(L.countryLabel, 'text-color', p.countryLabel)
  for (const id of [L.countryLabel, L.citiesAll, L.cities, L.regionCap, L.capital])
    map.setPaintProperty(id, 'text-halo-color', p.halo)
}

function hoverTarget(f: MapGeoJSONFeature): HoverTarget | null {
  const props = f.properties
  switch (f.layer.id) {
    case L.capital:
      return {
        kind: 'capital',
        countryId: props.countryId,
        capital: { name: props.name, lat: props.lat, lon: props.lon, population: props.population ?? null },
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
      attributionControl: { compact: true, customAttribution: 'Natural Earth · GeoNames · World Bank · Wikidata' },
      renderWorldCopies: false,
      transformRequest: (url, type) => {
        if (type !== 'Glyphs') return { url }
        return { url: url.replace(/(Manrope|Fraunces)%20\w+/, (m) => encodeURIComponent(GLYPH_FALLBACK[decodeURIComponent(m)] ?? m)) }
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
      const box: [[number, number], [number, number]] = [
        [x - HIT_RADIUS, y - HIT_RADIUS],
        [x + HIT_RADIUS, y + HIT_RADIUS],
      ]
      const layers = POINT_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
      const points = map.queryRenderedFeatures(box, { layers })
      if (points.length) return points[0]
      // Uncolored regions (metric without regional data) let the hover fall through to the country.
      return map
        .queryRenderedFeatures([x, y], { layers: POLYGON_LAYERS })
        .find((f) => f.layer.id !== L.regionFill || typeof f.state.t === 'number')
    }

    map.on('mousemove', (e) => {
      const f = pick(e.point.x, e.point.y)
      const target = f ? hoverTarget(f) : null
      if (f && (f.layer.id === L.countryFill || f.layer.id === L.regionFill) && f.id != null) {
        setHover({ source: f.layer.source, id: f.id })
      } else {
        setHover(null)
      }
      map.getCanvas().style.cursor = target ? 'pointer' : ''
      latest.current.onHover(target, e.point.x, e.point.y)
    })
    map.on('mouseout', () => {
      setHover(null)
      latest.current.onHover(null, 0, 0)
    })
    map.on('click', (e) => {
      const f = pick(e.point.x, e.point.y)
      if (!f) return
      const target = hoverTarget(f)
      if (target?.kind === 'country') latest.current.onSelect(target.id)
      if (target?.kind === 'capital') latest.current.onSelect(target.countryId)
      if (target?.kind === 'city' && target.city.countryId !== latest.current.selectedId)
        latest.current.onSelect(target.city.countryId)
    })
    map.on('load', () => {
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
  }, [ramp, countryValues, focusIds, selectedId, regions, regionValues, showCapitals, showCities, labels])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) moveCamera(map, latest.current, true)
  }, [view, selectedId, padding])

  return <div ref={container} className="map" aria-label="Mappa interattiva" role="application" />
}

function syncColors(map: MapLibre, props: Props) {
  const p = PALETTE[props.theme]
  map.setPaintProperty(L.countryFill, 'fill-color', fillColor(props.ramp, p.land, p.noData))
  map.setPaintProperty(L.regionFill, 'fill-color', fillColor(props.ramp, p.land, p.noData))
}

function syncAll(map: MapLibre, props: Props) {
  const { data, countryValues, focusIds, selectedId, regions, regionValues, projection } = props
  syncColors(map, props)

  const regionsColored = Boolean(regions?.features.length) && Object.keys(regionValues).length > 0
  for (const id of Object.keys(data.countries)) {
    map.setFeatureState(
      { source: 'countries', id },
      {
        t: countryValues[id] ?? null,
        dim: selectedId ? id !== selectedId : !focusIds.has(id),
        hidden: regionsColored && id === selectedId,
        selected: id === selectedId,
      },
    )
  }

  map.getSource<GeoJSONSource>('regions')!.setData(regions ? inView(regions, projection) : empty)
  for (const f of regions?.features ?? []) {
    map.setFeatureState({ source: 'regions', id: f.properties.id }, { t: regionValues[f.properties.id] ?? null })
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
  // A selected country's name would sit on top of its regions and capitals.
  map.setFilter(L.countryLabel, ['!=', ['get', 'id'], selectedId ?? ''])

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

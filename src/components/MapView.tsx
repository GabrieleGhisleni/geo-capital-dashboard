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
import type { HoverTarget, Projection, Region } from '../types'
import type { Theme } from '../useTheme'
import type { ViewDef } from '../views'

// Vite cannot follow MapLibre's computed worker URL, so point it at the bundled worker explicitly.
setWorkerUrl(workerUrl)

export type ClassMap = Record<string, number>

type SymbolLayout = NonNullable<Extract<StyleSpecification['layers'][number], { type: 'symbol' }>['layout']>

type Props = {
  data: Dataset
  view: ViewDef
  projection: Projection
  theme: Theme
  ramp: string[]
  countryClasses: ClassMap
  focusIds: Set<string>
  selectedId: string | null
  regions: FeatureCollection<Geometry, Region> | null
  regionClasses: ClassMap
  showCapitals: boolean
  showCities: boolean
  padding: PaddingOptions
  onHover: (target: HoverTarget | null, x: number, y: number) => void
  onSelect: (countryId: string | null) => void
}

const PALETTE = {
  light: {
    space: '#f3f2ee',
    ocean: '#dfe7ef',
    land: '#e6e4de',
    noData: '#c9c7c0',
    border: '#fcfcfb',
    outline: '#0b0b0b',
    text: '#0b0b0b',
    textMuted: '#52514e',
    halo: '#fcfcfb',
    dot: '#fcfcfb',
  },
  dark: {
    space: '#121211',
    ocean: '#1d2229',
    land: '#2f2f2c',
    noData: '#46463f',
    border: '#1a1a19',
    outline: '#ffffff',
    text: '#ffffff',
    textMuted: '#c3c2b7',
    halo: '#1a1a19',
    dot: '#1a1a19',
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
  citiesAllDot: 'cities-all-dot',
  citiesAllLabel: 'cities-all-label',
  citiesDot: 'cities-dot',
  citiesLabel: 'cities-label',
  regionCapDot: 'region-cap-dot',
  regionCapLabel: 'region-cap-label',
  capitalDot: 'capital-dot',
  capitalLabel: 'capital-label',
} as const

const POINT_LAYERS = [
  L.capitalDot,
  L.capitalLabel,
  L.regionCapDot,
  L.regionCapLabel,
  L.citiesDot,
  L.citiesLabel,
  L.citiesAllDot,
  L.citiesAllLabel,
]
const POLYGON_LAYERS = [L.regionFill, L.countryFill]
const HIT_RADIUS = 6

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

function classColor(ramp: string[], land: string, noData: string): ExpressionSpecification {
  return [
    'match',
    ['coalesce', ['feature-state', 'cls'], -1],
    -2,
    noData,
    ...ramp.flatMap((color, i) => [i, color]),
    land,
  ] as ExpressionSpecification
}

const cityRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['sqrt', ['get', 'population']],
  300,
  2.5,
  1000,
  4,
  3000,
  7,
]

function pointCollection<P>(
  items: P[],
  lngLat: (p: P) => [number, number] | null,
): FeatureCollection<Point, P> {
  const features: Feature<Point, P>[] = []
  for (const item of items) {
    const c = lngLat(item)
    if (c) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: item })
  }
  return { type: 'FeatureCollection', features }
}

function buildStyle(data: Dataset, projection: Projection, theme: Theme): StyleSpecification {
  const p = PALETTE[theme]
  const capitals = pointCollection(
    Object.values(data.countries).flatMap((c) =>
      c.capitals.map((cap) => ({ ...cap, countryId: c.id, sort: -(c.population ?? 0) })),
    ),
    (c) => [c.lon, c.lat],
  )
  const cities = pointCollection(data.cities, (c) => [c.lon, c.lat])
  const label: SymbolLayout = {
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 11,
    'text-offset': [0, 0.9],
    'text-anchor': 'top',
    'text-max-width': 8,
    'symbol-sort-key': ['-', 0, ['get', 'population']],
  }

  return {
    version: 8,
    glyphs: glyphsUrl(),
    projection: { type: projection },
    sources: {
      countries: { type: 'geojson', data: data.shapes, promoteId: 'id' },
      regions: { type: 'geojson', data: empty, promoteId: 'id' },
      capitals: { type: 'geojson', data: capitals },
      cities: { type: 'geojson', data: cities },
      regionCapitals: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      {
        id: L.countryFill,
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': classColor([], p.land, p.noData),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hidden'], false],
            0,
            ['boolean', ['feature-state', 'dim'], false],
            0.35,
            1,
          ],
        },
      },
      {
        id: L.regionFill,
        type: 'fill',
        source: 'regions',
        paint: { 'fill-color': classColor([], p.land, p.noData) },
      },
      {
        id: L.regionBorder,
        type: 'line',
        source: 'regions',
        paint: { 'line-color': p.border, 'line-width': 0.8 },
      },
      {
        id: L.countryBorder,
        type: 'line',
        source: 'countries',
        paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 1.2] },
      },
      {
        id: L.regionHover,
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': p.outline,
          'line-width': 1.5,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
      },
      {
        id: L.countryHover,
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': p.outline,
          'line-width': 1.5,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
      },
      {
        id: L.countrySelected,
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': p.outline,
          'line-width': 2,
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
        },
      },
      {
        id: L.citiesAllDot,
        type: 'circle',
        source: 'cities',
        minzoom: 4.5,
        paint: {
          'circle-radius': cityRadius,
          'circle-color': p.dot,
          'circle-stroke-color': p.textMuted,
          'circle-stroke-width': 1,
        },
      },
      {
        id: L.citiesAllLabel,
        type: 'symbol',
        source: 'cities',
        minzoom: 5,
        layout: { ...label, 'text-size': 10 },
        paint: { 'text-color': p.textMuted, 'text-halo-color': p.halo, 'text-halo-width': 1.2 },
      },
      {
        id: L.citiesDot,
        type: 'circle',
        source: 'cities',
        filter: ['==', ['get', 'countryId'], ''],
        paint: {
          'circle-radius': cityRadius,
          'circle-color': p.dot,
          'circle-stroke-color': p.text,
          'circle-stroke-width': 1.2,
        },
      },
      {
        id: L.citiesLabel,
        type: 'symbol',
        source: 'cities',
        filter: ['==', ['get', 'countryId'], ''],
        layout: { ...label, 'text-size': 10.5 },
        paint: { 'text-color': p.textMuted, 'text-halo-color': p.halo, 'text-halo-width': 1.2 },
      },
      {
        id: L.regionCapDot,
        type: 'circle',
        source: 'regionCapitals',
        paint: {
          'circle-radius': 4,
          'circle-color': p.text,
          'circle-stroke-color': p.halo,
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: L.regionCapLabel,
        type: 'symbol',
        source: 'regionCapitals',
        layout: { ...label, 'text-field': ['get', 'capName'], 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
        paint: { 'text-color': p.text, 'text-halo-color': p.halo, 'text-halo-width': 1.4 },
      },
      {
        id: L.capitalDot,
        type: 'circle',
        source: 'capitals',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 5, 5.5],
          'circle-color': p.dot,
          'circle-stroke-color': p.text,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 5, 2.5],
        },
      },
      {
        id: L.capitalLabel,
        type: 'symbol',
        source: 'capitals',
        layout: {
          ...label,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 13],
          'symbol-sort-key': ['get', 'sort'],
        },
        paint: { 'text-color': p.text, 'text-halo-color': p.halo, 'text-halo-width': 1.5 },
      },
    ],
  }
}

function applyTheme(map: MapLibre, theme: Theme) {
  const p = PALETTE[theme]
  map.setPaintProperty('ocean', 'background-color', p.ocean)
  map.setPaintProperty(L.countryBorder, 'line-color', p.border)
  map.setPaintProperty(L.regionBorder, 'line-color', p.border)
  for (const id of [L.countryHover, L.regionHover, L.countrySelected]) map.setPaintProperty(id, 'line-color', p.outline)
  for (const id of [L.citiesAllDot, L.citiesDot, L.capitalDot]) map.setPaintProperty(id, 'circle-color', p.dot)
  map.setPaintProperty(L.citiesAllDot, 'circle-stroke-color', p.textMuted)
  map.setPaintProperty(L.citiesDot, 'circle-stroke-color', p.text)
  map.setPaintProperty(L.capitalDot, 'circle-stroke-color', p.text)
  map.setPaintProperty(L.regionCapDot, 'circle-color', p.text)
  map.setPaintProperty(L.regionCapDot, 'circle-stroke-color', p.halo)
  for (const id of [L.citiesAllLabel, L.citiesLabel]) map.setPaintProperty(id, 'text-color', p.textMuted)
  for (const id of [L.regionCapLabel, L.capitalLabel]) map.setPaintProperty(id, 'text-color', p.text)
  for (const id of [L.citiesAllLabel, L.citiesLabel, L.regionCapLabel, L.capitalLabel])
    map.setPaintProperty(id, 'text-halo-color', p.halo)
}

function hoverTarget(f: MapGeoJSONFeature): HoverTarget | null {
  const props = f.properties
  switch (f.layer.id) {
    case L.capitalDot:
    case L.capitalLabel:
      return {
        kind: 'capital',
        countryId: props.countryId,
        capital: { name: props.name, lat: props.lat, lon: props.lon, population: props.population ?? null },
      }
    case L.regionCapDot:
    case L.regionCapLabel:
      return { kind: 'region-capital', region: props as Region }
    case L.citiesDot:
    case L.citiesLabel:
    case L.citiesAllDot:
    case L.citiesAllLabel:
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
  latest.current = props
  const hovered = useRef<{ source: string; id: string | number } | null>(null)

  // Create the map once.
  useEffect(() => {
    const { data, projection, theme } = latest.current
    const map = new MapLibre({
      container: container.current!,
      style: buildStyle(data, projection, theme),
      center: [12, 30],
      zoom: 1.4,
      minZoom: 0.8,
      maxZoom: 10,
      attributionControl: { compact: true, customAttribution: 'Natural Earth · GeoNames · World Bank · Wikidata' },
      renderWorldCopies: false,
    })
    map.addControl(new NavigationControl({ visualizePitch: false, showCompass: false }), 'bottom-right')
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
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
      return map.queryRenderedFeatures([x, y], { layers: POLYGON_LAYERS })[0]
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
      map.remove()
      mapRef.current = null
    }
  }, [])

  const { projection, theme, ramp, countryClasses, focusIds, selectedId, regions, regionClasses } = props
  const { showCapitals, showCities, view, padding } = props

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) map.setProjection({ type: projection })
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
  }, [ramp, countryClasses, focusIds, selectedId, regions, regionClasses, showCapitals, showCities])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) moveCamera(map, latest.current, true)
  }, [view, selectedId, padding])

  return <div ref={container} className="map" aria-label="Mappa interattiva" role="application" />
}

function syncColors(map: MapLibre, props: Props) {
  const p = PALETTE[props.theme]
  map.setPaintProperty(L.countryFill, 'fill-color', classColor(props.ramp, p.land, p.noData))
  map.setPaintProperty(L.regionFill, 'fill-color', classColor(props.ramp, p.land, p.noData))
}

function syncAll(map: MapLibre, props: Props) {
  const { data, countryClasses, focusIds, selectedId, regions, regionClasses } = props
  syncColors(map, props)

  const hasRegions = Boolean(regions && regions.features.length)
  for (const id of Object.keys(data.countries)) {
    map.setFeatureState(
      { source: 'countries', id },
      {
        cls: countryClasses[id] ?? null,
        dim: selectedId ? id !== selectedId : !focusIds.has(id),
        hidden: hasRegions && id === selectedId,
        selected: id === selectedId,
      },
    )
  }

  const regionSource = map.getSource<GeoJSONSource>('regions')!
  regionSource.setData(regions ?? empty)
  if (regions) {
    for (const f of regions.features) {
      map.setFeatureState({ source: 'regions', id: f.properties.id }, { cls: regionClasses[f.properties.id] ?? null })
    }
  }
  map
    .getSource<GeoJSONSource>('regionCapitals')!
    .setData(
      pointCollection(
        (regions?.features ?? []).map((f) => f.properties),
        (r) => (r.capLat != null && r.capLon != null ? [r.capLon, r.capLat] : null),
      ),
    )

  const countryFilter: ExpressionSpecification = ['==', ['get', 'countryId'], selectedId ?? '']
  map.setFilter(L.citiesDot, countryFilter)
  map.setFilter(L.citiesLabel, countryFilter)
  map.setFilter(L.citiesAllDot, ['!=', ['get', 'countryId'], selectedId ?? ''])
  map.setFilter(L.citiesAllLabel, ['!=', ['get', 'countryId'], selectedId ?? ''])

  const vis = (on: boolean) => (on ? 'visible' : 'none')
  for (const id of [L.capitalDot, L.capitalLabel]) map.setLayoutProperty(id, 'visibility', vis(props.showCapitals))
  for (const id of [L.regionCapDot, L.regionCapLabel]) map.setLayoutProperty(id, 'visibility', vis(props.showCapitals))
  for (const id of [L.citiesDot, L.citiesLabel, L.citiesAllDot, L.citiesAllLabel])
    map.setLayoutProperty(id, 'visibility', vis(props.showCities))
}

function moveCamera(map: MapLibre, props: Props, animate: boolean) {
  const { selectedId, data, view, padding } = props
  const duration = animate ? 1200 : 0
  // The side cards are applied as persistent map padding; fitBounds only adds a small margin on top.
  map.setPadding(padding)
  const margin = 24
  if (selectedId && data.countries[selectedId]) {
    const [w, s, e, n] = data.countries[selectedId].bbox
    map.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, { padding: margin, duration, maxZoom: 7 })
    return
  }
  if (view.id === 'world') {
    map.easeTo({ center: [12, 25], zoom: map.getContainer().clientWidth < 700 ? 0.9 : 1.5, duration })
    return
  }
  const [w, s, e, n] = view.bounds
  map.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, { padding: margin, duration })
}

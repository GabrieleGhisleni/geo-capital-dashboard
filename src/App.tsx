import type { FeatureCollection, Geometry } from 'geojson'
import type { PaddingOptions } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Controls } from './components/Controls'
import { MapView, type ClassMap } from './components/MapView'
import { SidePanel } from './components/SidePanel'
import { Tooltip } from './components/Tooltip'
import { loadDataset, loadRegions, type Dataset } from './data'
import { classIndex, metricValue, quantileBreaks, RAMP_DARK, RAMP_LIGHT, rampFor } from './scale'
import type { HoverTarget, Metric, Projection, Region, ViewId } from './types'
import { useTheme } from './useTheme'
import { VIEW_BY_ID } from './views'

export type Scale = { breaks: number[]; colors: string[] }

function buildScale(
  items: { id: string; population?: number | null; area?: number | null }[],
  metric: Metric,
  focus: (id: string) => boolean,
  ramp: string[],
): { scale: Scale; classes: ClassMap } {
  const classes: ClassMap = {}
  if (metric === 'none') return { scale: { breaks: [], colors: [] }, classes }
  const breaks = quantileBreaks(
    items.filter((i) => focus(i.id)).map((i) => metricValue(i, metric)).filter((v): v is number => v != null),
  )
  const colors = rampFor(breaks.length + 1, ramp)
  for (const item of items) {
    const v = metricValue(item, metric)
    if (v == null) {
      classes[item.id] = -2
      continue
    }
    // The map colors by ramp index, so translate the class through the legend colors.
    classes[item.id] = ramp.indexOf(colors[classIndex(v, breaks)])
  }
  return { scale: { breaks, colors }, classes }
}

function useIsNarrow() {
  const q = '(max-width: 899px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mql = window.matchMedia(q)
    const onChange = () => setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<ViewId>('world')
  const [metric, setMetric] = useState<Metric>('population')
  const [projection, setProjection] = useState<Projection>('globe')
  const [showCapitals, setShowCapitals] = useState(true)
  const [showCities, setShowCities] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [regions, setRegions] = useState<FeatureCollection<Geometry, Region> | null>(null)
  const [hover, setHover] = useState<{ target: HoverTarget; x: number; y: number } | null>(null)
  const theme = useTheme()
  const narrow = useIsNarrow()

  useEffect(() => {
    loadDataset().then(setData, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    setRegions(null)
    if (!selectedId || !data?.countries[selectedId]?.admin1Count) return
    let cancelled = false
    loadRegions(selectedId).then(
      (fc) => !cancelled && setRegions(fc),
      () => !cancelled && setRegions(null),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId, data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const view = VIEW_BY_ID[viewId]
  const ramp = theme === 'dark' ? RAMP_DARK : RAMP_LIGHT

  const focusIds = useMemo(() => {
    if (!data) return new Set<string>()
    return new Set(
      Object.values(data.countries)
        .filter((c) =>
          view.continents.length ? view.continents.includes(c.continent) : c.continent !== 'Antarctica',
        )
        .map((c) => c.id),
    )
  }, [data, view])

  const country = useMemo(() => {
    if (!data) return { scale: { breaks: [], colors: [] }, classes: {} }
    return buildScale(Object.values(data.countries), metric, (id) => focusIds.has(id), ramp)
  }, [data, metric, focusIds, ramp])

  const region = useMemo(() => {
    const items = regions?.features.map((f) => f.properties) ?? []
    return buildScale(items, metric, () => true, ramp)
  }, [regions, metric, ramp])

  const padding = useMemo<PaddingOptions>(
    () =>
      narrow
        ? { top: 90, bottom: Math.round(window.innerHeight * 0.42), left: 16, right: 16 }
        : { top: 40, bottom: 40, left: 340, right: 420 },
    [narrow],
  )

  const onHover = useCallback((target: HoverTarget | null, x: number, y: number) => {
    setHover(target ? { target, x, y } : null)
  }, [])

  const selectView = useCallback((id: ViewId) => {
    setSelectedId(null)
    setViewId(id)
  }, [])

  if (error) return <div className="fatal">Impossibile caricare i dati: {error}</div>
  if (!data) return <div className="fatal">Caricamento dati…</div>

  const legendScale = selectedId && regions?.features.length ? region.scale : country.scale
  const legendTitle =
    selectedId && regions?.features.length ? `Regioni · ${data.countries[selectedId].name}` : view.label

  return (
    <div className="app">
      <MapView
        data={data}
        view={view}
        projection={projection}
        theme={theme}
        ramp={ramp}
        countryClasses={country.classes}
        focusIds={focusIds}
        selectedId={selectedId}
        regions={regions}
        regionClasses={region.classes}
        showCapitals={showCapitals}
        showCities={showCities}
        padding={padding}
        onHover={onHover}
        onSelect={setSelectedId}
      />
      <Controls
        data={data}
        viewId={viewId}
        onView={selectView}
        metric={metric}
        onMetric={setMetric}
        projection={projection}
        onProjection={setProjection}
        showCapitals={showCapitals}
        onShowCapitals={setShowCapitals}
        showCities={showCities}
        onShowCities={setShowCities}
        onSelectCountry={setSelectedId}
        scale={legendScale}
        legendTitle={legendTitle}
      />
      <SidePanel
        data={data}
        view={view}
        metric={metric}
        focusIds={focusIds}
        selectedId={selectedId}
        regions={regions}
        onSelect={setSelectedId}
      />
      {hover && !narrow && <Tooltip data={data} hover={hover} />}
    </div>
  )
}

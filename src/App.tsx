import type { FeatureCollection, Geometry } from 'geojson'
import type { PaddingOptions } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Controls } from './components/Controls'
import { MapView, type ValueMap } from './components/MapView'
import { QuizPanel } from './components/QuizPanel'
import { SidePanel } from './components/SidePanel'
import { Tooltip } from './components/Tooltip'
import { loadDataset, loadRegions, type Dataset } from './data'
import { buildScale, metricValue, scalePosition, type Scale } from './scale'
import type { HoverTarget, Metric, Projection, Region, ViewId } from './types'
import { useTheme } from './useTheme'
import { METRIC_BY_ID, VIEW_BY_ID } from './views'

type Measured = { id: string; population?: number | null; area?: number | null; gdp?: number | null; gdpPerCapita?: number | null }

/** Log scale over the items in focus, and each item's position on it (-1 = no data). */
function colorScale(items: Measured[], metric: Metric, inFocus: (id: string) => boolean) {
  const values: ValueMap = {}
  if (metric === 'none') return { scale: null, values }
  const scale = buildScale(
    items.filter((i) => inFocus(i.id)).flatMap((i) => metricValue(i, metric) ?? []),
    metric,
  )
  if (!scale) return { scale: null, values }
  for (const item of items) {
    const v = metricValue(item, metric)
    values[item.id] = v == null ? -1 : scalePosition(v, scale.domain)
  }
  return { scale, values }
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Height of the floating controls card, which covers the top of the map on phones. */
function useControlsHeight(enabled: boolean) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = document.querySelector('.controls')
    if (!enabled || !el) return
    const ro = new ResizeObserver(() => setHeight(Math.round(el.getBoundingClientRect().bottom)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])
  return height
}

function hoveredValue(hover: HoverTarget | null, data: Dataset, metric: Metric, regionsColored: boolean): number | null {
  if (!hover) return null
  if (hover.kind === 'country') return data.countries[hover.id] ? metricValue(data.countries[hover.id], metric) : null
  if (hover.kind === 'region' && regionsColored) return metricValue(hover.region, metric)
  return null
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<ViewId>('europe')
  const [metric, setMetric] = useState<Metric>('population')
  const [projection, setProjection] = useState<Projection>('globe')
  const [showCapitals, setShowCapitals] = useState(true)
  const [showCities, setShowCities] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [studying, setStudying] = useState(false)
  /** While studying: the map may show the question's country but hides names until it's answered. */
  const [quizRevealed, setQuizRevealed] = useState(false)
  const [loadedRegions, setLoadedRegions] = useState<{
    id: string
    fc: FeatureCollection<Geometry, Region> | null
  } | null>(null)
  const [hover, setHover] = useState<{ target: HoverTarget; x: number; y: number } | null>(null)
  const theme = useTheme()
  const narrow = useMedia('(max-width: 899px)')
  const compact = useMedia('(max-width: 1279px)')

  useEffect(() => {
    loadDataset().then(setData, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selectedId || !data?.countries[selectedId]?.admin1Count) return
    let cancelled = false
    loadRegions(selectedId).then(
      (fc) => !cancelled && setLoadedRegions({ id: selectedId, fc }),
      () => !cancelled && setLoadedRegions({ id: selectedId, fc: null }),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId, data])
  const regionsState = loadedRegions?.id === selectedId ? loadedRegions : null
  const regions = regionsState?.fc ?? null
  const regionsFailed = Boolean(regionsState && !regionsState.fc)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !studying && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studying])

  const view = VIEW_BY_ID[viewId]
  const metricInfo = METRIC_BY_ID[metric]

  const focusIds = useMemo(() => {
    if (!data) return new Set<string>()
    return new Set(
      Object.values(data.countries)
        .filter((c) => (view.continents.length ? view.continents.includes(c.continent) : c.continent !== 'Antarctica'))
        .map((c) => c.id),
    )
  }, [data, view])

  const country = useMemo(
    () => (data ? colorScale(Object.values(data.countries), metric, (id) => focusIds.has(id)) : { scale: null, values: {} }),
    [data, metric, focusIds],
  )
  const region = useMemo(() => {
    if (!regions || !metricInfo.regional) return { scale: null as Scale | null, values: {} as ValueMap }
    return colorScale(
      regions.features.map((f) => f.properties),
      metric,
      () => true,
    )
  }, [regions, metric, metricInfo])
  const regionsColored = Boolean(region.scale)

  const controlsHeight = useControlsHeight(narrow && data !== null)
  // Keep the camera framing inside the map area left visible by the floating cards (see index.css widths).
  const padding = useMemo<PaddingOptions>(() => {
    if (narrow) {
      return { top: Math.max(controlsHeight, 90) + 12, bottom: Math.round(window.innerHeight * 0.42), left: 16, right: 16 }
    }
    return compact ? { top: 40, bottom: 40, left: 296, right: 356 } : { top: 40, bottom: 40, left: 340, right: 420 }
  }, [narrow, compact, controlsHeight])

  const onHover = useCallback((target: HoverTarget | null, x: number, y: number) => {
    setHover(target ? { target, x, y } : null)
  }, [])

  const selectView = useCallback((id: ViewId) => {
    setSelectedId(null)
    setViewId(id)
  }, [])

  // The quiz drives the map: it flies to the question's country, and names, capitals, cities and
  // tooltips stay hidden until the question is answered (reveal=true), then everything shows.
  const onQuizFocus = useCallback((countryId: string | null, reveal: boolean) => {
    setSelectedId(countryId)
    setQuizRevealed(reveal)
  }, [])
  const toggleStudy = useCallback(() => {
    setStudying((s) => !s)
    setQuizRevealed(false)
    setSelectedId(null)
  }, [])

  if (error) return <div className="fatal">Impossibile caricare i dati: {error}</div>
  if (!data) return <div className="fatal">Caricamento dati…</div>

  const selected = selectedId ? data.countries[selectedId] : null
  const hideAnswers = studying && !quizRevealed
  const showRegionScale = Boolean(selected && regionsColored)
  const legendNote =
    selected && regions && !metricInfo.regional ? `${metricInfo.label}: dato disponibile solo per Stato` : undefined

  return (
    <div className={`app${studying ? ' app-studying' : ''}`}>
      <MapView
        data={data}
        view={view}
        projection={projection}
        theme={theme}
        ramp={(showRegionScale ? region.scale : country.scale)?.ramp ?? null}
        countryValues={country.values}
        focusIds={focusIds}
        selectedId={selectedId}
        regions={regions}
        regionValues={region.values}
        showCapitals={showCapitals && !hideAnswers}
        showCities={showCities && !hideAnswers}
        labels={!hideAnswers}
        padding={padding}
        onHover={onHover}
        onSelect={studying ? noop : setSelectedId}
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
        onStudy={toggleStudy}
        studying={studying}
        scale={showRegionScale ? region.scale : country.scale}
        legendScope={showRegionScale ? `Regioni · ${selected!.name}` : view.label}
        legendNote={legendNote}
        hoverValue={hideAnswers ? null : hoveredValue(hover?.target ?? null, data, metric, showRegionScale)}
      />
      <aside className="card panel" aria-live="polite">
        {studying ? (
          <QuizPanel
            data={data}
            scopeIds={focusIds}
            scopeLabel={view.label}
            onFocus={onQuizFocus}
            onExit={toggleStudy}
          />
        ) : (
          <SidePanel
            data={data}
            view={view}
            metric={metric}
            focusIds={focusIds}
            selectedId={selectedId}
            regions={regions}
            regionsFailed={regionsFailed}
            onSelect={setSelectedId}
          />
        )}
      </aside>
      {hover && !narrow && !hideAnswers && <Tooltip data={data} hover={hover} metric={metric} />}
    </div>
  )
}

function noop() {}

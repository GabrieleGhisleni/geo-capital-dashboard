import type { FeatureCollection, Geometry } from 'geojson'
import type { PaddingOptions } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controls, SEARCH_INPUT_ID } from './components/Controls'
import { MapView, type ValueMap } from './components/MapView'
import { QuizPanel, type MapPick, type QuizMapState } from './components/QuizPanel'
import { SidePanel } from './components/SidePanel'
import { Tooltip } from './components/Tooltip'
import { HISTORY_METRICS, historyValue, loadDataset, loadHistory, loadRegions, targetCountryId, type Dataset } from './data'
import { buildScale, metricValue, positionOn, type Measurable, type Scale } from './scale'
import type { Background, History, HoverTarget, Metric, Projection, Region, ViewId } from './types'
import { readUrlState, URL_DEFAULTS, writeUrlState } from './urlState'
import { useTheme } from './useTheme'
import { METRIC_BY_ID, VIEW_BY_ID } from './views'

type Measured = Measurable & { id: string }

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
    values[item.id] = v == null ? -1 : positionOn(v, scale)
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

/** Delay before a hovered country's regions show while studying, so sweeping across the map doesn't flicker. */
const PREVIEW_DELAY_MS = 120

function hoveredValue(
  hover: HoverTarget | null,
  data: Dataset,
  metric: Metric,
  regionsColored: boolean,
  yearValues: Record<string, number | null> | null,
): number | null {
  if (!hover) return null
  if (hover.kind === 'country' && yearValues) return yearValues[hover.id] ?? null
  if (hover.kind === 'country') return data.countries[hover.id] ? metricValue(data.countries[hover.id], metric) : null
  if (hover.kind === 'region' && regionsColored) return metricValue(hover.region, metric)
  return null
}

/** Clock for the night shade and local times: ticks every 30 s while `on`. */
function useNow(on: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [on])
  return now
}

const QUIZ_MAP_IDLE: QuizMapState = { pickMode: false, marks: null, regionId: null, progress: null }

export default function App() {
  // The map state starts from the address (shared links) and is written back to it (see the effect below).
  const [initial] = useState(() => readUrlState(window.location.hash))
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<ViewId>(initial.view ?? URL_DEFAULTS.view)
  const [metric, setMetric] = useState<Metric>(initial.metric ?? URL_DEFAULTS.metric)
  const [projection, setProjection] = useState<Projection>(initial.projection ?? URL_DEFAULTS.projection)
  const [background, setBackground] = useState<Background>(initial.background ?? URL_DEFAULTS.background)
  /** Timeline year; null = latest data. */
  const [year, setYear] = useState<number | null>(initial.year ?? null)
  const [night, setNight] = useState(initial.night ?? false)
  const [showCapitals, setShowCapitals] = useState(true)
  const [showCities, setShowCities] = useState(true)
  const [selectedId, setSelected] = useState<string | null>(initial.country ?? null)
  const [studying, setStudying] = useState(false)
  /** While studying: the map may show the question's country but hides names until it's answered. */
  const [quizRevealed, setQuizRevealed] = useState(false)
  /** Loaded regions per country; null = failed to load. */
  const [regionStore, setRegionStore] = useState<Record<string, FeatureCollection<Geometry, Region> | null>>({})
  /** While studying: the country under the cursor, whose regions show on the map. */
  const [previewId, setPreviewId] = useState<string | null>(null)
  // Selecting a country forgets failed region loads (offline, server hiccup), so they are tried again.
  const setSelectedId = useCallback((id: string | null) => {
    setRegionStore((store) =>
      Object.values(store).includes(null)
        ? Object.fromEntries(Object.entries(store).filter(([, fc]) => fc !== null))
        : store,
    )
    setSelected(id)
  }, [])
  const [hover, setHover] = useState<{ target: HoverTarget; x: number; y: number } | null>(null)
  const theme = useTheme()
  const narrow = useMedia('(max-width: 899px)')
  const compact = useMedia('(max-width: 1279px)')

  useEffect(() => {
    loadDataset().then((d) => {
      // A shared link may name a country this dataset does not have.
      setSelected((id) => (id && d.countries[id] ? id : null))
      setData(d)
    }, (e: Error) => setError(e.message))
  }, [])

  // Timeline: the metric's yearly series, loaded when the timeline is open or a country shows its trend.
  const hasHistory = HISTORY_METRICS.has(metric)
  const [historyState, setHistoryState] = useState<{ metric: Metric; history: History } | null>(null)
  const needHistory = hasHistory && (year != null || selectedId != null)
  useEffect(() => {
    if (!needHistory) return
    let cancelled = false
    loadHistory(metric).then(
      (history) => !cancelled && setHistoryState({ metric, history }),
      () => undefined, // offline: the timeline just stays unavailable
    )
    return () => {
      cancelled = true
    }
  }, [metric, needHistory])
  const history = historyState?.metric === metric ? historyState.history : null
  const timelineYear =
    hasHistory && year != null && history ? Math.min(history.to, Math.max(history.from, year)) : null

  const now = useNow(true)
  const [quizMap, setQuizMap] = useState<QuizMapState>(QUIZ_MAP_IDLE)
  const [mapPick, setMapPick] = useState<MapPick | null>(null)
  const onMapClick = useCallback((lngLat: [number, number], countryId: string | null) => {
    setMapPick((prev) => ({ lngLat, countryId, seq: (prev?.seq ?? 0) + 1 }))
  }, [])

  const shownPreview = studying ? previewId : null
  useEffect(() => {
    for (const id of [selectedId, shownPreview]) {
      if (!id || !data?.countries[id]?.admin1Count || id in regionStore) continue
      loadRegions(id).then(
        (fc) => setRegionStore((store) => ({ ...store, [id]: fc })),
        () => setRegionStore((store) => ({ ...store, [id]: null })),
      )
    }
  }, [selectedId, shownPreview, data, regionStore])
  const regions = (selectedId && regionStore[selectedId]) || null
  const regionsFailed = Boolean(selectedId && regionStore[selectedId] === null)
  const previewRegions = shownPreview && shownPreview !== selectedId ? (regionStore[shownPreview] ?? null) : null
  const mapRegions = useMemo(() => {
    if (!previewRegions) return regions
    if (!regions) return previewRegions
    return { ...regions, features: [...regions.features, ...previewRegions.features] }
  }, [regions, previewRegions])

  const toggleStudy = useCallback(() => {
    setStudying((s) => !s)
    setQuizRevealed(false)
    setSelectedId(null)
  }, [setSelectedId])
  const [resetToken, setResetToken] = useState(0)
  /** Back to the view's framing; outside study mode also closes the selected country. */
  const resetMap = useCallback(() => {
    if (!studying) setSelectedId(null)
    setResetToken((t) => t + 1)
  }, [studying, setSelectedId])

  // Single-key shortcuts (browsers reserve Cmd/Ctrl+T, and Cmd/Ctrl+R is reload): R reset, S study mode,
  // / search, Esc closes the country. Ignored while typing and with modifiers, so browser shortcuts still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'escape') {
        if (!studying) setSelectedId(null)
        return
      }
      if (key === 'r' && !e.repeat) resetMap()
      else if (key === 's' && !e.repeat) toggleStudy()
      else if (key === '/') document.getElementById(SEARCH_INPUT_ID)?.focus()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studying, setSelectedId, resetMap, toggleStudy])

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

  /** Timeline values of the chosen year, per country. */
  const yearValues = useMemo(() => {
    if (!data || !history || timelineYear == null) return null
    return Object.fromEntries(
      Object.values(data.countries).map((c) => [c.id, historyValue(history, c, metric, timelineYear)]),
    )
  }, [data, history, timelineYear, metric])

  const country = useMemo(() => {
    if (!data) return { scale: null, values: {} as ValueMap }
    if (!yearValues || !history) return colorScale(Object.values(data.countries), metric, (id) => focusIds.has(id))
    // One scale over every year, so a color means the same value across the whole timeline.
    const all: number[] = []
    for (const id of focusIds) {
      const c = data.countries[id]
      if (!c) continue
      for (let y = history.from; y <= history.to; y++) {
        const v = historyValue(history, c, metric, y)
        if (v != null) all.push(v)
      }
    }
    const scale = metric === 'none' ? null : buildScale(all, metric)
    const values: ValueMap = {}
    if (scale) for (const [id, v] of Object.entries(yearValues)) values[id] = v == null ? -1 : positionOn(v, scale)
    return { scale, values }
  }, [data, metric, focusIds, yearValues, history])
  // One scale over every region on the map, counting only countries that have regional data for the metric
  // (the others keep their national color).
  const region = useMemo(() => {
    // Regions have no yearly data: with the timeline open the country is colored as a whole.
    if (!mapRegions || !metricInfo.regional || timelineYear != null || quizMap.progress)
      return { scale: null as Scale | null, values: {} as ValueMap }
    const items = mapRegions.features.map((f) => f.properties)
    const withData = new Set(items.filter((r) => metricValue(r, metric) != null).map((r) => r.countryId))
    return colorScale(
      items.filter((r) => withData.has(r.countryId)),
      metric,
      () => true,
    )
  }, [mapRegions, metric, metricInfo, timelineYear, quizMap.progress])
  const regionsColored = Boolean(region.scale)

  const controlsHeight = useControlsHeight(narrow && data !== null)
  // Keep the camera framing inside the map area left visible by the floating cards (see index.css widths).
  const padding = useMemo<PaddingOptions>(() => {
    if (narrow) {
      return { top: Math.max(controlsHeight, 90) + 12, bottom: Math.round(window.innerHeight * 0.42), left: 16, right: 16 }
    }
    return compact ? { top: 40, bottom: 40, left: 296, right: 356 } : { top: 40, bottom: 40, left: 340, right: 420 }
  }, [narrow, compact, controlsHeight])

  /** Phones: details of the last tapped region or place (desktop shows them on hover). */
  const [pinned, setPinned] = useState<{ target: HoverTarget; x: number; y: number } | null>(null)
  const onInspect = useCallback((target: HoverTarget | null, x: number, y: number) => {
    setPinned(target ? { target, x, y } : null)
  }, [])
  const previewTimer = useRef<number | undefined>(undefined)
  const onHover = useCallback((target: HoverTarget | null, x: number, y: number) => {
    setHover(target ? { target, x, y } : null)
    const id = targetCountryId(target)
    window.clearTimeout(previewTimer.current)
    if (!id) setPreviewId(null)
    else previewTimer.current = window.setTimeout(() => setPreviewId(id), PREVIEW_DELAY_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(previewTimer.current), [])

  const selectView = useCallback((id: ViewId) => {
    setSelectedId(null)
    setViewId(id)
  }, [setSelectedId])

  // The quiz drives the map: it flies to the question's country, and names, capitals, cities and
  // tooltips stay hidden until the question is answered (reveal=true), then everything shows.
  const onQuizFocus = useCallback((countryId: string | null, reveal: boolean) => {
    setSelectedId(countryId)
    setQuizRevealed(reveal)
  }, [setSelectedId])

  // Keep the address in step with the map, so it can be copied or shared at any time (study mode is not shared).
  useEffect(() => {
    const hash = writeUrlState({
      view: viewId,
      metric,
      country: studying ? undefined : (selectedId ?? undefined),
      projection,
      background,
      year: timelineYear ?? undefined,
      night,
    })
    const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(null, '', url)
  }, [viewId, metric, selectedId, studying, projection, background, timelineYear, night])

  // A link pasted into the same tab only changes the hash: apply it.
  useEffect(() => {
    const onHash = () => {
      const s = readUrlState(window.location.hash)
      setViewId(s.view ?? URL_DEFAULTS.view)
      setMetric(s.metric ?? URL_DEFAULTS.metric)
      setProjection(s.projection ?? URL_DEFAULTS.projection)
      setBackground(s.background ?? URL_DEFAULTS.background)
      setYear(s.year ?? null)
      setNight(s.night ?? false)
      setSelectedId(s.country ?? null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setSelectedId])

  if (error) return <div className="fatal">Impossibile caricare i dati: {error}</div>
  if (!data) return <div className="fatal">Caricamento dati…</div>

  const selected = selectedId ? data.countries[selectedId] : null
  const hideAnswers = studying && !quizRevealed
  const showRegionScale = Boolean((selected || previewRegions) && regionsColored)
  const legendNote =
    selected && regions && metric !== 'none' && !regionsColored
      ? `${metricInfo.label}: nessun dato regionale per ${selected.name}`
      : undefined
  const baseScope = !showRegionScale ? view.label : previewRegions ? 'Regioni' : `Regioni · ${selected!.name}`
  const legendScope = timelineYear != null ? `${view.label} · ${timelineYear}` : baseScope
  // While studying, the quiz may ask for regions and outline one, or show progress instead of the metric.
  const quizRegionsOnly = studying && quizMap.progress ? null : mapRegions

  return (
    <div className={`app${studying ? ' app-studying' : ''}`}>
      <MapView
        data={data}
        view={view}
        projection={projection}
        background={background}
        theme={theme}
        ramp={(showRegionScale ? region.scale : country.scale)?.ramp ?? null}
        nightAt={night ? now : null}
        pickMode={studying && quizMap.pickMode}
        quizMarks={studying ? quizMap.marks : null}
        highlightRegionId={studying ? quizMap.regionId : null}
        progress={studying ? quizMap.progress : null}
        onMapClick={onMapClick}
        countryValues={country.values}
        focusIds={focusIds}
        selectedId={selectedId}
        regions={quizRegionsOnly}
        regionValues={region.values}
        showCapitals={showCapitals && !hideAnswers}
        showCities={showCities && !hideAnswers}
        labels={!hideAnswers}
        padding={padding}
        interactive={!studying}
        resetToken={resetToken}
        onHover={onHover}
        onInspect={onInspect}
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
        background={background}
        onBackground={setBackground}
        night={night}
        onNight={setNight}
        timeline={{
          available: hasHistory,
          from: history?.from ?? null,
          to: history?.to ?? null,
          year: timelineYear,
          loading: hasHistory && year != null && !history,
          onYear: setYear,
        }}
        showCapitals={showCapitals}
        onShowCapitals={setShowCapitals}
        showCities={showCities}
        onShowCities={setShowCities}
        onSelectCountry={setSelectedId}
        onStudy={toggleStudy}
        studying={studying}
        scale={showRegionScale ? region.scale : country.scale}
        legendScope={legendScope}
        legendNote={legendNote}
        hoverValue={hideAnswers ? null : hoveredValue(hover?.target ?? null, data, metric, showRegionScale, yearValues)}
      />
      <aside className="card panel" aria-live="polite">
        {studying ? (
          <QuizPanel
            data={data}
            scopeIds={focusIds}
            scopeLabel={view.label}
            onFocus={onQuizFocus}
            onExit={toggleStudy}
            onMap={setQuizMap}
            mapPick={mapPick}
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
            history={history}
            year={timelineYear}
            yearValues={yearValues}
            now={now}
          />
        )}
      </aside>
      {hover && !narrow && !hideAnswers && (
        <Tooltip data={data} hover={hover} metric={metric} year={timelineYear} yearValues={yearValues} now={now} />
      )}
      {pinned && narrow && !hideAnswers && (
        <Tooltip
          data={data}
          hover={pinned}
          metric={metric}
          year={timelineYear}
          yearValues={yearValues}
          now={now}
          pinned
          onClose={() => setPinned(null)}
        />
      )}
    </div>
  )
}

function noop() {}

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

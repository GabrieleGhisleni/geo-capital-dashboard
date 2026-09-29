import type { FeatureCollection, Geometry } from 'geojson'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flagUrl, HISTORY_METRICS, historyValue, type Dataset } from '../data'
import { distinctOffsets, formatOffset, localTime, offsetMinutes } from '../time'
import { formatCompact, formatMetric, formatMetricCompact, formatNumber, formatShare, metricValue } from '../scale'
import type { Country, History, Metric, Region } from '../types'
import { CONTINENT_LABEL, METRICS, SUBREGION_LABEL, type ViewDef } from '../views'

type Props = {
  data: Dataset
  view: ViewDef
  metric: Metric
  focusIds: Set<string>
  selectedId: string | null
  regions: FeatureCollection<Geometry, Region> | null
  regionsFailed: boolean
  onSelect: (id: string | null) => void
  /** Yearly series of the metric (loaded with the timeline or for the selected country's trend). */
  history: History | null
  /** Timeline year and its values; null = latest data. */
  year: number | null
  yearValues: Record<string, number | null> | null
  now: Date
}

export function SidePanel(props: Props) {
  const country = props.selectedId ? props.data.countries[props.selectedId] : null
  return country ? <CountryDetail {...props} country={country} /> : <Ranking {...props} />
}

const FIT_MIN_PX = 9

/**
 * Shrinks a single-line text (white-space: nowrap, set on phones) until it fits its box, down to FIT_MIN_PX;
 * past that it may wrap. Refits when the tile's width changes. Where the text may wrap anyway (desktop) nothing
 * overflows, so nothing changes.
 */
function useFitText<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    const fit = () => {
      el.style.fontSize = ''
      el.style.whiteSpace = ''
      let size = parseFloat(getComputedStyle(el).fontSize)
      while (el.scrollWidth > el.clientWidth && size > FIT_MIN_PX) {
        size -= 0.5
        el.style.fontSize = `${size}px`
      }
      if (el.scrollWidth > el.clientWidth) el.style.whiteSpace = 'normal'
    }
    fit()
    // Watch the tile, not the text: the text's own size changes while fitting.
    let width = box.clientWidth
    const ro = new ResizeObserver(() => {
      if (box.clientWidth !== width) {
        width = box.clientWidth
        fit()
      }
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [text])
  return ref
}

function Stat({ label, value, note, title }: { label: string; value: string; note?: string | null; title?: string }) {
  const valueRef = useFitText<HTMLSpanElement>(value)
  return (
    // On phones the note is hidden to keep the tiles small; the title keeps it available.
    <div className="stat" title={[title, note].filter(Boolean).join(' · ') || undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value" ref={valueRef}>
        {value}
      </span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

export function Flag({ country, className = 'flag' }: { country: Country; className?: string }) {
  const src = flagUrl(country)
  return src ? <img className={className} src={src} alt="" loading="lazy" /> : null
}

/** World Bank indicators shown as stats in the country detail, after the core ones. */
const EXTRA_STATS: { metric: Metric; label: string; year: (c: Country) => number | null }[] = [
  { metric: 'gdpPerCapitaPpp', label: 'PIL p.c. (PPA)', year: (c) => c.gdpPerCapitaPppYear },
  { metric: 'elderlyShare', label: 'Over 65', year: (c) => c.elderlyShareYear },
  { metric: 'fertility', label: 'Figli per donna', year: (c) => c.fertilityYear },
  { metric: 'urbanShare', label: 'Popolazione urbana', year: (c) => c.urbanShareYear },
  { metric: 'co2PerCapita', label: 'CO₂ pro capite', year: (c) => c.co2PerCapitaYear },
]

function Ranking({ data, view, metric, focusIds, onSelect, year, yearValues }: Props) {
  const rankMetric: Metric = metric === 'none' ? 'population' : metric
  const focus = useMemo(() => [...focusIds].map((id) => data.countries[id]).filter(Boolean), [data, focusIds])
  const ranked = useMemo(
    () =>
      focus
        .map((c) => ({ c, v: yearValues ? (yearValues[c.id] ?? null) : metricValue(c, rankMetric) }))
        .filter((r): r is { c: Country; v: number } => r.v != null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 15),
    [focus, rankMetric, yearValues],
  )
  const totalPop = focus.reduce((s, c) => s + (c.population ?? 0), 0)
  const totalArea = focus.reduce((s, c) => s + (c.area ?? 0), 0)
  const max = ranked[0]?.v ?? 1
  const metricLabel = METRICS.find((m) => m.id === rankMetric)!.label

  return (
    <>
      <header className="panel-header">
        <p className="eyebrow">Panoramica</p>
        <h2>{view.label}</h2>
      </header>
      <div className="stats">
        <Stat label="Stati e territori" value={formatNumber(focus.length)} />
        <Stat label="Popolazione" value={formatCompact(totalPop)} />
        <Stat label="Superficie" value={`${formatCompact(totalArea)} km²`} />
      </div>
      <h3>
        Classifica per {metricLabel.toLowerCase()}
        {year != null && ` · ${year}`}
      </h3>
      <ol className="ranking">
        {ranked.map(({ c, v }, i) => (
          <li key={c.id}>
            <button type="button" onClick={() => onSelect(c.id)}>
              <span className="rank">{i + 1}</span>
              <span className="rank-name">
                <Flag country={c} className="flag flag-sm" />
                {c.name}
              </span>
              <span className="rank-value">{formatMetric(v, rankMetric)}</span>
              <span className="bar" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
            </button>
          </li>
        ))}
      </ol>
      <p className="hint muted">Clicca uno Stato sulla mappa per vederne regioni, capoluoghi e città.</p>
    </>
  )
}

/** Third column of the regions table: the metric on the map, or the area when it is population or none. */
const REGION_COLUMN: Partial<Record<Metric, string>> = {
  density: 'ab./km²',
  gdp: 'PIL',
  gdpPerCapita: 'PIL p.c.',
  lifeExpectancy: 'Anni di vita',
}

type RegionSort = 'name' | 'population' | 'column'

const PHONE_QUERY = '(max-width: 899px)'

type CityRow = { name: string; lat: number; lon: number; population: number | null; role: 'capitale' | 'capoluogo' | null }

/** Rough distance in km; enough to spot the same city coming from two sources. */
function nearKm(a: CityRow, b: CityRow): number {
  const dx = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(dx, a.lat - b.lat) * 111
}

/** Local time of the capital and the country's UTC offsets now ("3 fusi orari, UTC−5 … UTC−3"). */
function CapitalClock({ country, now }: { country: Country; now: Date }) {
  const zone = country.capitals[0]?.timezone
  const time = zone ? localTime(zone, now) : null
  const offsets = distinctOffsets(country.timezones.length ? country.timezones : zone ? [zone] : [], now)
  if (!time && !offsets.length) return null
  const own = zone ? offsetMinutes(zone, now) : null
  const zones =
    offsets.length > 1
      ? `${offsets.length} fusi orari (${formatOffset(offsets[0])} … ${formatOffset(offsets.at(-1)!)})`
      : own != null
        ? formatOffset(own)
        : null
  return (
    <p className="capital-clock">
      {time && (
        <>
          Ora locale <strong>{time}</strong>
        </>
      )}
      {time && zones && ' · '}
      {zones}
    </p>
  )
}

/** Small line chart of the metric over the years, with the timeline year (or the last one) marked. */
function Trend({ history, country, metric, year }: { history: History; country: Country; metric: Metric; year: number | null }) {
  const points: [number, number][] = []
  for (let y = history.from; y <= history.to; y++) {
    const v = historyValue(history, country, metric, y)
    if (v != null) points.push([y, v])
  }
  if (points.length < 2) return null
  const W = 300
  const H = 56
  const pad = 4
  const [x0, x1] = [points[0][0], points.at(-1)![0]]
  const values = points.map((p) => p[1])
  const [lo, hi] = [Math.min(...values), Math.max(...values)]
  const x = (yr: number) => pad + ((yr - x0) / Math.max(1, x1 - x0)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad)
  const path = points.map(([yr, v], i) => `${i ? 'L' : 'M'}${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const marked = points.find(([yr]) => yr === year) ?? points.at(-1)!
  const label = METRICS.find((m) => m.id === metric)!.label
  return (
    <section className="trend">
      <h3>Andamento · {label.toLowerCase()}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label={`${label} dal ${x0} al ${x1}`}>
        <path d={path} className="trend-line" />
        <circle cx={x(marked[0])} cy={y(marked[1])} r={3.5} className="trend-dot" />
      </svg>
      <div className="trend-foot">
        <span>
          {x0}: <strong>{formatMetricCompact(points[0][1], metric)}</strong>
        </span>
        <span>
          {marked[0]}: <strong>{formatMetricCompact(marked[1], metric)}</strong>
        </span>
      </div>
    </section>
  )
}

function CountryDetail(props: Props & { country: Country }) {
  const { data, metric, regions, regionsFailed, onSelect, country, history, year, now } = props
  const density = metricValue(country, 'density')
  // Phones: the bottom sheet is short, so neighbours, regions and cities start collapsed.
  const [neighborsOpen, setNeighborsOpen] = useState(() => !window.matchMedia(PHONE_QUERY).matches)
  const [regionsOpen, setRegionsOpen] = useState(() => !window.matchMedia(PHONE_QUERY).matches)
  const [citiesOpen, setCitiesOpen] = useState(() => !window.matchMedia(PHONE_QUERY).matches)
  const neighbors = (data.neighbors[country.id] ?? []).map((id) => data.countries[id])
  // Most populous first by default; the headers switch to name (A–Z) or the third column (largest first).
  const [regionSort, setRegionSort] = useState<RegionSort>('population')
  const columnMetric: Metric = REGION_COLUMN[metric] ? metric : 'area'
  const regionList = useMemo(() => {
    const list = regions?.features.map((f) => f.properties) ?? []
    if (regionSort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'it'))
    const key: Metric = regionSort === 'population' ? 'population' : columnMetric
    return [...list].sort((a, b) => (metricValue(b, key) ?? -1) - (metricValue(a, key) ?? -1))
  }, [regions, regionSort, columnMetric])
  const sortHeader = (id: RegionSort, label: string) => (
    <button type="button" className="th-sort" onClick={() => setRegionSort(id)} aria-pressed={regionSort === id}>
      {label}
      <span className="th-sort-mark" aria-hidden>
        {regionSort === id ? (id === 'name' ? '▴' : '▾') : ''}
      </span>
    </button>
  )

  const cities = useMemo(() => {
    // Capitals first so they win the dedup against the same city from GeoNames.
    const candidates: CityRow[] = country.capitals.map((c) => ({ ...c, role: 'capitale' }))
    for (const r of regionList) {
      if (r.capName && r.capLat != null && r.capLon != null)
        candidates.push({ name: r.capName, lat: r.capLat, lon: r.capLon, population: r.capPop ?? null, role: 'capoluogo' })
    }
    for (const c of data.citiesByCountry[country.id] ?? []) candidates.push({ ...c, role: null })
    const rows: CityRow[] = []
    for (const c of candidates) {
      const dup = rows.find((r) => r.name === c.name || nearKm(r, c) < 7)
      if (!dup) rows.push(c)
      else if (dup.population == null) dup.population = c.population
    }
    return rows.sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 15)
  }, [country, regionList, data])

  const source = (s: string | null, year?: number | null) => [s, year].filter(Boolean).join(' · ') || null

  return (
    <>
      <header className="panel-header">
        <button type="button" className="back" onClick={() => onSelect(null)} aria-label="Torna alla panoramica">
          ← <span className="back-label">Panoramica</span>
        </button>
        <p className="eyebrow">
          {CONTINENT_LABEL[country.continent] ?? country.continent} ·{' '}
          {SUBREGION_LABEL[country.subregion] ?? country.subregion}
        </p>
        <h2 className="country-title">
          <Flag country={country} className="flag flag-lg" />
          {country.name}
        </h2>
        {country.capitals.length > 0 && (
          <p className="capital-line">
            <span className="capital-dot" aria-hidden /> Capitale: <strong>{country.capitals.map((c) => c.name).join(' / ')}</strong>
          </p>
        )}
        <CapitalClock country={country} now={now} />
      </header>
      <div className="stats">
        <Stat label="Popolazione" value={formatCompact(country.population)} note={source(country.populationSource, country.populationYear)} title={formatNumber(country.population)} />
        <Stat label="Superficie" value={`${formatCompact(country.area)} km²`} note={country.areaSource} title={`${formatNumber(country.area)} km²`} />
        <Stat label="Densità" value={`${formatNumber(density)} ab./km²`} />
        <Stat label="PIL" value={formatMetric(country.gdp, 'gdp')} note={source(country.gdp ? 'World Bank' : null, country.gdpYear)} />
        <Stat
          label="PIL pro capite"
          value={formatMetric(country.gdpPerCapita, 'gdpPerCapita')}
          note={source(country.gdpPerCapita ? 'World Bank' : null, country.gdpPerCapitaYear)}
        />
        <Stat
          label="Aspettativa di vita"
          value={formatMetric(country.lifeExpectancy, 'lifeExpectancy')}
          note={source(country.lifeExpectancy ? 'World Bank' : null, country.lifeExpectancyYear)}
        />
        {EXTRA_STATS.map(({ metric: m, label, year }) => (
          <Stat
            key={m}
            label={label}
            value={formatMetricCompact(metricValue(country, m), m)}
            title={formatMetric(metricValue(country, m), m)}
            note={source(metricValue(country, m) != null ? 'World Bank' : null, year(country))}
          />
        ))}
      </div>

      {history && HISTORY_METRICS.has(metric) && <Trend history={history} country={country} metric={metric} year={year} />}

      <details
        className="section-toggle"
        open={neighborsOpen}
        onToggle={(e) => setNeighborsOpen(e.currentTarget.open)}
      >
        <summary>
          <h3>
            Confina con <span className="muted">({neighbors.length})</span>
          </h3>
        </summary>
        {neighbors.length ? (
          <ul className="neighbors">
            {neighbors.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)}>
                  <Flag country={n} className="flag flag-sm" />
                  {n.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nessun confine terrestre.</p>
        )}
      </details>

      {country.admin1Count > 0 && (
        <details
          className="section-toggle"
          open={regionsOpen}
          onToggle={(e) => setRegionsOpen(e.currentTarget.open)}
        >
          <summary>
            <h3>
              Regioni e suddivisioni <span className="muted">({regionList.length || country.admin1Count})</span>
            </h3>
          </summary>
          {regionsFailed ? (
            <p className="muted">Regioni non disponibili.</p>
          ) : !regions ? (
            <p className="muted">Caricamento…</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" aria-sort={regionSort === 'name' ? 'ascending' : 'none'}>
                      {sortHeader('name', 'Regione · capoluogo')}
                    </th>
                    <th
                      scope="col"
                      className="num"
                      title="Abitanti e quota della popolazione dello Stato"
                      aria-sort={regionSort === 'population' ? 'descending' : 'none'}
                    >
                      {sortHeader('population', 'Abitanti')}
                    </th>
                    <th scope="col" className="num" aria-sort={regionSort === 'column' ? 'descending' : 'none'}>
                      {sortHeader('column', REGION_COLUMN[metric] ?? 'km²')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {regionList.map((r) => (
                    <tr key={r.id}>
                      <td title={r.type}>
                        {r.name}
                        {r.capName && <span className="cell-sub">{r.capName}</span>}
                      </td>
                      <td className="num" title={r.populationYear ? `dato ${r.populationYear}` : undefined}>
                        {formatCompact(r.population)}
                        {formatShare(r.population, country.population) && (
                          <span className="cell-sub">{formatShare(r.population, country.population)}</span>
                        )}
                      </td>
                      <td className="num" title={regionColumnTitle(r, metric)}>
                        {REGION_COLUMN[metric]
                          ? formatMetricCompact(metricValue(r, metric), metric)
                          : formatCompact(r.area)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}

      <details
        className="section-toggle"
        open={citiesOpen}
        onToggle={(e) => setCitiesOpen(e.currentTarget.open)}
      >
        <summary>
          <h3>
            Città principali <span className="muted">({cities.length})</span>
          </h3>
        </summary>
        <ol className="cities">
          {cities.map((c) => (
            <li key={`${c.name}-${c.lat}`}>
              <span className="city-name">
                {c.name}
                {c.role && <span className={`badge badge-${c.role}`}>{c.role}</span>}
              </span>
              <span className="city-pop">
                {formatNumber(c.population)}
                {formatShare(c.population, country.population) && (
                  <span className="city-share">{formatShare(c.population, country.population)}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </>
  )
}

function regionColumnTitle(r: Region, metric: Metric): string | undefined {
  const y = metric === 'lifeExpectancy' ? r.lifeExpectancyYear : metric === 'gdp' || metric === 'gdpPerCapita' ? r.gdpYear : null
  const v = metricValue(r, metric)
  return REGION_COLUMN[metric] && v != null ? `${formatMetric(v, metric)}${y ? ` · dato ${y}` : ''}` : undefined
}

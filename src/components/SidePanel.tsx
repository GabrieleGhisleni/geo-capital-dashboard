import type { FeatureCollection, Geometry } from 'geojson'
import { useMemo } from 'react'
import type { Dataset } from '../data'
import { formatCompact, formatMetric, formatNumber, metricValue } from '../scale'
import type { Country, Metric, Region } from '../types'
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
}

export function SidePanel(props: Props) {
  const country = props.selectedId ? props.data.countries[props.selectedId] : null
  return (
    <aside className="card panel" aria-live="polite">
      {country ? <CountryDetail {...props} country={country} /> : <Ranking {...props} />}
    </aside>
  )
}

function Stat({ label, value, note, title }: { label: string; value: string; note?: string | null; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

function Ranking({ data, view, metric, focusIds, onSelect }: Props) {
  const rankMetric: Metric = metric === 'none' ? 'population' : metric
  const focus = useMemo(() => [...focusIds].map((id) => data.countries[id]).filter(Boolean), [data, focusIds])
  const ranked = useMemo(
    () =>
      focus
        .map((c) => ({ c, v: metricValue(c, rankMetric) }))
        .filter((r): r is { c: Country; v: number } => r.v != null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 15),
    [focus, rankMetric],
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
      <h3>Classifica per {metricLabel.toLowerCase()}</h3>
      <ol className="ranking">
        {ranked.map(({ c, v }, i) => (
          <li key={c.id}>
            <button type="button" onClick={() => onSelect(c.id)}>
              <span className="rank">{i + 1}</span>
              <span className="rank-name">{c.name}</span>
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

type CityRow = { name: string; lat: number; lon: number; population: number | null; role: 'capitale' | 'capoluogo' | null }

/** Rough distance in km; enough to spot the same city coming from two sources. */
function nearKm(a: CityRow, b: CityRow): number {
  const dx = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(dx, a.lat - b.lat) * 111
}

function CountryDetail({ data, metric, regions, regionsFailed, onSelect, country }: Props & { country: Country }) {
  const density = metricValue(country, 'density')
  const regionList = useMemo(() => {
    const list = regions?.features.map((f) => f.properties) ?? []
    const key: Metric = metric === 'none' ? 'population' : metric
    return [...list].sort((a, b) => (metricValue(b, key) ?? -1) - (metricValue(a, key) ?? -1))
  }, [regions, metric])

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
          ← Panoramica
        </button>
        <p className="eyebrow">
          {CONTINENT_LABEL[country.continent] ?? country.continent} ·{' '}
          {SUBREGION_LABEL[country.subregion] ?? country.subregion}
        </p>
        <h2>{country.name}</h2>
        {country.capitals.length > 0 && (
          <p className="capital-line">
            <span className="capital-dot" aria-hidden /> Capitale: <strong>{country.capitals.map((c) => c.name).join(' / ')}</strong>
          </p>
        )}
      </header>
      <div className="stats">
        <Stat label="Popolazione" value={formatCompact(country.population)} note={source(country.populationSource, country.populationYear)} title={formatNumber(country.population)} />
        <Stat label="Superficie" value={`${formatCompact(country.area)} km²`} note={country.areaSource} title={`${formatNumber(country.area)} km²`} />
        <Stat label="Densità" value={`${formatNumber(density)} ab./km²`} />
      </div>

      {country.admin1Count > 0 && (
        <section>
          <h3>
            Regioni e suddivisioni <span className="muted">({regionList.length || country.admin1Count})</span>
          </h3>
          {regionsFailed ? (
            <p className="muted">Regioni non disponibili.</p>
          ) : !regions ? (
            <p className="muted">Caricamento…</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Regione · capoluogo</th>
                    <th scope="col" className="num">Abitanti</th>
                    <th scope="col" className="num">km²</th>
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
                      </td>
                      <td className="num">{formatCompact(r.area)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <h3>Città principali</h3>
        <ol className="cities">
          {cities.map((c) => (
            <li key={`${c.name}-${c.lat}`}>
              <span className="city-name">
                {c.name}
                {c.role && <span className={`badge badge-${c.role}`}>{c.role}</span>}
              </span>
              <span className="city-pop">{formatNumber(c.population)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

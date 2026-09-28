import { useEffect, useMemo, useState } from 'react'
import type { Scale } from '../App'
import type { Dataset } from '../data'
import { formatCompact } from '../scale'
import type { Metric, Projection, ViewId } from '../types'
import { METRICS, VIEWS } from '../views'

type Props = {
  data: Dataset
  viewId: ViewId
  onView: (id: ViewId) => void
  metric: Metric
  onMetric: (m: Metric) => void
  projection: Projection
  onProjection: (p: Projection) => void
  showCapitals: boolean
  onShowCapitals: (v: boolean) => void
  showCities: boolean
  onShowCities: (v: boolean) => void
  onSelectCountry: (id: string) => void
  scale: Scale
  legendTitle: string
}

const NARROW_QUERY = '(max-width: 899px)'

/** Map options start collapsed on phones so the map stays visible; they are always open on wider screens. */
function useOptionsOpen() {
  const [open, setOpen] = useState(() => !window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    const onChange = () => setOpen(!mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return [open, setOpen] as const
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className={`segmented${options.length > 3 ? ' segmented-grid' : ''}`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? 'active' : ''}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Search({ data, onSelect }: { data: Dataset; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const options = useMemo(
    () =>
      Object.values(data.countries)
        .filter((c) => c.continent !== 'Antarctica')
        .sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [data],
  )
  const submit = (value: string) => {
    const q = value.trim().toLowerCase()
    if (!q) return
    const hit =
      options.find((c) => c.name.toLowerCase() === q || c.nameEn.toLowerCase() === q) ??
      options.find((c) => c.name.toLowerCase().startsWith(q) || c.nameEn.toLowerCase().startsWith(q))
    if (hit) {
      onSelect(hit.id)
      setQuery('')
    }
  }
  return (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(query)
      }}
    >
      <input
        type="search"
        list="country-list"
        placeholder="Cerca uno Stato…"
        aria-label="Cerca uno Stato"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          // Selecting a datalist entry fires a change with the exact name.
          if (options.some((c) => c.name === e.target.value)) submit(e.target.value)
        }}
      />
      <datalist id="country-list">
        {options.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </form>
  )
}

function Legend({ scale, metric, title }: { scale: Scale; metric: Metric; title: string }) {
  if (metric === 'none' || !scale.colors.length) return null
  const unit = METRICS.find((m) => m.id === metric)!
  const { breaks, colors } = scale
  const labelFor = (i: number) => {
    if (breaks.length === 0) return 'tutti'
    if (i === 0) return `< ${formatCompact(breaks[0])}`
    if (i === colors.length - 1) return `≥ ${formatCompact(breaks[i - 1])}`
    return `${formatCompact(breaks[i - 1])} – ${formatCompact(breaks[i])}`
  }
  return (
    <div className="legend">
      <div className="legend-title">
        {unit.label} <span className="muted">({unit.unit})</span>
        <span className="legend-scope">{title} · quantili</span>
      </div>
      {/* Compact single-row ramp, shown instead of the list on narrow screens. */}
      <div className="legend-compact">
        <div className="legend-ramp">
          {colors.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
          <span className="swatch-nodata" title="dato non disponibile" />
        </div>
        <div className="legend-ends">
          <span>{labelFor(0)}</span>
          {colors.length > 1 && <span>{labelFor(colors.length - 1)}</span>}
        </div>
      </div>
      <ul>
        {colors.map((c, i) => (
          <li key={c}>
            <span className="swatch" style={{ background: c }} />
            {labelFor(i)}
          </li>
        ))}
        <li>
          <span className="swatch swatch-nodata" />
          dato non disponibile
        </li>
      </ul>
    </div>
  )
}

export function Controls(props: Props) {
  const { data, viewId, onView, metric, onMetric, projection, onProjection } = props
  const [optionsOpen, setOptionsOpen] = useOptionsOpen()
  return (
    <aside className="card controls" aria-label="Controlli">
      <header>
        <h1>Geo Capital Dashboard</h1>
        <p className="muted">Stati, capitali, regioni e città del mondo</p>
      </header>
      <Search data={data} onSelect={props.onSelectCountry} />
      <details
        className="controls-body"
        open={optionsOpen}
        onToggle={(e) => setOptionsOpen(e.currentTarget.open)}
      >
        <summary>Opzioni mappa</summary>
        <div className="field">
          <span className="field-label">Vista</span>
          <div className="view-grid">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={viewId === v.id ? 'active' : ''}
                aria-pressed={viewId === v.id}
                onClick={() => {
                  onView(v.id)
                  // On phones, get the options out of the way so the new view is visible.
                  if (window.matchMedia(NARROW_QUERY).matches) setOptionsOpen(false)
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <Segmented label="Colora per" value={metric} options={METRICS} onChange={onMetric} />
        <Segmented
          label="Proiezione"
          value={projection}
          options={[
            { id: 'globe', label: 'Globo' },
            { id: 'mercator', label: 'Piana' },
          ]}
          onChange={onProjection}
        />
        <div className="field toggles">
          <label>
            <input type="checkbox" checked={props.showCapitals} onChange={(e) => props.onShowCapitals(e.target.checked)} />
            Capitali e capoluoghi
          </label>
          <label>
            <input type="checkbox" checked={props.showCities} onChange={(e) => props.onShowCities(e.target.checked)} />
            Città principali
          </label>
        </div>
      </details>
      <Legend scale={props.scale} metric={metric} title={props.legendTitle} />
      <footer className="sources">
        Dati aggiornati al {new Date(data.meta.generatedAt).toLocaleDateString('it-IT')} ·{' '}
        {data.meta.sources.map((s, i) => (
          <span key={s.name}>
            {i > 0 && ', '}
            <a href={s.url} target="_blank" rel="noreferrer" title={`${s.usedFor} — ${s.license}`}>
              {s.name.split(' (')[0]}
            </a>
          </span>
        ))}
      </footer>
    </aside>
  )
}

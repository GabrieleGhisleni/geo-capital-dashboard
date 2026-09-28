import { useEffect, useMemo, useState } from 'react'
import type { Dataset } from '../data'
import { RAMPS, rampGradient, type Scale } from '../scale'
import type { Metric, Projection, ViewId } from '../types'
import { METRICS, VIEWS } from '../views'
import { Legend } from './Legend'

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
  onStudy: () => void
  studying: boolean
  scale: Scale | null
  legendScope: string
  legendNote?: string
  hoverValue: number | null
}

const NARROW_QUERY = '(max-width: 899px)'

const PROJECTIONS: { id: Projection; label: string; hint: string }[] = [
  { id: 'globe', label: 'Globo', hint: 'Il globo: forme e aree reali' },
  { id: 'equal-earth', label: 'Piana', hint: 'Equal Earth: le aree degli Stati sono proporzionali a quelle reali' },
  { id: 'mercator', label: 'Mercatore', hint: 'Mercatore: forme fedeli, ma ingrandisce le terre vicino ai poli' },
]

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
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(query)
      }}
    >
      <svg viewBox="0 0 20 20" aria-hidden className="search-icon">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
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

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
      {label}
    </label>
  )
}

export function Controls(props: Props) {
  const { data, viewId, onView, metric, onMetric, projection, onProjection } = props
  const [optionsOpen, setOptionsOpen] = useOptionsOpen()
  return (
    <aside className="card controls" aria-label="Controlli">
      <header className="brand">
        <div>
          <h1>Atlante</h1>
          <p>Stati, capitali e città del mondo</p>
        </div>
        <button
          type="button"
          className={`study-button${props.studying ? ' active' : ''}`}
          onClick={props.onStudy}
          aria-pressed={props.studying}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path
              d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Zm3 2v4c0 1.4 1.8 2.5 4 2.5s4-1.1 4-2.5v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          Studia
        </button>
      </header>
      <Search data={data} onSelect={props.onSelectCountry} />
      <details className="controls-body" open={optionsOpen} onToggle={(e) => setOptionsOpen(e.currentTarget.open)}>
        <summary>Opzioni mappa</summary>
        <div className="field">
          <span className="field-label">Vista</span>
          <div className="chips" role="radiogroup" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                className={`chip${viewId === v.id ? ' active' : ''}`}
                aria-checked={viewId === v.id}
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
        <div className="field">
          <span className="field-label">Colora per</span>
          <div className="metric-grid" role="radiogroup" aria-label="Colora per">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={metric === m.id}
                className={`metric${metric === m.id ? ' active' : ''}`}
                onClick={() => onMetric(m.id)}
              >
                <span
                  className="metric-swatch"
                  style={{ background: m.id === 'none' ? undefined : rampGradient(RAMPS[m.id]) }}
                  aria-hidden
                />
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Proiezione</span>
          <div className="segmented" role="radiogroup" aria-label="Proiezione">
            {PROJECTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                title={p.hint}
                aria-checked={projection === p.id}
                className={projection === p.id ? 'active' : ''}
                onClick={() => onProjection(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field toggles">
          <Switch checked={props.showCapitals} onChange={props.onShowCapitals} label="Capitali e capoluoghi" />
          <Switch checked={props.showCities} onChange={props.onShowCities} label="Città principali" />
        </div>
      </details>
      <Legend
        scale={props.scale}
        metric={metric}
        scope={props.legendScope}
        hoverValue={props.hoverValue}
        note={props.legendNote}
      />
      <footer className="sources">
        Dati al {new Date(data.meta.generatedAt).toLocaleDateString('it-IT')} ·{' '}
        {data.meta.sources.map((s, i) => (
          <span key={s.name}>
            {i > 0 && ' · '}
            <a href={s.url} target="_blank" rel="noreferrer" title={`${s.usedFor} — ${s.license}`}>
              {s.name.split(' (')[0]}
            </a>
          </span>
        ))}
      </footer>
    </aside>
  )
}

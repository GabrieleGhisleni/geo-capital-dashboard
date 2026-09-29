import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Dataset } from '../data'
import { RAMPS, rampGradient, type Scale } from '../scale'
import type { Background, Metric, Projection, ViewId } from '../types'
import { METRIC_HINT, METRICS, VIEWS } from '../views'
import { Legend } from './Legend'
import { Timeline, type TimelineProps } from './Timeline'
import type { Theme } from '../useTheme'

type Props = {
  data: Dataset
  viewId: ViewId
  onView: (id: ViewId) => void
  metric: Metric
  onMetric: (m: Metric) => void
  projection: Projection
  onProjection: (p: Projection) => void
  background: Background
  onBackground: (b: Background) => void
  night: boolean
  onNight: (v: boolean) => void
  timeline: TimelineProps
  theme: Theme
  onTheme: (t: Theme) => void
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
export const SEARCH_INPUT_ID = 'country-search'

const BACKGROUNDS: { id: Background; label: string; hint: string }[] = [
  { id: 'plain', label: 'Semplice', hint: 'Solo i colori della mappa' },
  { id: 'relief', label: 'Rilievo', hint: 'Rilievo e fondali marini (immagini NASA, caricate da internet)' },
]

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
        id={SEARCH_INPUT_ID}
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

/** Shares the current address (the map state lives in its hash): the system sheet on phones, else the clipboard. */
function ShareButton() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  const share = async () => {
    const url = window.location.href
    if (navigator.share && window.matchMedia('(hover: none)').matches) {
      await navigator.share({ title: document.title, url }).catch(() => undefined) // dismissed: nothing to do
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      window.prompt('Copia il link:', url) // clipboard blocked (insecure origin, permissions)
    }
  }
  return (
    <button
      type="button"
      className={`icon-button share-button${copied ? ' is-done' : ''}`}
      onClick={share}
      title="Condividi questa mappa (vista, indicatore, Stato, anno)"
      aria-label={copied ? 'Link copiato' : 'Condividi questa mappa'}
    >
      {copied ? (
        '✓'
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path
            d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="share-toast" aria-live="polite">
        {copied ? 'Link copiato' : ''}
      </span>
    </button>
  )
}

function ThemeButton({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => onTheme(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      title={dark ? 'Tema chiaro' : 'Tema scuro'}
      aria-label="Tema scuro"
    >
      <svg viewBox="0 0 20 20" aria-hidden>
        {dark ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" />
          </g>
        ) : (
          <path
            d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  )
}

/** Every metric as a button in a two-column grid, grouped by theme, each with its color ramp. */
function MetricGrid({ metric, onMetric }: { metric: Metric; onMetric: (m: Metric) => void }) {
  return (
    <div className="metric-grid" role="radiogroup" aria-label="Colora per">
      {METRICS.map((m, i) => (
        <Fragment key={m.id}>
          {m.group && m.group !== METRICS[i - 1]?.group && (
            <span className="metric-group" aria-hidden>
              {m.group}
            </span>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={metric === m.id}
            title={METRIC_HINT[m.id]}
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
        </Fragment>
      ))}
    </div>
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

        </div>
        <span className="brand-actions">
          <ThemeButton theme={props.theme} onTheme={props.onTheme} />
          <ShareButton />
          <button
            type="button"
            className={`study-button${props.studying ? ' active' : ''}`}
            onClick={props.onStudy}
            aria-pressed={props.studying}
            title={props.studying ? 'Esci dalla modalità studio (S)' : 'Modalità studio (S)'}
            aria-keyshortcuts="S"
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
        </span>
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
          <MetricGrid metric={metric} onMetric={onMetric} />
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
        <div className="field">
          <span className="field-label">Sfondo</span>
          <div className="segmented" role="radiogroup" aria-label="Sfondo">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                title={b.hint}
                aria-checked={props.background === b.id}
                className={props.background === b.id ? 'active' : ''}
                onClick={() => props.onBackground(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
          {props.background === 'relief' && projection === 'equal-earth' && (
            <p className="field-note">Il rilievo non si può mostrare nella vista Piana: usa Globo o Mercatore.</p>
          )}
        </div>
        <div className="field toggles">
          <Switch checked={props.showCapitals} onChange={props.onShowCapitals} label="Capitali e capoluoghi" />
          <Switch checked={props.showCities} onChange={props.onShowCities} label="Città principali" />
          <Switch checked={props.night} onChange={props.onNight} label="Giorno e notte" />
        </div>
      </details>
      <Legend
        scale={props.scale}
        metric={metric}
        scope={props.legendScope}
        hoverValue={props.hoverValue}
        note={props.legendNote}
      />
      <Timeline {...props.timeline} />
      {/* Folded to keep the card within the screen; the sources are also behind the map's ⓘ button. */}
      <details className="sources">
        <summary>Fonti e scorciatoie</summary>
        <p className="shortcuts" aria-label="Scorciatoie da tastiera">
          <kbd>R</kbd> ripristina la mappa · <kbd>S</kbd> studio · <kbd>/</kbd> cerca · <kbd>Esc</kbd> chiudi
        </p>
        <p>
          Dati al {new Date(data.meta.generatedAt).toLocaleDateString('it-IT')} ·{' '}
          {data.meta.sources.map((s, i) => (
            <span key={s.name}>
              {i > 0 && ' · '}
              <a href={s.url} target="_blank" rel="noreferrer" title={`${s.usedFor} — ${s.license}`}>
                {s.name.split(' (')[0]}
              </a>
            </span>
          ))}
        </p>
      </details>
    </aside>
  )
}

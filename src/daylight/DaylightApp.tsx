import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { flagUrl, loadPlaces, type Places } from '../data'
import { DAY, dayShift, formatChange, formatClock, formatDuration, sunYear, type SunDay } from '../sunTimes'
import { formatOffset } from '../time'
import type { Country } from '../types'
import { ShareButton, ThemeButton } from '../components/HeaderButtons'
import { useTheme } from '../useTheme'
import { CityPicker } from './CityPicker'
import { DayLengthChart, DayStrip, SunTimesChart, type Pointer, type Range, type Series } from './charts'
import { dayLabel, MONTHS, sunSummary } from './days'
import { buildPlaces, DEFAULT_IDS, MAX_PLACES, PRESETS, readHash, writeHash, type Place } from './places'

/** A chosen city and its color slot, which it keeps while other cities are added or removed. */
type Choice = { id: string; slot: number }

const STORAGE_KEY = 'daylight:places'
const ATLAS_URL = import.meta.env.BASE_URL

function storedIds(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string').slice(0, MAX_PLACES) : []
  } catch {
    return [] // storage blocked or garbled: start from the defaults
  }
}

const withSlots = (ids: string[]): Choice[] => ids.slice(0, MAX_PLACES).map((id, slot) => ({ id, slot }))

/** Index of a date in the year's day list (0 = 1 January); month 12 is January of the next year. */
const dayIndex = (year: number, month: number, day: number) => (Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / DAY

function periodRange(year: number, month: number | null): Range {
  if (month == null) return { from: 0, to: dayIndex(year, 12, 1) - 1 }
  return { from: dayIndex(year, month, 1), to: dayIndex(year, month + 1, 1) - 1 }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function formatCoord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}° ${v >= 0 ? pos : neg}`
}

/** Runs [first, last] of consecutive days that pass a test. */
function dayRuns(days: SunDay[], test: (d: SunDay) => boolean): [number, number][] {
  const runs: [number, number][] = []
  days.forEach((d, i) => {
    if (!test(d)) return
    const last = runs[runs.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  })
  return runs
}

/** "dal 18 mag al 25 lug", "fino al 14 gen e dal 28 nov"; `endShift` 1 names the day after each run instead. */
function runsText(days: SunDay[], runs: [number, number][], endShift = 0): string {
  const date = (i: number) => dayLabel(days[Math.min(i, days.length - 1)].date, true)
  return runs
    .map(([a, b]) =>
      a === 0 ? `fino al ${date(b + endShift)}` : b === days.length - 1 ? `dal ${date(a)}` : `dal ${date(a)} al ${date(b + endShift)}`,
    )
    .join(' e ')
}

/** "UTC+1, ora legale dal 29 mar al 25 ott" from the offsets of the year's days (no zone: solar time). */
function zoneSummary(days: SunDay[], zone: string | null): string {
  if (!zone) return `ora solare (${formatOffset(days[0].offset)}): fuso orario sconosciuto`
  const standard = Math.min(...days.map((d) => d.offset))
  const runs = dayRuns(days, (d) => d.offset !== standard)
  // The clocks change back on the day after the last one on summer time.
  return runs.length ? `${formatOffset(standard)}, ora legale ${runsText(days, runs, 1)}` : formatOffset(standard)
}

function periodStats(days: SunDay[], range: Range) {
  const slice = days.slice(range.from, range.to + 1)
  let max = slice[0]
  let min = slice[0]
  let sum = 0
  for (const d of slice) {
    if (d.daylight > max.daylight) max = d
    if (d.daylight < min.daylight) min = d
    sum += d.daylight
  }
  return {
    max,
    min,
    mean: sum / slice.length,
    change: slice[slice.length - 1].daylight - slice[0].daylight,
    up: slice.filter((d) => d.sun === 'up').length,
    down: slice.filter((d) => d.sun === 'down').length,
  }
}

function Flag({ country }: { country: Country | undefined }) {
  const src = country ? flagUrl(country) : null
  return src ? <img className="flag flag-sm" src={src} alt="" /> : null
}

/** A clock time, with a small "+1" when it falls on the next day (a sunset past midnight). */
function Clock({ hours }: { hours: number }) {
  const shift = dayShift(hours)
  return (
    <>
      {formatClock(hours)}
      {shift !== 0 && (
        <sup className="dl-shift" title={shift > 0 ? 'il giorno dopo' : 'il giorno prima'}>
          {shift > 0 ? '+1' : '−1'}
        </sup>
      )}
    </>
  )
}

function CityCard(props: {
  place: Place
  country: Country | undefined
  series: Series
  active: number
  range: Range
  month: number | null
  onRemove: () => void
}) {
  const { place, country, series, active, range, month } = props
  const day = series.days[active]
  const prev = series.days[active - 1]
  const stats = periodStats(series.days, range)
  const atlas = `${ATLAS_URL}#c=${place.countryId}`
  return (
    <article className={`dl-card dl-city series-${series.slot + 1}`}>
      <header className="dl-city-head">
        <span className={`dl-key series-${series.slot + 1}`} aria-hidden />
        <div className="dl-city-title">
          <h2>{place.name}</h2>
          <a className="dl-city-country" href={atlas} title="Apri lo Stato nell’atlante">
            <Flag country={country} />
            {country?.name ?? place.countryId}
            {place.capital && <span className="muted"> · capitale</span>}
          </a>
        </div>
        <button type="button" className="dl-remove" onClick={props.onRemove} aria-label={`Togli ${place.name}`} title="Togli dal confronto">
          ×
        </button>
      </header>
      <p className="dl-city-meta">
        {formatCoord(place.lat, 'N', 'S')} · {formatCoord(place.lon, 'E', 'O')} · {zoneSummary(series.days, place.timezone)}
      </p>
      <div className="dl-city-day">
        <p className="dl-hero">
          {formatDuration(day.daylight)}
          <span className="dl-hero-label">di sole il {dayLabel(day.date)}</span>
        </p>
        {typeof day.sun === 'string' ? (
          <p className="dl-polar">{capitalize(sunSummary(day))}</p>
        ) : (
          <dl className="dl-times">
            <div>
              <dt>Alba</dt>
              <dd>
                <Clock hours={day.sun.rise} />
              </dd>
            </div>
            <div>
              <dt>Tramonto</dt>
              <dd>
                <Clock hours={day.sun.set} />
              </dd>
            </div>
            <div>
              <dt>Sul giorno prima</dt>
              <dd>{prev ? formatChange(day.daylight - prev.daylight) : '—'}</dd>
            </div>
          </dl>
        )}
        <DayStrip day={day} />
      </div>
      <ul className="dl-city-stats">
        {month == null ? (
          <>
            <li>
              {stats.up ? (
                <>
                  Sole di mezzanotte per <strong>{stats.up} giorni</strong>,{' '}
                  {runsText(series.days, dayRuns(series.days, (d) => d.sun === 'up'))}
                </>
              ) : (
                <>
                  Giorno più lungo <strong>{formatDuration(stats.max.daylight)}</strong> il {dayLabel(stats.max.date, true)}
                </>
              )}
            </li>
            <li>
              {stats.down ? (
                <>
                  Notte polare per <strong>{stats.down} giorni</strong>,{' '}
                  {runsText(series.days, dayRuns(series.days, (d) => d.sun === 'down'))}
                </>
              ) : (
                <>
                  Più corto <strong>{formatDuration(stats.min.daylight)}</strong> il {dayLabel(stats.min.date, true)}
                </>
              )}
            </li>
          </>
        ) : (
          <>
            <li>
              Media di {MONTHS[month]} <strong>{formatDuration(stats.mean)}</strong>
            </li>
            <li>
              Dall’inizio alla fine del mese <strong>{formatChange(stats.change)}</strong>
            </li>
          </>
        )}
      </ul>
    </article>
  )
}

/** Exact values: month by month for the year, day by day for a month. Rows pick the month or the day. */
function DaylightTable(props: {
  series: Series[]
  year: number
  month: number | null
  active: number
  onMonth: (m: number) => void
  onDay: (i: number) => void
}) {
  const { series, year, month, active } = props
  const head = (
    <thead>
      <tr>
        <th scope="col">{month == null ? 'Mese' : 'Giorno'}</th>
        {series.map((s) => (
          <th key={s.id} scope="col">
            <span className={`dl-key series-${s.slot + 1}`} aria-hidden /> {s.name}
          </th>
        ))}
      </tr>
    </thead>
  )
  if (month == null) {
    return (
      <table className="dl-table">
        {head}
        <tbody>
          {MONTHS.map((name, m) => {
            const range = periodRange(year, m)
            const current = active >= range.from && active <= range.to
            return (
              <tr key={name} className={current ? 'is-active' : undefined} onClick={() => props.onMonth(m)}>
                <th scope="row">
                  <button type="button" className="dl-row-link" onClick={() => props.onMonth(m)}>
                    {capitalize(name)}
                  </button>
                </th>
                {series.map((s) => {
                  const st = periodStats(s.days, range)
                  return (
                    <td key={s.id} className="num">
                      {formatDuration(st.mean)}
                      <span className="cell-sub">{formatChange(st.change)}</span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }
  const range = periodRange(year, month)
  const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })
  const rows = []
  for (let i = range.from; i <= range.to; i++) rows.push(i)
  return (
    <table className="dl-table">
      {head}
      <tbody>
        {rows.map((i) => {
          const date = series[0].days[i].date
          return (
            <tr key={i} className={i === active ? 'is-active' : undefined} onClick={() => props.onDay(i)} aria-current={i === active ? 'date' : undefined}>
              <th scope="row">
                <span className="dl-weekday">{weekday.format(date)}</span> {new Date(date).getUTCDate()}
              </th>
              {series.map((s) => {
                const d = s.days[i]
                const prev = s.days[i - 1]
                return (
                  <td key={s.id} className="num">
                    {typeof d.sun === 'string' ? (
                      d.sun === 'up' ? 'sole di mezzanotte' : 'notte polare'
                    ) : (
                      <>
                        <Clock hours={d.sun.rise} /> – <Clock hours={d.sun.set} />
                      </>
                    )}
                    <span className="cell-sub">
                      {formatDuration(d.daylight)}
                      {prev && ` · ${formatChange(d.daylight - prev.daylight)}`}
                    </span>
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function DaylightApp() {
  const [theme, setTheme] = useTheme()
  const [data, setData] = useState<(Places & { places: Place[]; byId: Map<string, Place> }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initial] = useState(() => readHash(window.location.hash))
  const [choices, setChoices] = useState<Choice[]>(() =>
    withSlots(initial.ids.length ? initial.ids : storedIds().length ? storedIds() : DEFAULT_IDS),
  )
  const [month, setMonth] = useState<number | null>(initial.month)
  const [pinned, setPinned] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // The page shows the current year; `now` is read once (a page left open overnight keeps yesterday as today).
  const [now] = useState(() => new Date())
  const year = now.getFullYear()

  useEffect(() => {
    loadPlaces().then((d) => {
      const places = buildPlaces(d)
      const byId = new Map(places.map((p) => [p.id, p]))
      // Names a data rebuild no longer has are dropped; with none left, the default comparison.
      setChoices((list) => {
        const known = list.filter((c) => byId.has(c.id))
        return known.length ? known : withSlots(DEFAULT_IDS.filter((id) => byId.has(id)))
      })
      setData({ ...d, places, byId })
    }, (e: Error) => setError(e.message))
  }, [])

  // The address holds the comparison (shareable); the last one is also remembered for the next visit.
  useEffect(() => {
    const hash = writeHash({ ids: choices.map((c) => c.id), month })
    const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(null, '', url)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choices.map((c) => c.id)))
    } catch {
      // not remembered: the address still has it
    }
  }, [choices, month])

  useEffect(() => {
    const onHash = () => {
      const s = readHash(window.location.hash)
      setChoices(withSlots(s.ids))
      setMonth(s.month)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const series = useMemo<Series[]>(() => {
    if (!data) return []
    return choices.flatMap(({ id, slot }) => {
      const p = data.byId.get(id)
      return p ? [{ id, slot, name: p.name, days: sunYear(p.lat, p.lon, p.timezone, year) }] : []
    })
  }, [choices, data, year])

  const range = useMemo(() => periodRange(year, month), [year, month])
  const today = dayIndex(year, now.getMonth(), now.getDate())
  const inRange = (i: number | null): i is number => i != null && i >= range.from && i <= range.to
  const fallback = inRange(today) ? today : range.from + 14
  const active = inRange(hover) ? hover : inRange(pinned) ? pinned : fallback
  const pointer: Pointer = { active, today, onHover: setHover, onPick: setPinned }

  const add = (id: string) =>
    setChoices((list) => {
      if (list.length >= MAX_PLACES || list.some((c) => c.id === id)) return list
      const used = new Set(list.map((c) => c.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? list.length
      return [...list, { id, slot }]
    })
  const remove = (id: string) => setChoices((list) => list.filter((c) => c.id !== id))
  const choosePreset = (ids: string[]) => setChoices(withSlots(ids.filter((id) => data?.byId.has(id))))
  const selectedIds = new Set(choices.map((c) => c.id))
  const presetActive = (ids: string[]) => ids.length === choices.length && ids.every((id, i) => choices[i]?.id === id)

  // Back to the atlas: the previous page when it was the atlas (its state lives in that history entry).
  const backToAtlas = (e: MouseEvent<HTMLAnchorElement>) => {
    const atlas = new URL(ATLAS_URL, window.location.href).href
    if (document.referrer.startsWith(atlas) && !document.referrer.startsWith(`${atlas}luce`) && window.history.length > 1) {
      e.preventDefault()
      window.history.back()
    }
  }

  return (
    <div className="dl-page">
      <header className="dl-header">
        <div className="dl-title">
          <a className="dl-back" href={ATLAS_URL} onClick={backToAtlas}>
            ← Atlante
          </a>
          <h1>Ore di luce</h1>
          <p>
            Alba, tramonto e durata del giorno nel {year}, fino a {MAX_PLACES} città a confronto. Orari locali, con l’ora
            legale dove si usa.
          </p>
        </div>
        <span className="dl-actions">
          <ThemeButton theme={theme} onTheme={setTheme} />
          <ShareButton title="Condividi questo confronto (città e periodo)" label="Condividi questo confronto" />
        </span>
      </header>

      {error ? (
        <p className="dl-card dl-empty">Impossibile caricare le città: {error}</p>
      ) : !data ? (
        <p className="dl-card dl-empty">Caricamento…</p>
      ) : (
        <>
          <section className="dl-toolbar" aria-label="Città e periodo">
            <div className="dl-toolbar-row">
              <CityPicker places={data.places} countries={data.countries} selected={selectedIds} onAdd={add} />
              <div className="dl-presets" role="group" aria-label="Esempi">
                <span className="field-label">Esempi</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`chip${presetActive(p.ids) ? ' active' : ''}`}
                    title={p.hint}
                    aria-pressed={presetActive(p.ids)}
                    onClick={() => choosePreset(p.ids)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="segmented dl-period" role="radiogroup" aria-label="Periodo">
              <button
                type="button"
                role="radio"
                aria-checked={month == null}
                className={month == null ? 'active' : ''}
                onClick={() => setMonth(null)}
              >
                Anno
              </button>
              {MONTHS.map((name, m) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={month === m}
                  aria-label={capitalize(name)}
                  className={month === m ? 'active' : ''}
                  onClick={() => setMonth(m)}
                >
                  {capitalize(name.slice(0, 3))}
                </button>
              ))}
            </div>
          </section>

          {series.length === 0 ? (
            <p className="dl-card dl-empty">Scegli una città, o parti da uno degli esempi.</p>
          ) : (
            <>
              <section className={`dl-cards dl-cards-${series.length}`} aria-label="Città scelte">
                {series.map((s) => {
                  const place = data.byId.get(s.id)!
                  return (
                    <CityCard
                      key={s.id}
                      place={place}
                      country={data.countries[place.countryId]}
                      series={s}
                      active={active}
                      range={range}
                      month={month}
                      onRemove={() => remove(s.id)}
                    />
                  )
                })}
              </section>

              <section className="dl-card dl-section">
                <header className="dl-section-head">
                  <h2>Durata del giorno</h2>
                  <p className="dl-readout" aria-live="polite">
                    <span className="dl-readout-date">{dayLabel(series[0].days[active].date)}</span>
                    {series.map((s) => (
                      <span key={s.id} className="dl-readout-item">
                        <span className={`dl-key series-${s.slot + 1}`} aria-hidden />
                        <strong>{formatDuration(s.days[active].daylight)}</strong> {s.name}
                      </span>
                    ))}
                  </p>
                </header>
                <DayLengthChart series={series} range={range} pointer={pointer} />
                <p className="dl-hint muted">
                  Passa sul grafico per vedere un giorno, clicca per fissarlo (frecce ← → per spostarlo).
                </p>
              </section>

              <section className="dl-card dl-section">
                <header className="dl-section-head">
                  <h2>Alba e tramonto</h2>
                  <p className="muted">
                    Ora locale: i salti di un’ora sono i cambi dell’ora legale. Sopra le 24 il tramonto cade dopo
                    mezzanotte.
                  </p>
                </header>
                <SunTimesChart series={series} range={range} pointer={pointer} />
              </section>

              <section className="dl-card dl-section">
                <header className="dl-section-head">
                  <h2>{month == null ? 'Mese per mese' : `${capitalize(MONTHS[month])}, giorno per giorno`}</h2>
                  <p className="muted">
                    {month == null
                      ? 'Durata media del giorno; sotto, quanto cambia dal primo all’ultimo giorno. Scegli un mese per i dettagli.'
                      : 'Alba e tramonto in ora locale; sotto, le ore di sole e la variazione sul giorno prima.'}
                  </p>
                </header>
                <div className="dl-table-wrap">
                  <DaylightTable series={series} year={year} month={month} active={active} onMonth={setMonth} onDay={setPinned} />
                </div>
              </section>
            </>
          )}

          <footer className="dl-footer muted">
            <p>
              Calcolo astronomico con le equazioni solari della NOAA: alba e tramonto quando il bordo superiore del sole
              tocca l’orizzonte, con la rifrazione media; crepuscolo civile fino a 6° sotto l’orizzonte. Il rilievo e
              l’altitudine non sono considerati.
            </p>
            <p>
              Città e fusi orari:{' '}
              <a href="https://www.geonames.org" target="_blank" rel="noreferrer">
                GeoNames
              </a>{' '}
              (CC BY 4.0) · capitali e popolazione:{' '}
              <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">
                Wikidata
              </a>{' '}
              (CC0) · dati al {new Date(data.meta.generatedAt).toLocaleDateString('it-IT')}
            </p>
          </footer>
        </>
      )}
    </div>
  )
}

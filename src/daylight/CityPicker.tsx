import { useId, useMemo, useState } from 'react'
import { flagUrl } from '../data'
import { formatCompact } from '../scale'
import type { Country } from '../types'
import { MAX_PLACES, searchPlaces, type Place } from './places'

type Props = {
  places: Place[]
  countries: Record<string, Country>
  selected: Set<string>
  onAdd: (id: string) => void
}

/** Search box with suggestions (combobox): city names, or a country for its capital and major cities. */
export function CityPicker({ places, countries, selected, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listId = useId()
  const full = selected.size >= MAX_PLACES
  const results = useMemo(() => searchPlaces(places, countries, query), [places, countries, query])
  const shown = open && !full && query.trim() !== ''
  const choose = (p: Place | undefined) => {
    if (!p || selected.has(p.id)) return
    onAdd(p.id)
    setQuery('')
    setCursor(0)
  }
  return (
    <div className="search dl-picker">
      <svg viewBox="0 0 20 20" aria-hidden className="search-icon">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        role="combobox"
        aria-label="Aggiungi una città"
        aria-expanded={shown && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && results[cursor] ? `${listId}-${cursor}` : undefined}
        placeholder={full ? `Massimo ${MAX_PLACES} città: togline una per cambiarla` : 'Aggiungi una città o uno Stato…'}
        disabled={full}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setCursor(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setCursor((c) => Math.min(results.length - 1, Math.max(0, c + step)))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[cursor])
          } else if (e.key === 'Escape') {
            if (query) setQuery('')
            else setOpen(false)
          }
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" className="dl-options" aria-label="Città trovate">
          {results.length === 0 && <li className="dl-option-empty">Nessuna città trovata</li>}
          {results.map((p, i) => {
            const country = countries[p.countryId]
            const flag = country ? flagUrl(country) : null
            const taken = selected.has(p.id)
            return (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === cursor}
                aria-disabled={taken}
                className={`dl-option${i === cursor ? ' is-cursor' : ''}`}
                // Keep the focus in the input, so the list does not close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(p)}
              >
                {flag ? <img className="flag flag-sm" src={flag} alt="" /> : <span className="flag flag-sm" />}
                <span className="dl-option-name">
                  {p.name}
                  <span className="dl-option-meta">
                    {country?.name}
                    {p.capital && ' · capitale'}
                  </span>
                </span>
                <span className="dl-option-pop">{taken ? 'già scelta' : formatCompact(p.population)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

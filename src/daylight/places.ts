import { countryZone, type Places } from '../data'
import type { Capital, City, Country } from '../types'

/** A city the daylight page can compare: a capital or one of the major cities of cities.json. */
export type Place = {
  /** `ADM0.Name` (e.g. ITA.Roma): readable in shared links, stable while the name is. */
  id: string
  name: string
  countryId: string
  lat: number
  lon: number
  population: number | null
  timezone: string | null
  capital: boolean
  /** Folded name for search. */
  key: string
}

export const MAX_PLACES = 3

/** Lowercase without accents, so "reykjavik" finds Reykjavík and "citta" Città del Capo. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Id of a place in links: `ADM0.Name`. */
export const placeId = (countryId: string, name: string) => `${countryId}.${name}`

/** A capital's zone, else the country's; a few disputed entities have neither and borrow their cities' one. */
export function capitalZone(capital: Capital, country: Country, cities: City[] | undefined): string | null {
  return capital.timezone ?? countryZone(country) ?? cities?.find((c) => c.timezone)?.timezone ?? null
}

/** Capitals and major cities, most populous first. */
export function buildPlaces({ countries, citiesByCountry }: Pick<Places, 'countries' | 'citiesByCountry'>): Place[] {
  const out = new Map<string, Place>()
  const add = (p: Omit<Place, 'id' | 'key'>) => {
    const id = placeId(p.countryId, p.name)
    if (!out.has(id)) out.set(id, { ...p, id, key: fold(p.name) })
  }
  for (const country of Object.values(countries)) {
    const cities = citiesByCountry[country.id]
    for (const c of country.capitals) {
      const timezone = capitalZone(c, country, cities)
      add({ name: c.name, countryId: country.id, lat: c.lat, lon: c.lon, population: c.population, timezone, capital: true })
    }
    for (const c of cities ?? []) add({ ...c, capital: false })
  }
  return [...out.values()].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
}

/**
 * Places matching a query, best first: exact name, name start, word start, then the capital and cities of a
 * country whose name starts with it, then (3+ letters) names containing it. Ties go to the larger city.
 */
export function searchPlaces(places: Place[], countries: Record<string, Country>, query: string, limit = 8): Place[] {
  const q = fold(query.trim())
  if (!q) return []
  const countryHit = new Set(
    Object.values(countries)
      .filter((c) => fold(c.name).startsWith(q) || fold(c.nameEn).startsWith(q))
      .map((c) => c.id),
  )
  const scored: { place: Place; score: number }[] = []
  for (const place of places) {
    let score = -1
    if (place.key === q) score = 0
    else if (place.key.startsWith(q)) score = 1
    else if (place.key.split(/[\s'’-]+/).some((w) => w.startsWith(q))) score = 2
    else if (countryHit.has(place.countryId)) score = place.capital ? 3 : 4
    else if (q.length >= 3 && place.key.includes(q)) score = 5
    if (score >= 0) scored.push({ place, score })
  }
  // Stable sort: the population order of `places` breaks ties.
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.place)
}

/** Ready-made comparisons, each telling one story. Ids that a data rebuild drops are skipped. */
export const PRESETS: { label: string; hint: string; ids: string[] }[] = [
  {
    label: 'Dal nord all’equatore',
    hint: 'Più ci si allontana dall’equatore, più la durata del giorno cambia con le stagioni',
    ids: ['ISL.Reykjavík', 'ITA.Roma', 'SGP.Singapore'],
  },
  {
    label: 'Emisferi opposti',
    hint: 'Quando a Roma è estate a Sydney è inverno: le curve sono speculari',
    ids: ['ITA.Roma', 'AUS.Sydney'],
  },
  {
    label: 'Sole di mezzanotte',
    hint: 'Oltre il circolo polare il sole non tramonta per settimane d’estate e non sorge d’inverno',
    ids: ['NOR.Tromsø', 'ITA.Roma'],
  },
  {
    label: 'Stesso fuso orario',
    hint: 'Stessa ora sugli orologi, ma a Madrid il sole sorge e tramonta più di un’ora dopo che a Varsavia',
    ids: ['ESP.Madrid', 'ITA.Roma', 'POL.Varsavia'],
  },
]

export const DEFAULT_IDS = PRESETS[0].ids

// ---------------------------------------------------------------- address

/** Page state in the hash: `#c=ITA.Roma,AUS.Sydney&m=6` (m = month 1–12, absent for the whole year). */
export type DaylightState = { ids: string[]; month: number | null }

const ID_PATTERN = /^[A-Z0-9]{3}\../

export function readHash(hash: string): DaylightState {
  const state: DaylightState = { ids: [], month: null }
  for (const pair of hash.replace(/^#/, '').split('&')) {
    const [key, value = ''] = pair.split('=')
    if (key === 'c') {
      // Each id is encoded on its own, so a comma inside a name cannot split it.
      state.ids = [
        ...new Set(
          value
            .split(',')
            .map((part) => {
              try {
                return decodeURIComponent(part)
              } catch {
                return ''
              }
            })
            .filter((id) => ID_PATTERN.test(id)),
        ),
      ].slice(0, MAX_PLACES)
    } else if (key === 'm') {
      const m = Number(value)
      if (Number.isInteger(m) && m >= 1 && m <= 12) state.month = m - 1
    }
  }
  return state
}

export function writeHash({ ids, month }: DaylightState): string {
  const parts = []
  if (ids.length) parts.push(`c=${ids.map(encodeURIComponent).join(',')}`)
  if (month != null) parts.push(`m=${month + 1}`)
  return parts.join('&')
}

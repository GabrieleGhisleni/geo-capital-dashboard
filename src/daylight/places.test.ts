import { describe, expect, it } from 'vitest'
import citiesJson from '../../public/data/cities.json?raw'
import countriesJson from '../../public/data/countries.json?raw'
import type { Country } from '../types'
import { buildPlaces, PRESETS, readHash, searchPlaces, writeHash } from './places'

function country(id: string, name: string, nameEn: string, capital: string, timezone: string | null): Country {
  return {
    id,
    name,
    nameEn,
    capitals: [{ name: capital, lat: 0, lon: 0, population: 1_000_000, timezone }],
    timezones: timezone ? [timezone] : [],
  } as Country
}

const countries = {
  ITA: country('ITA', 'Italia', 'Italy', 'Roma', 'Europe/Rome'),
  ISL: country('ISL', 'Islanda', 'Iceland', 'Reykjavík', 'Atlantic/Reykjavik'),
  SOL: country('SOL', 'Somaliland', 'Somaliland', 'Hargeisa', null),
}
const city = (name: string, countryId: string, population: number, timezone: string | null) => ({
  name,
  lat: 0,
  lon: 0,
  population,
  countryId,
  timezone,
})
const places = buildPlaces({
  countries,
  citiesByCountry: {
    ITA: [city('Milano', 'ITA', 1_370_000, 'Europe/Rome'), city('Romano di Lombardia', 'ITA', 20_000, 'Europe/Rome')],
    SOL: [city('Burao', 'SOL', 400_000, 'Africa/Mogadishu')],
  },
})

describe('places', () => {
  it('lists capitals and cities, with a zone for every one', () => {
    expect(places.map((p) => p.id)).toContain('ITA.Roma')
    expect(places.find((p) => p.id === 'ITA.Roma')?.capital).toBe(true)
    // No zone for the capital: it borrows the one of the country's cities.
    expect(places.find((p) => p.id === 'SOL.Hargeisa')?.timezone).toBe('Africa/Mogadishu')
  })

  it('searches names without accents, then countries', () => {
    expect(searchPlaces(places, countries, 'reykjavik')[0].id).toBe('ISL.Reykjavík')
    expect(searchPlaces(places, countries, 'Rom').map((p) => p.id)).toEqual(['ITA.Roma', 'ITA.Romano di Lombardia'])
    expect(searchPlaces(places, countries, 'lombardia')[0].id).toBe('ITA.Romano di Lombardia')
    // A country name lists its capital first, then its cities by size.
    expect(searchPlaces(places, countries, 'italia').map((p) => p.id)).toEqual([
      'ITA.Roma',
      'ITA.Milano',
      'ITA.Romano di Lombardia',
    ])
    expect(searchPlaces(places, countries, '  ')).toEqual([])
  })
})

describe('address', () => {
  it('round-trips cities and month', () => {
    const state = { ids: ['ITA.Roma', 'ISL.Reykjavík', 'ZAF.Città del Capo'], month: 5 }
    const hash = writeHash(state)
    expect(hash).toBe('c=ITA.Roma,ISL.Reykjav%C3%ADk,ZAF.Citt%C3%A0%20del%20Capo&m=6')
    expect(readHash(`#${hash}`)).toEqual(state)
  })

  it('drops what it cannot read', () => {
    expect(readHash('#c=ITA.Roma,bad,%E0%A4%A,ITA.Roma&m=13')).toEqual({ ids: ['ITA.Roma'], month: null })
    expect(readHash('#c=AAA.B,CCC.D,EEE.F,GGG.H').ids).toHaveLength(3)
    expect(readHash('')).toEqual({ ids: [], month: null })
  })
})

describe('presets', () => {
  it('name places of the shipped data', () => {
    const data = { countries: JSON.parse(countriesJson), citiesByCountry: {} as Record<string, ReturnType<typeof city>[]> }
    for (const [id, rows] of Object.entries(JSON.parse(citiesJson) as Record<string, [string, number, number, number, string?][]>))
      data.citiesByCountry[id] = rows.map(([name, , , population, zone]) => city(name, id, population, zone ?? null))
    const ids = new Set(buildPlaces(data).map((p) => p.id))
    for (const preset of PRESETS) for (const id of preset.ids) expect(ids, preset.label).toContain(id)
  })
})

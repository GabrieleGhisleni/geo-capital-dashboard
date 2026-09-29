import { describe, expect, it } from 'vitest'
import type { Country } from '../types'
import {
  answerPoint,
  borderQuestion,
  deckStatus,
  distanceKm,
  gradeMapAnswer,
  LOCATE_CAPITAL_KM,
  regionQuestion,
  buildPool,
  capitalLabel,
  createDeck,
  currentCard,
  gradeCard,
  isQuizEligible,
  makeQuestion,
  modePool,
  pickDistractors,
  POP_MIN_RATIO,
  populationOptions,
  REVIEW_LATER,
  restoreDeck,
  REVIEW_SOON,
  shuffle,
  type Rng,
} from './quiz'

/** Deterministic mulberry32 so tests are stable. */
function seeded(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function country(id: string, over: Partial<Country> = {}): Country {
  return {
    id,
    name: `Stato ${id}`,
    nameEn: id,
    iso2: null,
    iso3: id,
    continent: 'Europe',
    subregion: 'Southern Europe',
    type: 'Sovereign country',
    population: 1_000_000,
    populationYear: 2025,
    populationSource: 'World Bank',
    gdp: null,
    gdpYear: null,
    gdpPerCapita: null,
    gdpPerCapitaYear: null,
    lifeExpectancy: null,
    lifeExpectancyYear: null,
    gdpPerCapitaPpp: null,
    gdpPerCapitaPppYear: null,
    elderlyShare: null,
    elderlyShareYear: null,
    fertility: null,
    fertilityYear: null,
    urbanShare: null,
    urbanShareYear: null,
    co2PerCapita: null,
    co2PerCapitaYear: null,
    area: 1000,
    areaSource: 'World Bank',
    capitals: [{ name: `Capitale ${id}`, lat: 0, lon: 0, population: null }],
    timezones: [],
    label: null,
    labelMinZoom: null,
    bbox: [0, 0, 1, 1],
    admin1Count: 0,
    ...over,
  }
}

const POPS = [59e6, 48e6, 10e6, 83e6, 68e6, 2.1e6, 0.5e6, 38e6, 5.5e6, 9e6, 0.04e6, 1.3e6]
const EUROPE = POPS.map((population, i) =>
  country(`E${i}`, {
    population,
    subregion: i < 4 ? 'Southern Europe' : i < 8 ? 'Western Europe' : 'Northern Europe',
  }),
)

describe('pool', () => {
  it('keeps states with a capital and population, skipping dependencies and Antarctica', () => {
    const countries: Record<string, Country> = Object.fromEntries(
      [
        country('ITA'),
        country('KAZ', { type: 'Sovereignty' }),
        country('GBR', { type: 'Country' }),
        country('JEY', { type: 'Country' }),
        country('KOS', { type: 'Disputed', population: 1_500_000 }),
        country('FLK', { type: 'Disputed', population: 4550 }),
        country('PRI', { type: 'Dependency' }),
        country('PSE', { type: 'Indeterminate', capitals: [] }),
        country('NOC', { capitals: [] }),
        country('NOP', { population: null }),
        country('ATA', { continent: 'Antarctica' }),
      ].map((c) => [c.id, c]),
    )
    const pool = buildPool(countries, [...Object.keys(countries), 'MISSING'])
    expect(pool.map((c) => c.id).sort()).toEqual(['GBR', 'ITA', 'KAZ', 'KOS'])
  })

  it('respects the scope', () => {
    const countries = { A: country('A'), B: country('B') }
    expect(buildPool(countries, new Set(['B'])).map((c) => c.id)).toEqual(['B'])
    expect(isQuizEligible(country('X', { population: 0 }))).toBe(false)
  })
})

describe('shuffle', () => {
  it('is a deterministic permutation for a given rng', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const a = shuffle(items, seeded(1))
    expect([...a].sort()).toEqual(items)
    expect(shuffle(items, seeded(1))).toEqual(a)
    expect(items).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('distractors', () => {
  it('are distinct, exclude the answer and prefer the same subregion', () => {
    for (let seed = 0; seed < 50; seed++) {
      const answer = EUROPE[0]
      const picked = pickDistractors(answer, EUROPE, 3, seeded(seed), capitalLabel)
      expect(picked).toHaveLength(3)
      expect(picked.map((c) => c.id)).not.toContain(answer.id)
      expect(new Set(picked.map(capitalLabel)).size).toBe(3)
      expect(picked.every((c) => c.subregion === answer.subregion)).toBe(true)
    }
  })

  it('skips options whose label duplicates the answer', () => {
    const twin = country('T', { capitals: [{ name: 'Capitale E0', lat: 0, lon: 0, population: null }] })
    const picked = pickDistractors(EUROPE[0], [...EUROPE, twin], 11, seeded(3), capitalLabel)
    expect(picked.map((c) => c.id)).not.toContain('T')
  })

  it('falls back to the extra pool when the scope is too small', () => {
    const picked = pickDistractors(EUROPE[0], EUROPE.slice(0, 2), 3, seeded(5), (c) => c.name, EUROPE)
    expect(picked).toHaveLength(3)
    expect(new Set(picked.map((c) => c.id)).size).toBe(3)
  })

  it('builds a 4-choice question with exactly one correct answer', () => {
    for (const mode of ['capital', 'country', 'population'] as const) {
      const q = makeQuestion(mode, EUROPE[2], EUROPE, seeded(7))
      expect(q.choices).toHaveLength(4)
      expect(q.choices.filter((c) => c.correct)).toHaveLength(1)
      expect(new Set(q.choices.map((c) => c.label)).size).toBe(4)
      expect(new Set(q.choices.map((c) => c.key)).size).toBe(4)
    }
    const q = makeQuestion('capital', EUROPE[2], EUROPE, seeded(7))
    expect(q.choices.find((c) => c.correct)!.label).toBe('Capitale E2')
  })
})

describe('population options', () => {
  const pairwiseDistinct = (values: number[]) =>
    values.every((a, i) => values.every((b, j) => i === j || Math.max(a, b) / Math.min(a, b) >= POP_MIN_RATIO))

  it('include the real value and are pairwise clearly distinct', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const target of EUROPE) {
        const opts = populationOptions(target, EUROPE, seeded(seed))
        const values = opts.map((o) => o.value)
        expect(opts).toHaveLength(4)
        expect(opts.filter((o) => o.countryId === target.id)).toEqual([
          { value: target.population, countryId: target.id },
        ])
        expect(pairwiseDistinct(values)).toBe(true)
      }
    }
  })

  it('synthesizes values when the scope has too few distinct populations', () => {
    const clones = [1, 2, 3].map((i) => country(`C${i}`, { population: 1_000_000 + i }))
    const opts = populationOptions(clones[0], clones, seeded(2))
    expect(opts).toHaveLength(4)
    expect(pairwiseDistinct(opts.map((o) => o.value))).toBe(true)
    expect(opts.filter((o) => o.countryId === null)).toHaveLength(3)
  })
})

describe('deck', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  const fresh = () => ({ ...createDeck(ids, seeded(1)), queue: [...ids] })

  it('brings a missed card back after REVIEW_SOON cards', () => {
    const d = gradeCard(fresh(), false, 'flashcard')
    expect(currentCard(d)).toBe('b')
    expect(d.queue.indexOf('a')).toBe(REVIEW_SOON)
    expect(d.queue).toHaveLength(ids.length)
    expect(d.misses.a).toBe(1)
  })

  it('retires cards known at first sight in flashcard mode', () => {
    const d = gradeCard(fresh(), true, 'flashcard')
    expect(d.queue).not.toContain('a')
    expect(d.mastered).toEqual(['a'])
  })

  it('needs consecutive recalls to retire a missed card', () => {
    let d = gradeCard(fresh(), false, 'flashcard')
    while (currentCard(d) !== 'a') d = gradeCard(d, true, 'flashcard')
    d = gradeCard(d, true, 'flashcard')
    expect(d.mastered).not.toContain('a')
    expect(d.queue.indexOf('a')).toBe(Math.min(REVIEW_LATER, d.queue.length - 1))
    while (currentCard(d) !== 'a') d = gradeCard(d, true, 'flashcard')
    d = gradeCard(d, true, 'flashcard')
    expect(d.mastered).toContain('a')
  })

  it('empties once everything is known', () => {
    let d = fresh()
    let guard = 0
    while (currentCard(d) && guard++ < 100) d = gradeCard(d, guard % 3 !== 0, 'flashcard')
    expect(currentCard(d)).toBeNull()
    expect([...d.mastered].sort()).toEqual(ids)
  })

  it('asks every card once per round in multiple-choice mode', () => {
    let d = gradeCard(fresh(), true, 'choice')
    expect(d.queue).not.toContain('a')
    expect(d.mastered).toEqual(['a'])
    d = gradeCard(d, false, 'choice')
    expect(d.queue.at(-1)).toBe('b')
    expect(d.queue.indexOf('b')).toBe(ids.length - 2)
  })

  it('never repeats a card before the others have been asked', () => {
    let d = fresh()
    const asked: string[] = []
    for (let i = 0; i < ids.length; i++) {
      asked.push(currentCard(d)!)
      d = gradeCard(d, i % 2 === 0, 'choice')
    }
    expect(new Set(asked).size).toBe(ids.length)
    expect(d.queue).toHaveLength(ids.length / 2)
  })

  it('ends the round once every card is answered right', () => {
    let d = fresh()
    let guard = 0
    while (currentCard(d) && guard++ < 100) d = gradeCard(d, guard % 4 !== 0, 'choice')
    expect(currentCard(d)).toBeNull()
    expect([...d.mastered].sort()).toEqual(ids)
  })
})

describe('restoreDeck', () => {
  const ids = ['a', 'b', 'c']
  it('restores a deck that matches the pool', () => {
    const saved = gradeCard(createDeck(ids, seeded(3)), true, 'choice')
    expect(restoreDeck(JSON.parse(JSON.stringify(saved)), ids)).toEqual(saved)
  })

  it('rejects decks from another pool or malformed data', () => {
    const saved = createDeck(ids, seeded(3))
    expect(restoreDeck(saved, ['a', 'b'])).toBeNull()
    expect(restoreDeck(saved, ['a', 'b', 'x'])).toBeNull()
    expect(restoreDeck({ ...saved, queue: ['a', 'a', 'b'] }, ids)).toBeNull()
    expect(restoreDeck('nope', ids)).toBeNull()
    expect(restoreDeck(null, ids)).toBeNull()
  })
})

describe('flag and border modes', () => {
  const ita = country('ITA', { name: 'Italia', iso2: 'IT' })
  const fra = country('FRA', { name: 'Francia', iso2: 'FR', subregion: 'Western Europe' })
  const che = country('CHE', { name: 'Svizzera', iso2: 'CH', subregion: 'Western Europe' })
  const mlt = country('MLT', { name: 'Malta', iso2: 'MT' })
  const bra = country('BRA', { name: 'Brasile', iso2: 'BR', continent: 'South America', subregion: 'South America' })
  const esp = country('ESP', { name: 'Spagna', iso2: 'ES' })
  const grc = country('GRC', { name: 'Grecia', iso2: 'GR' })
  const sol = country('SOL', { name: 'Somaliland', iso2: null })
  const world = [ita, fra, che, mlt, bra, esp, grc, sol]
  const neighbors = { ITA: ['FRA', 'CHE'], FRA: ['ITA', 'CHE', 'ESP', 'BRA'], CHE: ['ITA', 'FRA'], ESP: ['FRA'], BRA: ['FRA'] }

  it('asks flags only of countries that have one', () => {
    expect(modePool('flag', world, world, neighbors).map((c) => c.id)).not.toContain('SOL')
  })

  it('asks borders only of countries with a land neighbour', () => {
    const ids = modePool('border', world, world, neighbors).map((c) => c.id)
    expect(ids).toEqual(['ITA', 'FRA', 'CHE', 'BRA', 'ESP'])
  })

  it('offers exactly one neighbour, preferably on the same continent', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = borderQuestion(fra, world, seeded(seed), [], neighbors)
      const right = q.choices.filter((c) => c.correct)
      expect(right).toHaveLength(1)
      expect(right[0].key).not.toBe('BRA')
      expect(neighbors.FRA).toContain(right[0].key)
      const wrong = q.choices.filter((c) => !c.correct).map((c) => c.key)
      expect(wrong.some((id) => neighbors.FRA.includes(id) || id === 'FRA')).toBe(false)
      expect(new Set(q.choices.map((c) => c.label)).size).toBe(q.choices.length)
    }
  })

  it('leaves out countries too small to see on the map', () => {
    const vatican = country('VAT', { name: 'Città del Vaticano', area: 0.44 })
    const ids = modePool('shape', [...world, vatican], world, neighbors).map((c) => c.id)
    expect(ids).toContain('ITA')
    expect(ids).not.toContain('VAT')
  })

  it('names the shape question options by country', () => {
    const q = makeQuestion('shape', ita, world, seeded(2))
    expect(q.choices.find((c) => c.correct)?.label).toBe('Italia')
    expect(q.choices).toHaveLength(4)
  })

  it('names the flag question options by country', () => {
    const q = makeQuestion('flag', ita, world, seeded(4))
    expect(q.choices.find((c) => c.correct)?.label).toBe('Italia')
    expect(q.choices.every((c) => c.note === null)).toBe(true)
  })
})

describe('where is…? (map answers)', () => {
  const rome = { name: 'Roma', lat: 41.9, lon: 12.5, population: 2_750_000 }
  const ita = country('ITA', { name: 'Italia', capitals: [rome], label: [11.1, 44.7] })

  it('measures great-circle distances', () => {
    expect(distanceKm([12.5, 41.9], [2.35, 48.86])).toBeCloseTo(1106, -1) // Rome–Paris
    expect(distanceKm([0, 0], [0, 0])).toBe(0)
  })

  it('grades a state by the country clicked', () => {
    expect(gradeMapAnswer('locate', ita, [12, 43], 'ITA').correct).toBe(true)
    const miss = gradeMapAnswer('locate', ita, [2.35, 48.86], 'FRA')
    expect(miss.correct).toBe(false)
    expect(miss.pickedCountryId).toBe('FRA')
    expect(miss.km).toBeGreaterThan(500)
  })

  it('grades a capital by distance', () => {
    expect(gradeMapAnswer('locateCapital', ita, [12.9, 42.3], null).correct).toBe(true)
    const far = gradeMapAnswer('locateCapital', ita, [9.19, 45.46], 'ITA') // Milan
    expect(far.km).toBeGreaterThan(LOCATE_CAPITAL_KM)
    expect(far.correct).toBe(false)
    expect(answerPoint('locateCapital', ita)).toEqual([12.5, 41.9])
    expect(answerPoint('locate', ita)).toEqual([11.1, 44.7])
  })
})

describe('regions quiz', () => {
  const region = (id: string, name: string, capName?: string) =>
    ({ id, name, capName, countryId: 'ITA', colorIndex: 0 }) as const
  const regions = [
    region('a', 'Lazio', 'Roma'),
    region('b', 'Lombardia', 'Milano'),
    region('c', 'Veneto', 'Venezia'),
    region('d', 'Toscana', 'Firenze'),
    region('e', 'Molise'),
  ]

  it('asks the capital or the outlined region, with four distinct options', () => {
    const asks = new Set<string>()
    for (let seed = 1; seed < 20; seed++) {
      const q = regionQuestion(regions[0], regions, seeded(seed))
      asks.add(q.ask)
      expect(q.choices).toHaveLength(4)
      expect(q.choices.filter((c) => c.correct).map((c) => c.label)).toEqual([q.ask === 'capital' ? 'Roma' : 'Lazio'])
      expect(new Set(q.choices.map((c) => c.label)).size).toBe(4)
    }
    expect(asks).toEqual(new Set(['capital', 'shape']))
  })

  it('asks only the shape of a region without a capital', () => {
    for (let seed = 1; seed < 10; seed++) expect(regionQuestion(regions[4], regions, seeded(seed)).ask).toBe('shape')
  })
})

describe('deckStatus', () => {
  it('tells learned, missed and untouched cards apart', () => {
    let d = { ...createDeck(['a', 'b', 'c'], seeded(1)), queue: ['a', 'b', 'c'] }
    d = gradeCard(d, true, 'choice')
    d = gradeCard(d, false, 'choice')
    expect(deckStatus(d)).toEqual({ a: 'ok', b: 'ko', c: 'todo' })
  })
})

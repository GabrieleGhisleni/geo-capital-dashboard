import { describe, expect, it } from 'vitest'
import type { Country } from '../types'
import {
  buildPool,
  capitalLabel,
  createDeck,
  currentCard,
  gradeCard,
  isQuizEligible,
  makeQuestion,
  pickDistractors,
  POP_MIN_RATIO,
  populationOptions,
  REVIEW_LATER,
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
    area: 1000,
    areaSource: 'World Bank',
    capitals: [{ name: `Capitale ${id}`, lat: 0, lon: 0, population: null }],
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
    const d = gradeCard(fresh(), false, true)
    expect(currentCard(d)).toBe('b')
    expect(d.queue.indexOf('a')).toBe(REVIEW_SOON)
    expect(d.queue).toHaveLength(ids.length)
    expect(d.misses.a).toBe(1)
  })

  it('retires cards known at first sight in flashcard mode', () => {
    const d = gradeCard(fresh(), true, true)
    expect(d.queue).not.toContain('a')
    expect(d.mastered).toEqual(['a'])
  })

  it('needs consecutive recalls to retire a missed card', () => {
    let d = gradeCard(fresh(), false, true)
    while (currentCard(d) !== 'a') d = gradeCard(d, true, true)
    d = gradeCard(d, true, true)
    expect(d.mastered).not.toContain('a')
    expect(d.queue.indexOf('a')).toBe(Math.min(REVIEW_LATER, d.queue.length - 1))
    while (currentCard(d) !== 'a') d = gradeCard(d, true, true)
    d = gradeCard(d, true, true)
    expect(d.mastered).toContain('a')
  })

  it('empties once everything is known', () => {
    let d = fresh()
    let guard = 0
    while (currentCard(d) && guard++ < 100) d = gradeCard(d, guard % 3 !== 0, true)
    expect(currentCard(d)).toBeNull()
    expect([...d.mastered].sort()).toEqual(ids)
  })

  it('cycles endlessly in multiple-choice mode', () => {
    let d = gradeCard(fresh(), true, false)
    expect(d.queue.at(-1)).toBe('a')
    expect(d.queue).toHaveLength(ids.length)
    d = gradeCard(d, false, false)
    expect(d.queue.indexOf('b')).toBe(REVIEW_SOON)
    expect(d.mastered).toEqual([])
  })
})

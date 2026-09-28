import { formatCompact } from '../scale'
import type { Country } from '../types'

export type Rng = () => number

export type QuizMode = 'capital' | 'country' | 'population' | 'flashcard'
export type ChoiceMode = Exclude<QuizMode, 'flashcard'>

/** `short` is used on phones, where the four modes share one row. */
export const QUIZ_MODES: { id: QuizMode; label: string; short: string }[] = [
  { id: 'capital', label: 'Stato → Capitale', short: 'Capitali' },
  { id: 'country', label: 'Capitale → Stato', short: 'Stati' },
  { id: 'population', label: 'Popolazione', short: 'Abitanti' },
  { id: 'flashcard', label: 'Flashcard', short: 'Flashcard' },
]

/** Natural Earth types that are states (or are tagged as such for the mainland of a sovereign). */
const STATE_TYPES = new Set(['Sovereign country', 'Sovereignty', 'Country'])
/** Natural Earth tags these self-governing dependencies as 'Country'; they are not states. */
const DEPENDENT_TERRITORIES = new Set(['JEY', 'GGY', 'IMN', 'ABW', 'CUW', 'SXM', 'ALD', 'GRL', 'MAC', 'HKG'])
/** 'Disputed' covers both real states (Kosovo, Israel) and tiny overseas territories. */
const MIN_DISPUTED_POPULATION = 100_000

export function isQuizEligible(c: Country): boolean {
  if (c.continent === 'Antarctica' || !c.capitals.length || !c.population) return false
  if (c.type === 'Disputed') return c.population >= MIN_DISPUTED_POPULATION
  return STATE_TYPES.has(c.type) && !DEPENDENT_TERRITORIES.has(c.id)
}

/** Quiz-eligible countries in scope, sorted by name for stable output. */
export function buildPool(countries: Record<string, Country>, scopeIds: Iterable<string>): Country[] {
  const pool: Country[] = []
  for (const id of scopeIds) {
    const c = countries[id]
    if (c && isQuizEligible(c)) pool.push(c)
  }
  return pool.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

export function capitalLabel(c: Country): string {
  return c.capitals.map((cap) => cap.name).join(' / ')
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Up to `n` countries other than `answer` whose `key` is unique among the options,
 * preferring the same subregion, then the same continent, then anything in `pool`/`extra`.
 */
export function pickDistractors(
  answer: Country,
  pool: readonly Country[],
  n: number,
  rng: Rng,
  key: (c: Country) => string,
  extra: readonly Country[] = [],
): Country[] {
  const others = [...pool, ...extra].filter((c) => c.id !== answer.id)
  const tiers = [
    others.filter((c) => c.subregion === answer.subregion),
    others.filter((c) => c.subregion !== answer.subregion && c.continent === answer.continent),
    others.filter((c) => c.continent !== answer.continent),
  ]
  const used = new Set([key(answer)])
  const ids = new Set<string>()
  const picked: Country[] = []
  for (const tier of tiers) {
    for (const c of shuffle(tier, rng)) {
      if (picked.length >= n) return picked
      const k = key(c)
      if (used.has(k) || ids.has(c.id)) continue
      used.add(k)
      ids.add(c.id)
      picked.push(c)
    }
  }
  return picked
}

/** Minimum ratio between any two population options, so they never look alike. */
export const POP_MIN_RATIO = 1.4
/** Distractors within this factor of the answer are preferred: plausible, not obvious. */
const POP_PLAUSIBLE_RATIO = 12
/** Multipliers used only when the scope has too few distinct populations. */
const POP_FALLBACK_FACTORS = [0.35, 2.6, 0.15, 5.5, 0.06, 12, 25]

const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b)

function round2(v: number): number {
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1)
  return Math.max(1, Math.round(v / mag) * mag)
}

export type PopulationOption = { value: number; countryId: string | null }

/** The real population plus `n - 1` distractors, pairwise at least POP_MIN_RATIO apart, shuffled. */
export function populationOptions(target: Country, pool: readonly Country[], rng: Rng, n = 4): PopulationOption[] {
  const real = target.population!
  const options: PopulationOption[] = [{ value: real, countryId: target.id }]
  const fits = (v: number) => v >= 1 && options.every((o) => ratio(o.value, v) >= POP_MIN_RATIO)
  const others = pool.filter((c) => c.id !== target.id && c.population)
  const near = shuffle(
    others.filter((c) => ratio(c.population!, real) <= POP_PLAUSIBLE_RATIO),
    rng,
  )
  const far = others
    .filter((c) => ratio(c.population!, real) > POP_PLAUSIBLE_RATIO)
    .sort((a, b) => ratio(a.population!, real) - ratio(b.population!, real))
  for (const c of [...near, ...far]) {
    if (options.length >= n) break
    if (fits(c.population!)) options.push({ value: c.population!, countryId: c.id })
  }
  for (const f of POP_FALLBACK_FACTORS) {
    if (options.length >= n) break
    const v = round2(real * f)
    if (fits(v)) options.push({ value: v, countryId: null })
  }
  return shuffle(options, rng)
}

export type Choice = {
  key: string
  label: string
  correct: boolean
  /** Shown after answering, e.g. which country a wrong capital belongs to. */
  note: string | null
}

export type Question = { mode: ChoiceMode; countryId: string; choices: Choice[] }

export function makeQuestion(
  mode: ChoiceMode,
  target: Country,
  pool: readonly Country[],
  rng: Rng,
  extra: readonly Country[] = [],
): Question {
  if (mode === 'population') {
    const byId = new Map([...pool, ...extra].map((c) => [c.id, c]))
    const choices = populationOptions(target, pool, rng).map((o, i) => ({
      key: String(i),
      label: formatCompact(o.value),
      correct: o.countryId === target.id,
      note: o.countryId && o.countryId !== target.id ? (byId.get(o.countryId)?.name ?? null) : null,
    }))
    return { mode, countryId: target.id, choices }
  }
  const key = mode === 'capital' ? capitalLabel : (c: Country) => c.name
  const note = mode === 'capital' ? (c: Country) => c.name : capitalLabel
  const options = shuffle([target, ...pickDistractors(target, pool, 3, rng, key, extra)], rng)
  const choices = options.map((c) => ({
    key: c.id,
    label: key(c),
    correct: c.id === target.id,
    note: c.id === target.id ? null : note(c),
  }))
  return { mode, countryId: target.id, choices }
}

/* ---------------------------------------------------------------- session deck (Leitner-ish) */

/** A missed card comes back after this many other cards. */
export const REVIEW_SOON = 3
/** A card recovered once (flashcards) comes back after this many cards for confirmation. */
export const REVIEW_LATER = 8
/** Consecutive "known" answers needed to retire a card that was missed at least once. */
export const MASTERY_STREAK = 2

export type Deck = {
  queue: string[]
  misses: Record<string, number>
  streak: Record<string, number>
  mastered: string[]
  total: number
}

export function createDeck(ids: readonly string[], rng: Rng): Deck {
  return { queue: shuffle(ids, rng), misses: {}, streak: {}, mastered: [], total: ids.length }
}

export function currentCard(deck: Deck): string | null {
  return deck.queue[0] ?? null
}

function insertAt(queue: string[], id: string, offset: number): string[] {
  const out = [...queue]
  out.splice(Math.min(offset, out.length), 0, id)
  return out
}

/**
 * Grade the current card.
 * - `retire` (flashcards): a card known at first sight is retired; a missed one must be known
 *   MASTERY_STREAK times in a row, coming back after REVIEW_LATER cards in between.
 * - otherwise (multiple choice, endless): known cards go to the back of the queue.
 * Missed cards always come back after REVIEW_SOON cards.
 */
export function gradeCard(deck: Deck, known: boolean, retire: boolean): Deck {
  const [id, ...rest] = deck.queue
  if (id === undefined) return deck
  if (!known) {
    return {
      ...deck,
      queue: insertAt(rest, id, REVIEW_SOON),
      misses: { ...deck.misses, [id]: (deck.misses[id] ?? 0) + 1 },
      streak: { ...deck.streak, [id]: 0 },
    }
  }
  const streak = (deck.streak[id] ?? 0) + 1
  const next = { ...deck, streak: { ...deck.streak, [id]: streak } }
  if (!retire) return { ...next, queue: [...rest, id] }
  if (!deck.misses[id] || streak >= MASTERY_STREAK) {
    return { ...next, queue: rest, mastered: [...deck.mastered, id] }
  }
  return { ...next, queue: insertAt(rest, id, REVIEW_LATER) }
}

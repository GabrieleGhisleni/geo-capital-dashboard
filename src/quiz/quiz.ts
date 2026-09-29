import { formatCompact } from '../scale'
import type { Country, Region } from '../types'

export type Rng = () => number

export type QuizMode =
  | 'capital'
  | 'country'
  | 'locateCapital'
  | 'shape'
  | 'locate'
  | 'flag'
  | 'border'
  | 'population'
  | 'flashcard'
  | 'regions'
export type ChoiceMode = Exclude<QuizMode, 'flashcard' | 'regions'>

export type QuizModeGroup = 'Capitali' | 'Stati' | 'Numeri e ripasso' | 'Regioni'

/** Grouped in the picker; `short` is used where space is tight. */
export const QUIZ_MODES: { id: QuizMode; label: string; short: string; group: QuizModeGroup }[] = [
  { id: 'capital', label: 'Stato → Capitale', short: 'Capitali', group: 'Capitali' },
  { id: 'country', label: 'Capitale → Stato', short: 'Stati', group: 'Capitali' },
  { id: 'locateCapital', label: 'Dov’è la capitale?', short: 'Dov’è', group: 'Capitali' },
  { id: 'shape', label: 'Mappa → Stato', short: 'Mappa', group: 'Stati' },
  { id: 'locate', label: 'Dov’è lo Stato?', short: 'Dov’è', group: 'Stati' },
  { id: 'flag', label: 'Bandiera → Stato', short: 'Bandiere', group: 'Stati' },
  { id: 'border', label: 'Confini', short: 'Confini', group: 'Stati' },
  { id: 'population', label: 'Popolazione', short: 'Abitanti', group: 'Numeri e ripasso' },
  { id: 'flashcard', label: 'Flashcard', short: 'Flashcard', group: 'Numeri e ripasso' },
  { id: 'regions', label: 'Regioni e capoluoghi', short: 'Regioni', group: 'Regioni' },
]

/** Modes whose question must not show the country (name, shape, flag or position would give the answer away). */
export const HIDES_COUNTRY = new Set<QuizMode>(['country', 'flag', 'locate', 'locateCapital'])

/** Modes answered by clicking the map instead of picking an option. */
export const MAP_PICK_MODES = new Set<QuizMode>(['locate', 'locateCapital'])

/** "Where is the capital?": a click within this distance counts as right (a few pixels at continent zoom). */
export const LOCATE_CAPITAL_KM = 150

/** Below this area a country framed at the camera's maximum zoom is a few pixels (Vatican, Monaco, Nauru). */
export const SHAPE_MIN_AREA_KM2 = 100

/** Land neighbours per country id. */
export type Neighbors = Record<string, readonly string[]>

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

/**
 * The cards a mode can ask: flags need an ISO code (flag file), shapes a country large enough to see, borders a
 * quiz-eligible land neighbour
 * anywhere in the world (Spain → Portugal even when the view is only part of Europe).
 */
export function modePool(mode: QuizMode, pool: readonly Country[], world: readonly Country[], neighbors: Neighbors): Country[] {
  if (mode === 'flag') return pool.filter((c) => c.iso2)
  if (mode === 'shape' || mode === 'locate') return pool.filter((c) => (c.area ?? 0) >= SHAPE_MIN_AREA_KM2)
  if (mode !== 'border') return [...pool]
  const eligible = new Set(world.map((c) => c.id))
  return pool.filter((c) => (neighbors[c.id] ?? []).some((id) => eligible.has(id)))
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

/**
 * "Which of these borders X?": one neighbour of X (same continent when possible, so France gets Spain rather
 * than Brazil via French Guiana) and three countries that do not border it, nearest tiers first.
 */
export function borderQuestion(
  target: Country,
  pool: readonly Country[],
  rng: Rng,
  extra: readonly Country[],
  neighbors: Neighbors,
): Question {
  const byId = new Map([...pool, ...extra].map((c) => [c.id, c]))
  const near = new Set(neighbors[target.id] ?? [])
  const candidates = [...near].flatMap((id) => byId.get(id) ?? [])
  const sameContinent = candidates.filter((c) => c.continent === target.continent)
  const answer = shuffle(sameContinent.length ? sameContinent : candidates, rng)[0]
  const others = [...byId.values()].filter((c) => !near.has(c.id) && c.id !== target.id)
  const options = shuffle([answer, ...pickDistractors(target, others, 3, rng, (c) => c.name)], rng)
  const choices = options.map((c) => ({
    key: c.id,
    label: c.name,
    correct: c.id === answer.id,
    note: c.id === answer.id ? null : 'non confina',
  }))
  return { mode: 'border', countryId: target.id, choices }
}

export function makeQuestion(
  mode: ChoiceMode,
  target: Country,
  pool: readonly Country[],
  rng: Rng,
  extra: readonly Country[] = [],
  neighbors: Neighbors = {},
): Question {
  if (MAP_PICK_MODES.has(mode)) return { mode, countryId: target.id, choices: [] }
  if (mode === 'border') return borderQuestion(target, pool, rng, extra, neighbors)
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
  const note = mode === 'capital' ? (c: Country) => c.name : mode === 'country' ? capitalLabel : () => null
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

/** A missed flashcard comes back after this many other cards. */
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

export type DeckKind = 'flashcard' | 'choice'

/**
 * Grade the current card.
 * - flashcards: a card known at first sight is retired; a missed one comes back after REVIEW_SOON
 *   cards and must then be known MASTERY_STREAK times in a row, REVIEW_LATER cards apart.
 * - multiple choice: every card is asked once per round. A right answer retires it; a wrong one
 *   sends it to the back of the queue, so it is asked again only after all the others.
 */
export function gradeCard(deck: Deck, known: boolean, kind: DeckKind): Deck {
  const [id, ...rest] = deck.queue
  if (id === undefined) return deck
  if (!known) {
    return {
      ...deck,
      queue: kind === 'choice' ? [...rest, id] : insertAt(rest, id, REVIEW_SOON),
      misses: { ...deck.misses, [id]: (deck.misses[id] ?? 0) + 1 },
      streak: { ...deck.streak, [id]: 0 },
    }
  }
  const streak = (deck.streak[id] ?? 0) + 1
  const next = { ...deck, streak: { ...deck.streak, [id]: streak } }
  if (kind === 'choice' || !deck.misses[id] || streak >= MASTERY_STREAK) {
    return { ...next, queue: rest, mastered: [...deck.mastered, id] }
  }
  return { ...next, queue: insertAt(rest, id, REVIEW_LATER) }
}

/** A saved deck, if it still fits the pool: same cards, none lost or duplicated. */
export function restoreDeck(saved: unknown, ids: readonly string[]): Deck | null {
  if (!saved || typeof saved !== 'object') return null
  const d = saved as Partial<Deck>
  if (!Array.isArray(d.queue) || !Array.isArray(d.mastered) || !d.misses || !d.streak) return null
  const cards = [...d.queue, ...d.mastered]
  const pool = new Set(ids)
  if (cards.length !== pool.size || new Set(cards).size !== cards.length || !cards.every((id) => pool.has(id))) return null
  return { queue: d.queue, mastered: d.mastered, misses: d.misses, streak: d.streak, total: pool.size }
}

/* ---------------------------------------------------------------- map answers ("where is…?") */

/** Great-circle distance in km. */
export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** The point an answer is measured to and drawn at: the capital, or the country's label point. */
export function answerPoint(mode: QuizMode, target: Country): [number, number] {
  const cap = target.capitals[0]
  if (mode === 'locateCapital' && cap) return [cap.lon, cap.lat]
  return target.label ?? (cap ? [cap.lon, cap.lat] : [0, 0])
}

export type MapAnswer = { correct: boolean; km: number; pickedCountryId: string | null; lngLat: [number, number] }

/**
 * Grade a click: "where is the state?" is right when the click lands on it; "where is the capital?" when it is
 * within LOCATE_CAPITAL_KM of it. The distance is to the capital or, for states, the country's label point.
 */
export function gradeMapAnswer(
  mode: QuizMode,
  target: Country,
  lngLat: [number, number],
  pickedCountryId: string | null,
): MapAnswer {
  const km = distanceKm(lngLat, answerPoint(mode, target))
  const correct = mode === 'locateCapital' ? km <= LOCATE_CAPITAL_KM : pickedCountryId === target.id
  return { correct, km, pickedCountryId, lngLat }
}

/* ---------------------------------------------------------------- regions */

export type RegionAsk = 'capital' | 'shape'

export type RegionQuestion = { regionId: string; ask: RegionAsk; choices: Choice[] }

/**
 * A question on one region: its capital ("capoluogo") when it has one and the coin says so, otherwise which
 * region is outlined on the map. Three distractors with distinct labels from the same country.
 */
export function regionQuestion(target: Region, regions: readonly Region[], rng: Rng): RegionQuestion {
  const ask: RegionAsk = target.capName && rng() < 0.5 ? 'capital' : 'shape'
  const key = ask === 'capital' ? (r: Region) => r.capName ?? '' : (r: Region) => r.name
  const used = new Set([key(target)])
  const distractors: Region[] = []
  for (const r of shuffle(
    regions.filter((r) => r.id !== target.id && key(r)),
    rng,
  )) {
    if (distractors.length >= 3) break
    if (used.has(key(r))) continue
    used.add(key(r))
    distractors.push(r)
  }
  const choices = shuffle([target, ...distractors], rng).map((r) => ({
    key: r.id,
    label: key(r),
    correct: r.id === target.id,
    note: r.id === target.id ? null : ask === 'capital' ? r.name : (r.capName ?? null),
  }))
  return { regionId: target.id, ask, choices }
}

/* ---------------------------------------------------------------- progress map */

export type CardStatus = 'ok' | 'ko' | 'todo'

/** Per card: learned (right, or recovered), missed and not yet recovered, or still to do. */
export function deckStatus(deck: Deck): Record<string, CardStatus> {
  const out: Record<string, CardStatus> = {}
  for (const id of deck.queue) out[id] = deck.misses[id] ? 'ko' : 'todo'
  for (const id of deck.mastered) out[id] = 'ok'
  return out
}

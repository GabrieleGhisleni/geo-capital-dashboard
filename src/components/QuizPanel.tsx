import type { FeatureCollection, Geometry } from 'geojson'
import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { loadRegions, type Dataset } from '../data'
import {
  answerPoint,
  buildPool,
  capitalLabel,
  createDeck,
  currentCard,
  deckStatus,
  gradeCard,
  gradeMapAnswer,
  HIDES_COUNTRY,
  makeQuestion,
  MAP_PICK_MODES,
  modePool,
  QUIZ_MODES,
  regionQuestion,
  restoreDeck,
  type CardStatus,
  type Choice,
  type Deck,
  type MapAnswer,
  type Neighbors,
  type Question,
  type QuizMode,
  type RegionQuestion,
} from '../quiz/quiz'
import { formatCompact, formatMetric, formatNumber, formatShare, metricValue } from '../scale'
import type { Country, Region } from '../types'
import { SUBREGION_LABEL } from '../views'
import { Flag } from './SidePanel'
import './QuizPanel.css'

/** What the quiz asks of the map (App passes it to MapView while studying). */
export type QuizMapState = {
  /** "Where is…?" questions: clicks go to the quiz. */
  pickMode: boolean
  /** Answer marks: the click and the right place. */
  marks: { pick: [number, number]; answer: [number, number] } | null
  /** Region outlined by the regions quiz. */
  regionId: string | null
  /** Progress colors per country, when shown. */
  progress: Record<string, CardStatus> | null
}

/** A map click while studying; `seq` tells a new click from a re-render. */
export type MapPick = { lngLat: [number, number]; countryId: string | null; seq: number }

export type QuizPanelProps = {
  data: Dataset
  scopeIds: Set<string>
  scopeLabel: string
  /** reveal=false: keep the answer hidden on the map (id is null while the country itself is the answer). */
  onFocus: (countryId: string | null, reveal: boolean) => void
  onExit: () => void
  onMap: (state: QuizMapState) => void
  mapPick: MapPick | null
}

const IDLE_MAP: QuizMapState = { pickMode: false, marks: null, regionId: null, progress: null }

const STORAGE_PREFIX = 'geo-capital-quiz'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}:${key}`)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:${key}`, value)
  } catch {
    // Storage may be unavailable (private mode, blocked site data): the quiz still works.
  }
}

/** Removes saved sessions and records: one key, or every key starting with one of the prefixes. */
function clearStorage(match: (key: string) => boolean) {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(`${STORAGE_PREFIX}:`) && match(k.slice(STORAGE_PREFIX.length + 1))) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // Nothing saved to clear.
  }
}

const isMode = (v: string | null): v is QuizMode => QUIZ_MODES.some((m) => m.id === v)

/** Everything a session needs beyond its own pool: distractors come from the world, facts from the dataset. */
type QuizContext = {
  world: Country[]
  neighbors: Neighbors
  countries: Dataset['countries']
  citiesByCountry: Dataset['citiesByCountry']
}

export function QuizPanel({ data, scopeIds, scopeLabel, onFocus, onExit, onMap, mapPick }: QuizPanelProps) {
  const [mode, setMode] = useState<QuizMode>(() => {
    const saved = readStorage('mode')
    return isMode(saved) ? saved : 'capital'
  })
  const [showProgress, setShowProgress] = useState(() => readStorage('show-progress') === '1')
  /** Bumped to remount the session after a restart or a reset (it then reloads what is saved, if anything). */
  const [epoch, setEpoch] = useState(0)
  const world = useMemo(() => buildPool(data.countries, Object.keys(data.countries)), [data])
  const ctx = useMemo<QuizContext>(
    () => ({ world, neighbors: data.neighbors, countries: data.countries, citiesByCountry: data.citiesByCountry }),
    [world, data],
  )
  const pool = useMemo(
    () => (mode === 'regions' ? [] : modePool(mode, buildPool(data.countries, scopeIds), world, data.neighbors)),
    [mode, data, scopeIds, world],
  )
  const focus = useEffectEvent(onFocus)
  const map = useEffectEvent(onMap)

  useEffect(
    () => () => {
      focus(null, false)
      map(IDLE_MAP)
    },
    [],
  )

  const selectMode = (m: QuizMode) => {
    setMode(m)
    writeStorage('mode', m)
    onMap(IDLE_MAP)
  }

  const toggleProgress = (on: boolean) => {
    setShowProgress(on)
    writeStorage('show-progress', on ? '1' : '0')
  }

  const exit = () => {
    onFocus(null, false)
    onExit()
  }

  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const id = window.setTimeout(() => setConfirmReset(false), 4000)
    return () => window.clearTimeout(id)
  }, [confirmReset])

  // "Ricomincia": this mode and view start over. "Azzera tutto": every saved session and record is forgotten.
  const restartCurrent = () => {
    clearStorage((k) => k === currentKey)
    setEpoch((e) => e + 1)
  }
  const resetAll = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    clearStorage((k) => k.startsWith('session:') || k.startsWith('best:'))
    setConfirmReset(false)
    setEpoch((e) => e + 1)
  }
  const [regionCountry, setRegionCountry] = useState<string | null>(null)
  const currentKey = mode === 'regions' ? `session:regions:${regionCountry}` : poolKey(mode, pool)

  return (
    <div className="quiz">
      <header className="quiz-header">
        <div className="quiz-heading">
          <p className="quiz-eyebrow">Modalità studio</p>
          <h2 className="quiz-title">Studia · {scopeLabel}</h2>
        </div>
        <button type="button" className="quiz-exit" onClick={exit}>
          ✕ Esci
        </button>
      </header>

      <ModePicker mode={mode} onMode={selectMode} />

      <div className="quiz-tools">
        {mode !== 'regions' && (
          <label className="quiz-switch">
            <input type="checkbox" checked={showProgress} onChange={(e) => toggleProgress(e.target.checked)} />
            Progressi sulla mappa
          </label>
        )}
        <span className="quiz-tools-actions">
          <button type="button" onClick={restartCurrent} title="Ricomincia questo esercizio da capo">
            ↺ Ricomincia
          </button>
          <button
            type="button"
            className={confirmReset ? 'is-danger' : undefined}
            onClick={resetAll}
            title="Cancella i progressi e i record di tutti gli esercizi"
          >
            {confirmReset ? 'Confermi? Tocca di nuovo' : 'Azzera tutto'}
          </button>
        </span>
      </div>
      {showProgress && mode !== 'regions' && (
        <p className="quiz-legend" aria-hidden>
          <span className="swatch swatch-ok" /> indovinati <span className="swatch swatch-ko" /> sbagliati{' '}
          <span className="swatch swatch-todo" /> da fare
        </p>
      )}

      {mode === 'regions' ? (
        <RegionQuiz
          key={epoch}
          data={data}
          scopeIds={scopeIds}
          country={regionCountry}
          onCountry={setRegionCountry}
          onFocus={onFocus}
          onMap={onMap}
        />
      ) : pool.length < 2 ? (
        <p className="quiz-empty">Non ci sono abbastanza Stati in questa vista per un quiz.</p>
      ) : (
        <QuizSession
          // A new mode, scope or reset starts a fresh session.
          key={`${mode}|${pool.map((c) => c.id).join()}|${epoch}`}
          mode={mode}
          pool={pool}
          ctx={ctx}
          onFocus={onFocus}
          onMap={onMap}
          mapPick={mapPick}
          showProgress={showProgress}
        />
      )}
    </div>
  )
}

/** Grouped buttons on wide screens, a compact select on phones. */
function ModePicker({ mode, onMode }: { mode: QuizMode; onMode: (m: QuizMode) => void }) {
  const groups = [...new Set(QUIZ_MODES.map((m) => m.group))]
  return (
    <>
      <div className="quiz-modes" role="group" aria-label="Tipo di esercizio">
        {QUIZ_MODES.map((m, i) => (
          <Fragment key={m.id}>
            {m.group !== QUIZ_MODES[i - 1]?.group && (
              <span className="quiz-mode-group" aria-hidden>
                {m.group}
              </span>
            )}
            <button
              type="button"
              className={m.id === mode ? 'is-active' : undefined}
              aria-pressed={m.id === mode}
              onClick={() => onMode(m.id)}
            >
              {m.label}
            </button>
          </Fragment>
        ))}
      </div>
      <select
        className="quiz-mode-select"
        value={mode}
        aria-label="Tipo di esercizio"
        onChange={(e) => onMode(e.target.value as QuizMode)}
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {QUIZ_MODES.filter((m) => m.group === g).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </>
  )
}

type SessionState = {
  deck: Deck
  question: Question | null
  /** Picked choice key (multiple choice), or 'map' for a map answer — non-null once answered. */
  picked: string | null
  /** Map answer ("where is…?"). */
  mapAnswer: MapAnswer | null
  /** Flashcard answer shown. */
  revealed: boolean
  /** Bumped on every new card so the enter animation replays. */
  round: number
  answered: number
  correct: number
  streak: number
}

function startSession(mode: QuizMode, pool: Country[], ctx: QuizContext, deck?: Deck | null): SessionState {
  deck ??= createDeck(
    pool.map((c) => c.id),
    Math.random,
  )
  return {
    deck,
    question: nextQuestion(mode, deck, pool, ctx),
    picked: null,
    mapAnswer: null,
    revealed: false,
    round: 0,
    answered: 0,
    correct: 0,
    streak: 0,
  }
}

/** Short stable id of a pool, so each view and mode keeps its own saved session. */
function poolKey(mode: QuizMode, pool: { id: string }[]): string {
  let h = 5381
  for (const ch of pool.map((c) => c.id).join()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return `session:${mode}:${h.toString(36)}`
}

type SavedSession = { deck: Deck; answered: number; correct: number; streak: number }

/** The saved deck and score for a key, if they still fit the cards. */
function readSaved(key: string, ids: string[]): (Omit<SavedSession, 'deck'> & { deck: Deck }) | null {
  let saved: Partial<SavedSession> | null = null
  try {
    saved = JSON.parse(readStorage(key) ?? 'null')
  } catch {
    saved = null
  }
  const deck = restoreDeck(saved?.deck, ids)
  if (!deck?.queue.length || !saved) return null
  const count = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0)
  return { deck, answered: count(saved.answered), correct: count(saved.correct), streak: count(saved.streak) }
}

/** Resume where the last visit to this view and mode stopped, so answered cards are not asked again. */
function resumeSession(mode: QuizMode, pool: Country[], ctx: QuizContext): SessionState {
  const saved = readSaved(
    poolKey(mode, pool),
    pool.map((c) => c.id),
  )
  const state = startSession(mode, pool, ctx, saved?.deck)
  return saved ? { ...state, answered: saved.answered, correct: saved.correct, streak: saved.streak } : state
}

function nextQuestion(mode: QuizMode, deck: Deck, pool: Country[], ctx: QuizContext): Question | null {
  const id = currentCard(deck)
  const target = pool.find((c) => c.id === id)
  if (mode === 'flashcard' || mode === 'regions' || !target) return null
  return makeQuestion(mode, target, pool, Math.random, ctx.world, ctx.neighbors)
}

const PROMPT: Record<QuizMode, string> = {
  capital: 'Qual è la capitale di…',
  country: 'Di quale Stato è la capitale…',
  locateCapital: 'Dov’è la capitale…',
  shape: 'Quale Stato è…',
  locate: 'Dov’è…',
  flag: 'Di quale Stato è questa bandiera?',
  border: 'Quale di questi Stati confina con…',
  population: 'Quanti abitanti ha…',
  flashcard: 'Capitale, popolazione e superficie di…',
  regions: '',
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Enter/Space pressed on another focused control (mode buttons, exit, map UI) must activate that control. */
function isForeignConfirm(e: KeyboardEvent, stage: HTMLElement | null): boolean {
  const confirm = e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
  return confirm && e.target instanceof HTMLElement && e.target !== document.body && !stage?.contains(e.target)
}

function formatKm(km: number): string {
  return `${formatNumber(Math.round(km / (km < 100 ? 1 : 10)) * (km < 100 ? 1 : 10))} km`
}

type SessionProps = {
  mode: QuizMode
  pool: Country[]
  ctx: QuizContext
  onFocus: (countryId: string | null, reveal: boolean) => void
  onMap: (state: QuizMapState) => void
  mapPick: MapPick | null
  showProgress: boolean
}

function QuizSession({ mode, pool, ctx, onFocus, onMap, mapPick, showProgress }: SessionProps) {
  const [state, setState] = useState(() => resumeSession(mode, pool, ctx))
  const [best, setBest] = useState(() => Number(readStorage(`best:${mode}`)) || 0)
  const stageRef = useRef<HTMLDivElement>(null)

  const flashcard = mode === 'flashcard'
  const mapMode = MAP_PICK_MODES.has(mode)

  // Save progress after every graded card; an interrupted question is simply asked again on return.
  const storageKey = poolKey(mode, pool)
  useEffect(() => {
    const { deck, answered, correct, streak } = state
    writeStorage(storageKey, JSON.stringify({ deck, answered, correct, streak } satisfies SavedSession))
  }, [storageKey, state])
  const currentId = currentCard(state.deck)
  const country = currentId ? (pool.find((c) => c.id === currentId) ?? null) : null
  const isAnswered = flashcard ? state.revealed : state.picked !== null
  const pickedChoice = state.question?.choices.find((c) => c.key === state.picked) ?? null
  const answerCorrect = state.mapAnswer?.correct ?? pickedChoice?.correct ?? false

  // Map: show the country while asking (answer hidden), reveal it once answered.
  // Modes whose answer is the country itself keep it off the map until answered.
  const focus = useEffectEvent(onFocus)
  useEffect(() => {
    if (!currentId) focus(null, false)
    else if (HIDES_COUNTRY.has(mode) && !isAnswered) focus(null, false)
    else focus(currentId, isAnswered)
  }, [currentId, isAnswered, mode, state.round])

  // Map extras: clicks for "where is…?", the answer marks, progress colors.
  const map = useEffectEvent(onMap)
  const progress = useMemo(() => (showProgress ? deckStatus(state.deck) : null), [showProgress, state.deck])
  useEffect(() => {
    const answer = state.mapAnswer
    map({
      pickMode: mapMode && !isAnswered && country != null,
      marks: answer && country ? { pick: answer.lngLat, answer: answerPoint(mode, country) } : null,
      regionId: null,
      progress,
    })
  }, [mapMode, isAnswered, country, state.mapAnswer, progress, mode])

  const score = (known: boolean) => {
    const streak = known ? state.streak + 1 : 0
    if (streak > best) {
      setBest(streak)
      writeStorage(`best:${mode}`, String(streak))
    }
    return { answered: state.answered + 1, correct: state.correct + (known ? 1 : 0), streak }
  }

  // A map click answers a "where is…?" question (clicks from before this session are ignored).
  const firstPick = useRef(mapPick?.seq ?? 0)
  const onPick = useEffectEvent((pick: MapPick) => {
    if (!mapMode || !country || isAnswered || pick.seq <= firstPick.current) return
    const answer = gradeMapAnswer(mode, country, pick.lngLat, pick.countryId)
    setState((s) => ({ ...s, ...score(answer.correct), picked: 'map', mapAnswer: answer }))
  })
  useEffect(() => {
    if (mapPick) onPick(mapPick)
  }, [mapPick])

  // Keep the new question in view and take focus from the removed buttons.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const active = document.activeElement
    if (!active || active === document.body || stage.closest('.quiz')?.contains(active)) {
      stage.focus({ preventScroll: true })
    }
    stage.scrollIntoView({ block: 'nearest' })
  }, [state.round])

  // Once answered, bring the next action into view (it sits below the fold in the phone bottom sheet).
  const actionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isAnswered) actionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [isAnswered])

  const pick = (choice: Choice) => {
    if (state.picked !== null) return
    setState({ ...state, ...score(choice.correct), picked: choice.key })
  }

  const advance = () => {
    if (state.picked === null) return
    const deck = gradeCard(state.deck, answerCorrect, 'choice')
    setState({
      ...state,
      deck,
      question: nextQuestion(mode, deck, pool, ctx),
      picked: null,
      mapAnswer: null,
      round: state.round + 1,
    })
  }

  const reveal = () => setState({ ...state, revealed: true })

  const grade = (known: boolean) => {
    if (!state.revealed) return
    const deck = gradeCard(state.deck, known, 'flashcard')
    setState({ ...state, ...score(known), deck, revealed: false, round: state.round + 1 })
  }

  const restart = () => setState((s) => ({ ...startSession(mode, pool, ctx), round: s.round + 1 }))

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
    if (isForeignConfirm(e, stageRef.current)) return
    const confirm = e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0
    let handled = true
    if (!country) {
      if (confirm) restart()
      else handled = false
    } else if (flashcard) {
      if (!state.revealed && confirm) reveal()
      else if (state.revealed && (digit === 1 || digit === 2)) grade(digit === 1)
      else handled = false
    } else if (state.picked === null) {
      const choice = digit ? state.question?.choices[digit - 1] : undefined
      if (choice) pick(choice)
      else handled = false
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      advance()
    } else handled = false
    if (handled) e.preventDefault()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const mastered = state.deck.mastered.length

  return (
    <>
      <ScoreBar
        correct={state.correct}
        answered={state.answered}
        streak={state.streak}
        best={best}
        done={mastered}
        total={state.deck.total}
        doneLabel={flashcard ? 'Imparate' : 'Indovinati'}
        scoreLabel={flashcard ? 'Sapute' : 'Punti'}
      />

      <div className="quiz-stage" ref={stageRef} tabIndex={-1} key={state.round}>
        {!country ? (
          <DeckComplete
            title={flashcard ? 'Mazzo completato' : 'Giro completato'}
            text={`${state.deck.total} ${flashcard ? 'carte imparate' : 'Stati indovinati'} in ${state.answered} risposte.`}
            onRestart={restart}
          />
        ) : (
          <>
            <div className="quiz-question">
              <p className="quiz-prompt">{PROMPT[mode]}</p>
              <Subject mode={mode} country={country} />
              <p className="quiz-context">
                {mapMode && !isAnswered
                  ? mode === 'locate'
                    ? 'Tocca lo Stato sulla mappa'
                    : 'Tocca il punto sulla mappa'
                  : (SUBREGION_LABEL[country.subregion] ?? country.subregion)}
              </p>
            </div>

            {state.question && state.question.choices.length > 0 && (
              <Options
                choices={state.question.choices}
                picked={state.picked}
                onPick={pick}
                flagOf={mode === 'flag' || mode === 'border' ? (key) => ctx.countries[key] : undefined}
              />
            )}

            {flashcard && !state.revealed && (
              <button type="button" className="quiz-primary" onClick={reveal}>
                Mostra risposta <kbd className="quiz-key">Spazio</kbd>
              </button>
            )}

            <div className="quiz-live" aria-live="polite">
              {isAnswered && (
                <div className="quiz-feedback">
                  {state.mapAnswer ? (
                    <MapVerdict mode={mode} country={country} answer={state.mapAnswer} countries={ctx.countries} />
                  ) : (
                    pickedChoice && (
                      <p className={`quiz-verdict ${pickedChoice.correct ? 'is-correct' : 'is-wrong'}`}>
                        <span aria-hidden>{pickedChoice.correct ? '✓' : '✗'}</span>{' '}
                        {pickedChoice.correct
                          ? 'Esatto!'
                          : `Sbagliato · era ${state.question?.choices.find((c) => c.correct)?.label}`}
                      </p>
                    )
                  )}
                  <Facts country={country} ctx={ctx} />
                  <div ref={actionRef} className="quiz-action">
                    {flashcard ? (
                      <div className="quiz-grade">
                        <button type="button" className="quiz-grade-known" onClick={() => grade(true)}>
                          <span aria-hidden>✓</span> Lo sapevo <kbd className="quiz-key">1</kbd>
                        </button>
                        <button type="button" className="quiz-grade-review" onClick={() => grade(false)}>
                          <span aria-hidden>↺</span> Da ripassare <kbd className="quiz-key">2</kbd>
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="quiz-primary" onClick={advance}>
                        Avanti <kbd className="quiz-key">↵</kbd>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <p className="quiz-hint">
        {flashcard
          ? 'Spazio mostra la risposta · 1 lo sapevo · 2 da ripassare'
          : mapMode
            ? 'Rispondi toccando la mappa · Invio o → per andare avanti'
            : '1–4 per rispondere · Invio o → per andare avanti'}
      </p>
    </>
  )
}

function Subject({ mode, country }: { mode: QuizMode; country: Country }) {
  if (mode === 'shape')
    return (
      <h3 className="quiz-subject quiz-subject-hint">
        <span aria-hidden>◎</span> lo Stato evidenziato sulla mappa
      </h3>
    )
  if (mode === 'flag')
    return (
      <h3 className="quiz-subject">
        <Flag country={country} className="flag quiz-flag-question" />
        <span className="visually-hidden">Bandiera da riconoscere</span>
      </h3>
    )
  const text = mode === 'country' || mode === 'locateCapital' ? capitalLabel(country) : country.name
  return (
    <h3 className="quiz-subject">
      {!HIDES_COUNTRY.has(mode) && <Flag country={country} className="flag quiz-flag-subject" />}
      {text}
    </h3>
  )
}

function MapVerdict({
  mode,
  country,
  answer,
  countries,
}: {
  mode: QuizMode
  country: Country
  answer: MapAnswer
  countries: Dataset['countries']
}) {
  const km = formatKm(answer.km)
  let text: string
  if (mode === 'locateCapital') {
    text = answer.correct ? `Esatto! · a ${km} da ${capitalLabel(country)}` : `Sbagliato · ${capitalLabel(country)} era a ${km}`
  } else if (answer.correct) {
    text = 'Esatto!'
  } else {
    const picked = answer.pickedCountryId ? countries[answer.pickedCountryId]?.name : null
    text = `Sbagliato · ${picked ? `hai toccato ${picked}` : 'hai toccato il mare'}, ${country.name} è a ${km}`
  }
  return (
    <p className={`quiz-verdict ${answer.correct ? 'is-correct' : 'is-wrong'}`}>
      <span aria-hidden>{answer.correct ? '✓' : '✗'}</span> {text}
    </p>
  )
}

function ScoreBar(p: {
  correct: number
  answered: number
  streak: number
  best: number
  done: number
  total: number
  doneLabel: string
  scoreLabel: string
}) {
  return (
    <div className="quiz-score" aria-label="Punteggio">
      <div className="quiz-score-items">
        <span>
          <span className="quiz-score-label">{p.scoreLabel}</span>{' '}
          <strong>
            {p.correct}/{p.answered}
          </strong>
        </span>
        <span>
          <span className="quiz-score-label">Serie</span> <strong>{p.streak}</strong>
        </span>
        <span>
          <span className="quiz-score-label">Record</span> <strong>{p.best}</strong>
        </span>
      </div>
      <div className="quiz-progress">
        <div className="quiz-bar" aria-hidden>
          <span style={{ width: `${Math.round((p.done / Math.max(1, p.total)) * 100)}%` }} />
        </div>
        <span className="quiz-progress-label">
          {p.doneLabel} {p.done}/{p.total}
        </span>
      </div>
    </div>
  )
}

function Options({
  choices,
  picked,
  onPick,
  flagOf,
}: {
  choices: Choice[]
  picked: string | null
  onPick: (choice: Choice) => void
  /** Once answered, options naming a state show its flag. */
  flagOf?: (key: string) => Country | undefined
}) {
  const answered = picked !== null
  return (
    <ol className="quiz-options">
      {choices.map((choice, i) => {
        const isPicked = choice.key === picked
        const state = !answered ? '' : choice.correct ? 'is-correct' : isPicked ? 'is-wrong' : 'is-dim'
        const flagCountry = answered ? flagOf?.(choice.key) : undefined
        return (
          <li key={choice.key}>
            <button
              type="button"
              className={`quiz-option ${state}`}
              aria-disabled={answered}
              onClick={() => onPick(choice)}
            >
              <kbd className="quiz-key">{i + 1}</kbd>
              <span className="quiz-option-label">
                {flagCountry && <Flag country={flagCountry} className="flag quiz-flag-option" />}
                {choice.label}
                {answered && choice.note && <span className="quiz-option-note">{choice.note}</span>}
              </span>
              {answered && (choice.correct || isPicked) && (
                <span className="quiz-option-mark">
                  {choice.correct ? (isPicked ? '✓ Giusta' : '✓ Corretta') : '✗ Tua risposta'}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function Facts({ country, ctx }: { country: Country; ctx: QuizContext }) {
  const { population } = country
  const cities = ctx.citiesByCountry[country.id] ?? []
  const neighbors = (ctx.neighbors[country.id] ?? []).flatMap((id) => ctx.countries[id] ?? [])
  return (
    <>
      <dl className="quiz-facts">
        <div className="quiz-fact-wide">
          <dt>Confina con</dt>
          <dd className="quiz-neighbors">
            {neighbors.length
              ? neighbors.map((n) => (
                  <span key={n.id}>
                    <Flag country={n} className="flag quiz-flag-option" />
                    {n.name}
                  </span>
                ))
              : 'nessun confine terrestre'}
          </dd>
        </div>
        <div className="quiz-fact-wide">
          <dt>Capitale</dt>
          <dd>
            {capitalLabel(country)}
            {country.capitals.map(
              (cap) =>
                cap.population != null && (
                  <span key={cap.name} className="quiz-fact-note" title={`${formatNumber(cap.population)} abitanti`}>
                    {country.capitals.length > 1 ? `${cap.name}: ` : ''}
                    {formatCompact(cap.population)} ab. · {formatShare(cap.population, country.population)} dello Stato
                  </span>
                ),
            )}
          </dd>
        </div>
        <div title={`${formatNumber(country.population)} abitanti`}>
          <dt>Popolazione</dt>
          <dd>
            {formatCompact(country.population)}
            {country.populationYear && <span className="quiz-fact-note">{country.populationYear}</span>}
          </dd>
        </div>
        <div title={`${formatNumber(country.area)} km²`}>
          <dt>Superficie</dt>
          <dd>
            {formatCompact(country.area)}
            {country.area != null && <span className="quiz-fact-note">km²</span>}
          </dd>
        </div>
        <div>
          <dt>Densità</dt>
          <dd>
            {formatNumber(metricValue(country, 'density'))}
            <span className="quiz-fact-note">ab./km²</span>
          </dd>
        </div>
        <div>
          <dt>PIL pro capite</dt>
          <dd>
            {formatMetric(country.gdpPerCapita, 'gdpPerCapita')}
            {country.gdpPerCapitaYear && <span className="quiz-fact-note">{country.gdpPerCapitaYear}</span>}
          </dd>
        </div>
        <div>
          <dt>Aspettativa di vita</dt>
          <dd>
            {formatMetric(country.lifeExpectancy, 'lifeExpectancy')}
            {country.lifeExpectancyYear && <span className="quiz-fact-note">{country.lifeExpectancyYear}</span>}
          </dd>
        </div>
        <div>
          <dt>PIL</dt>
          <dd>
            {formatMetric(country.gdp, 'gdp')}
            {country.gdpYear && <span className="quiz-fact-note">{country.gdpYear}</span>}
          </dd>
        </div>
      </dl>
      {cities.length > 0 && (
        <div className="quiz-cities">
          <span className="quiz-cities-label">Città principali</span>
          <ul>
            {cities.slice(0, 6).map((c) => (
              <li key={`${c.name}-${c.lat}`} title={`${formatShare(c.population, population)} della popolazione`}>
                {c.name} <span>{formatCompact(c.population)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function DeckComplete({ title, text, onRestart }: { title: string; text: string; onRestart: () => void }) {
  return (
    <div className="quiz-complete">
      <p className="quiz-complete-icon" aria-hidden>
        ★
      </p>
      <h3 className="quiz-subject">{title}</h3>
      <p className="quiz-context">{text}</p>
      <button type="button" className="quiz-primary" onClick={onRestart}>
        Ricomincia <kbd className="quiz-key">↵</kbd>
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- regions quiz */

/** Regions quizzes need a few regions to make four distinct options. */
const MIN_REGIONS = 4

type RegionQuizProps = {
  data: Dataset
  scopeIds: Set<string>
  /** Country quizzed; null until the default is chosen. Kept by the panel across resets. */
  country: string | null
  onCountry: (id: string) => void
  onFocus: (countryId: string | null, reveal: boolean) => void
  onMap: (state: QuizMapState) => void
}

/** The country picker and, once its regions are loaded, the session. */
function RegionQuiz({ data, scopeIds, country, onCountry, onFocus, onMap }: RegionQuizProps) {
  const options = useMemo(
    () =>
      [...scopeIds]
        .map((id) => data.countries[id])
        .filter((c): c is Country => Boolean(c && c.admin1Count >= MIN_REGIONS))
        .sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [data, scopeIds],
  )
  // Default: the last country studied, else Italy, else the most populous in the view.
  const fallback = useMemo(() => {
    const saved = readStorage('regions-country')
    const byPop = [...options].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    return options.find((c) => c.id === saved) ?? options.find((c) => c.id === 'ITA') ?? byPop[0] ?? null
  }, [options])
  const chosen = options.find((c) => c.id === country) ?? fallback
  // The panel keeps the choice (its "Ricomincia" clears this country's session).
  useEffect(() => {
    if (chosen && chosen.id !== country) onCountry(chosen.id)
  }, [chosen, country, onCountry])
  const [loaded, setLoaded] = useState<{ id: string; regions: Region[] | null } | null>(null)

  useEffect(() => {
    if (!chosen) return
    let cancelled = false
    loadRegions(chosen.id).then(
      (fc: FeatureCollection<Geometry, Region>) =>
        !cancelled && setLoaded({ id: chosen.id, regions: fc.features.map((f) => f.properties).filter((r) => r.name) }),
      () => !cancelled && setLoaded({ id: chosen.id, regions: null }),
    )
    return () => {
      cancelled = true
    }
  }, [chosen])

  if (!chosen) return <p className="quiz-empty">Nessuno Stato di questa vista ha abbastanza regioni.</p>
  const regions = loaded?.id === chosen.id ? loaded.regions : undefined

  return (
    <>
      <label className="quiz-country">
        <span>Stato</span>
        <select
          value={chosen.id}
          onChange={(e) => {
            onCountry(e.target.value)
            writeStorage('regions-country', e.target.value)
          }}
        >
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.admin1Count})
            </option>
          ))}
        </select>
      </label>
      {regions === undefined ? (
        <p className="quiz-empty">Caricamento delle regioni…</p>
      ) : !regions || regions.length < MIN_REGIONS ? (
        <p className="quiz-empty">Regioni non disponibili per questo Stato.</p>
      ) : (
        <RegionSession
          key={chosen.id}
          country={chosen}
          regions={regions}
          onFocus={onFocus}
          onMap={onMap}
        />
      )}
    </>
  )
}

type RegionState = {
  deck: Deck
  question: RegionQuestion | null
  picked: string | null
  round: number
  answered: number
  correct: number
  streak: number
}

function RegionSession({
  country,
  regions,
  onFocus,
  onMap,
}: {
  country: Country
  regions: Region[]
  onFocus: (countryId: string | null, reveal: boolean) => void
  onMap: (state: QuizMapState) => void
}) {
  const storageKey = `session:regions:${country.id}`
  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions])
  const ask = (deck: Deck) => {
    const r = byId.get(currentCard(deck) ?? '')
    return r ? regionQuestion(r, regions, Math.random) : null
  }
  const [state, setState] = useState<RegionState>(() => {
    const ids = regions.map((r) => r.id)
    const saved = readSaved(storageKey, ids)
    const deck = saved?.deck ?? createDeck(ids, Math.random)
    return {
      deck,
      question: ask(deck),
      picked: null,
      round: 0,
      answered: saved?.answered ?? 0,
      correct: saved?.correct ?? 0,
      streak: saved?.streak ?? 0,
    }
  })
  const [best, setBest] = useState(() => Number(readStorage('best:regions')) || 0)
  const stageRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { deck, answered, correct, streak } = state
    writeStorage(storageKey, JSON.stringify({ deck, answered, correct, streak } satisfies SavedSession))
  }, [storageKey, state])

  const region = state.question ? (byId.get(state.question.regionId) ?? null) : null
  const answered = state.picked !== null
  const pickedChoice = state.question?.choices.find((c) => c.key === state.picked) ?? null

  // The country stays framed (names hidden until answered) with the asked region outlined.
  const focus = useEffectEvent(onFocus)
  const map = useEffectEvent(onMap)
  useEffect(() => {
    focus(country.id, answered)
    map({ pickMode: false, marks: null, regionId: region?.id ?? null, progress: null })
  }, [country.id, answered, region])

  useEffect(() => {
    if (answered) actionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [answered])

  const pick = (choice: Choice) => {
    if (state.picked !== null) return
    const streak = choice.correct ? state.streak + 1 : 0
    if (streak > best) {
      setBest(streak)
      writeStorage('best:regions', String(streak))
    }
    setState({
      ...state,
      picked: choice.key,
      answered: state.answered + 1,
      correct: state.correct + (choice.correct ? 1 : 0),
      streak,
    })
  }

  const advance = () => {
    if (!pickedChoice) return
    const deck = gradeCard(state.deck, pickedChoice.correct, 'choice')
    setState({ ...state, deck, question: ask(deck), picked: null, round: state.round + 1 })
  }

  const restart = () => {
    const deck = createDeck(
      regions.map((r) => r.id),
      Math.random,
    )
    setState({ deck, question: ask(deck), picked: null, round: state.round + 1, answered: 0, correct: 0, streak: 0 })
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
    if (isForeignConfirm(e, stageRef.current)) return
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0
    let handled = true
    if (!region) {
      if (e.key === 'Enter') restart()
      else handled = false
    } else if (state.picked === null) {
      const choice = digit ? state.question?.choices[digit - 1] : undefined
      if (choice) pick(choice)
      else handled = false
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') advance()
    else handled = false
    if (handled) e.preventDefault()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <>
      <ScoreBar
        correct={state.correct}
        answered={state.answered}
        streak={state.streak}
        best={best}
        done={state.deck.mastered.length}
        total={state.deck.total}
        doneLabel="Indovinate"
        scoreLabel="Punti"
      />
      <div className="quiz-stage" ref={stageRef} tabIndex={-1} key={state.round}>
        {!region || !state.question ? (
          <DeckComplete
            title="Giro completato"
            text={`${state.deck.total} regioni di ${country.name} in ${state.answered} risposte.`}
            onRestart={restart}
          />
        ) : (
          <>
            <div className="quiz-question">
              <p className="quiz-prompt">
                {state.question.ask === 'capital' ? 'Qual è il capoluogo di…' : 'Quale regione è…'}
              </p>
              {state.question.ask === 'capital' ? (
                <h3 className="quiz-subject">{region.name}</h3>
              ) : (
                <h3 className="quiz-subject quiz-subject-hint">
                  <span aria-hidden>◎</span> la regione evidenziata sulla mappa
                </h3>
              )}
              <p className="quiz-context">
                <Flag country={country} className="flag quiz-flag-option" />
                {country.name}
              </p>
            </div>
            <Options choices={state.question.choices} picked={state.picked} onPick={pick} />
            <div className="quiz-live" aria-live="polite">
              {answered && (
                <div className="quiz-feedback">
                  {pickedChoice && (
                    <p className={`quiz-verdict ${pickedChoice.correct ? 'is-correct' : 'is-wrong'}`}>
                      <span aria-hidden>{pickedChoice.correct ? '✓' : '✗'}</span>{' '}
                      {pickedChoice.correct
                        ? 'Esatto!'
                        : `Sbagliato · era ${state.question.choices.find((c) => c.correct)?.label}`}
                    </p>
                  )}
                  <RegionFacts region={region} country={country} />
                  <div ref={actionRef} className="quiz-action">
                    <button type="button" className="quiz-primary" onClick={advance}>
                      Avanti <kbd className="quiz-key">↵</kbd>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <p className="quiz-hint">1–4 per rispondere · Invio o → per andare avanti</p>
    </>
  )
}

function RegionFacts({ region, country }: { region: Region; country: Country }) {
  return (
    <dl className="quiz-facts">
      <div className="quiz-fact-wide">
        <dt>{region.name}</dt>
        <dd>
          {region.capName ? `Capoluogo: ${region.capName}` : 'Capoluogo non disponibile'}
          {region.capPop != null && (
            <span className="quiz-fact-note">
              {formatCompact(region.capPop)} ab. · {formatShare(region.capPop, region.population)} della regione
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>Popolazione</dt>
        <dd>
          {formatCompact(region.population)}
          {formatShare(region.population, country.population) && (
            <span className="quiz-fact-note">{formatShare(region.population, country.population)} dello Stato</span>
          )}
        </dd>
      </div>
      <div>
        <dt>Superficie</dt>
        <dd>
          {formatCompact(region.area)}
          {region.area != null && <span className="quiz-fact-note">km²</span>}
        </dd>
      </div>
      <div>
        <dt>Densità</dt>
        <dd>
          {formatNumber(metricValue(region, 'density'))}
          <span className="quiz-fact-note">ab./km²</span>
        </dd>
      </div>
      {region.gdpPerCapita != null && (
        <div>
          <dt>PIL pro capite</dt>
          <dd>
            {formatMetric(region.gdpPerCapita, 'gdpPerCapita')}
            {region.gdpYear && <span className="quiz-fact-note">{region.gdpYear}</span>}
          </dd>
        </div>
      )}
      {region.lifeExpectancy != null && (
        <div>
          <dt>Aspettativa di vita</dt>
          <dd>
            {formatMetric(region.lifeExpectancy, 'lifeExpectancy')}
            {region.lifeExpectancyYear && <span className="quiz-fact-note">{region.lifeExpectancyYear}</span>}
          </dd>
        </div>
      )}
    </dl>
  )
}

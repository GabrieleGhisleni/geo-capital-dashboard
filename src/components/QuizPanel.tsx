import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Dataset } from '../data'
import {
  buildPool,
  capitalLabel,
  createDeck,
  currentCard,
  gradeCard,
  makeQuestion,
  QUIZ_MODES,
  type Choice,
  type Deck,
  type Question,
  type QuizMode,
} from '../quiz/quiz'
import { formatCompact, formatMetric, formatNumber, metricValue } from '../scale'
import type { City, Country } from '../types'
import { SUBREGION_LABEL } from '../views'
import './QuizPanel.css'

export type QuizPanelProps = {
  data: Dataset
  scopeIds: Set<string>
  scopeLabel: string
  /** reveal=false: keep the answer hidden on the map (id is null while a capital→state question is open). */
  onFocus: (countryId: string | null, reveal: boolean) => void
  onExit: () => void
}

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

const isMode = (v: string | null): v is QuizMode => QUIZ_MODES.some((m) => m.id === v)

export function QuizPanel({ data, scopeIds, scopeLabel, onFocus, onExit }: QuizPanelProps) {
  const [mode, setMode] = useState<QuizMode>(() => {
    const saved = readStorage('mode')
    return isMode(saved) ? saved : 'capital'
  })
  const pool = useMemo(() => buildPool(data.countries, scopeIds), [data, scopeIds])
  const world = useMemo(() => buildPool(data.countries, Object.keys(data.countries)), [data])
  const focus = useEffectEvent(onFocus)

  useEffect(() => () => focus(null, false), [])

  const selectMode = (m: QuizMode) => {
    setMode(m)
    writeStorage('mode', m)
  }

  const exit = () => {
    onFocus(null, false)
    onExit()
  }

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

      <div className="quiz-modes" role="group" aria-label="Tipo di esercizio">
        {QUIZ_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === mode ? 'is-active' : undefined}
            aria-pressed={m.id === mode}
            onClick={() => selectMode(m.id)}
          >
            <span className="quiz-mode-long">{m.label}</span>
            <span className="quiz-mode-short" aria-hidden>
              {m.short}
            </span>
          </button>
        ))}
      </div>

      {pool.length < 2 ? (
        <p className="quiz-empty">Non ci sono abbastanza Stati in questa vista per un quiz.</p>
      ) : (
        <QuizSession
          // A new mode or scope starts a fresh session.
          key={`${mode}|${pool.map((c) => c.id).join()}`}
          mode={mode}
          pool={pool}
          world={world}
          citiesByCountry={data.citiesByCountry}
          onFocus={onFocus}
        />
      )}
    </div>
  )
}

type SessionState = {
  deck: Deck
  question: Question | null
  /** Picked choice key (multiple choice) — non-null once answered. */
  picked: string | null
  /** Flashcard answer shown. */
  revealed: boolean
  /** Bumped on every new card so the enter animation replays. */
  round: number
  answered: number
  correct: number
  streak: number
}

function startSession(mode: QuizMode, pool: Country[], world: Country[]): SessionState {
  const deck = createDeck(
    pool.map((c) => c.id),
    Math.random,
  )
  return {
    deck,
    question: nextQuestion(mode, deck, pool, world),
    picked: null,
    revealed: false,
    round: 0,
    answered: 0,
    correct: 0,
    streak: 0,
  }
}

function nextQuestion(mode: QuizMode, deck: Deck, pool: Country[], world: Country[]): Question | null {
  const id = currentCard(deck)
  const target = pool.find((c) => c.id === id)
  if (mode === 'flashcard' || !target) return null
  return makeQuestion(mode, target, pool, Math.random, world)
}

const PROMPT: Record<QuizMode, string> = {
  capital: 'Qual è la capitale di…',
  country: 'Di quale Stato è la capitale…',
  population: 'Quanti abitanti ha…',
  flashcard: 'Capitale, popolazione e superficie di…',
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

type SessionProps = {
  mode: QuizMode
  pool: Country[]
  world: Country[]
  citiesByCountry: Dataset['citiesByCountry']
  onFocus: (countryId: string | null, reveal: boolean) => void
}

function QuizSession({ mode, pool, world, citiesByCountry, onFocus }: SessionProps) {
  const [state, setState] = useState(() => startSession(mode, pool, world))
  const [best, setBest] = useState(() => Number(readStorage(`best:${mode}`)) || 0)
  const stageRef = useRef<HTMLDivElement>(null)

  const flashcard = mode === 'flashcard'
  const currentId = currentCard(state.deck)
  const country = currentId ? (pool.find((c) => c.id === currentId) ?? null) : null
  const isAnswered = flashcard ? state.revealed : state.picked !== null
  const pickedChoice = state.question?.choices.find((c) => c.key === state.picked) ?? null

  // Map: show the country while asking (answer hidden), reveal it once answered.
  // Capital→state hides the country entirely until answered, since its shape is the answer.
  const focus = useEffectEvent(onFocus)
  useEffect(() => {
    if (!currentId) focus(null, false)
    else if (mode === 'country' && !isAnswered) focus(null, false)
    else focus(currentId, isAnswered)
  }, [currentId, isAnswered, mode, state.round])

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

  const score = (known: boolean) => {
    const streak = known ? state.streak + 1 : 0
    if (streak > best) {
      setBest(streak)
      writeStorage(`best:${mode}`, String(streak))
    }
    return { answered: state.answered + 1, correct: state.correct + (known ? 1 : 0), streak }
  }

  const pick = (choice: Choice) => {
    if (state.picked !== null) return
    setState({ ...state, ...score(choice.correct), picked: choice.key })
  }

  const advance = () => {
    if (!pickedChoice) return
    const deck = gradeCard(state.deck, pickedChoice.correct, false)
    setState({
      ...state,
      deck,
      question: nextQuestion(mode, deck, pool, world),
      picked: null,
      round: state.round + 1,
    })
  }

  const reveal = () => setState({ ...state, revealed: true })

  const grade = (known: boolean) => {
    if (!state.revealed) return
    const deck = gradeCard(state.deck, known, true)
    setState({ ...state, ...score(known), deck, revealed: false, round: state.round + 1 })
  }

  const restart = () => setState((s) => ({ ...startSession(mode, pool, world), round: s.round + 1 }))

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
    const confirm = e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
    // Let Enter/Space activate other focused controls (mode buttons, exit, map UI).
    if (
      confirm &&
      e.target instanceof HTMLElement &&
      e.target !== document.body &&
      !stageRef.current?.contains(e.target)
    )
      return
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0
    let handled = true
    if (!country) {
      if (confirm && flashcard) restart()
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
  const seen = Object.keys(state.deck.streak).length
  const progress = flashcard ? mastered / state.deck.total : seen / state.deck.total

  return (
    <>
      <div className="quiz-score" aria-label="Punteggio">
        <div className="quiz-score-items">
          <span>
            <span className="quiz-score-label">{flashcard ? 'Sapute' : 'Punti'}</span>{' '}
            <strong>
              {state.correct}/{state.answered}
            </strong>
          </span>
          <span>
            <span className="quiz-score-label">Serie</span> <strong>{state.streak}</strong>
          </span>
          <span>
            <span className="quiz-score-label">Record</span> <strong>{best}</strong>
          </span>
        </div>
        <div className="quiz-progress">
          <div className="quiz-bar" aria-hidden>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="quiz-progress-label">
            {flashcard ? `Imparate ${mastered}/${state.deck.total}` : `Visti ${seen}/${state.deck.total}`}
          </span>
        </div>
      </div>

      <div className="quiz-stage" ref={stageRef} tabIndex={-1} key={state.round}>
        {!country ? (
          <DeckComplete total={state.deck.total} answered={state.answered} onRestart={restart} />
        ) : (
          <>
            <div className="quiz-question">
              <p className="quiz-prompt">{PROMPT[mode]}</p>
              <h3 className="quiz-subject">{mode === 'country' ? capitalLabel(country) : country.name}</h3>
              <p className="quiz-context">{SUBREGION_LABEL[country.subregion] ?? country.subregion}</p>
            </div>

            {state.question && <Options question={state.question} picked={state.picked} onPick={pick} />}

            {flashcard && !state.revealed && (
              <button type="button" className="quiz-primary" onClick={reveal}>
                Mostra risposta <kbd className="quiz-key">Spazio</kbd>
              </button>
            )}

            <div className="quiz-live" aria-live="polite">
              {isAnswered && (
                <div className="quiz-feedback">
                  {pickedChoice && (
                    <p className={`quiz-verdict ${pickedChoice.correct ? 'is-correct' : 'is-wrong'}`}>
                      <span aria-hidden>{pickedChoice.correct ? '✓' : '✗'}</span>{' '}
                      {pickedChoice.correct
                        ? 'Esatto!'
                        : `Sbagliato · era ${state.question?.choices.find((c) => c.correct)?.label}`}
                    </p>
                  )}
                  <Facts country={country} cities={citiesByCountry[country.id] ?? []} />
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
          : '1–4 per rispondere · Invio o → per andare avanti'}
      </p>
    </>
  )
}

function Options({
  question,
  picked,
  onPick,
}: {
  question: Question
  picked: string | null
  onPick: (choice: Choice) => void
}) {
  const answered = picked !== null
  return (
    <ol className="quiz-options">
      {question.choices.map((choice, i) => {
        const isPicked = choice.key === picked
        const state = !answered ? '' : choice.correct ? 'is-correct' : isPicked ? 'is-wrong' : 'is-dim'
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

function Facts({ country, cities }: { country: Country; cities: City[] }) {
  return (
    <>
      <dl className="quiz-facts">
        <div>
          <dt>Capitale</dt>
          <dd>{capitalLabel(country)}</dd>
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
              <li key={`${c.name}-${c.lat}`}>
                {c.name} <span>{formatCompact(c.population)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function DeckComplete({ total, answered, onRestart }: { total: number; answered: number; onRestart: () => void }) {
  return (
    <div className="quiz-complete">
      <p className="quiz-complete-icon" aria-hidden>
        ★
      </p>
      <h3 className="quiz-subject">Mazzo completato</h3>
      <p className="quiz-context">
        {total} carte imparate in {answered} risposte.
      </p>
      <button type="button" className="quiz-primary" onClick={onRestart}>
        Ricomincia <kbd className="quiz-key">↵</kbd>
      </button>
    </div>
  )
}

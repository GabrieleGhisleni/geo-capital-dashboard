import { useEffect, useState } from 'react'

export type TimelineProps = {
  /** The metric has a yearly series (area and "none" do not). */
  available: boolean
  from: number | null
  to: number | null
  /** Shown year; null = timeline closed (latest data). */
  year: number | null
  loading: boolean
  onYear: (year: number | null) => void
}

/** Milliseconds per year while playing: the whole 1960–2025 run takes about 20 s. */
const PLAY_STEP_MS = 300

/** Year slider under the legend: opens on the latest year, plays year by year, closes back to the latest data. */
export function Timeline({ available, from, to, year, loading, onYear }: TimelineProps) {
  const [playing, setPlaying] = useState(false)
  const open = year != null || loading
  const atEnd = year != null && to != null && year >= to
  // Playing stops by itself on the last year.
  const running = playing && !atEnd

  useEffect(() => {
    if (!running || year == null) return
    const id = window.setTimeout(() => onYear(year + 1), PLAY_STEP_MS)
    return () => window.clearTimeout(id)
  }, [running, year, onYear])

  if (!available) return null
  if (!open) {
    return (
      <button type="button" className="timeline-open" onClick={() => onYear(new Date().getFullYear())}>
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 6v4.2l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Linea del tempo
      </button>
    )
  }

  const play = () => {
    // From the end, a new run starts at the first year.
    if (atEnd && from != null) {
      onYear(from)
      setPlaying(true)
    } else setPlaying(!running)
  }
  const close = () => {
    setPlaying(false)
    onYear(null)
  }

  return (
    <div className="timeline" role="group" aria-label="Linea del tempo">
      <button
        type="button"
        className="timeline-play"
        onClick={play}
        disabled={from == null}
        aria-label={running ? 'Pausa' : 'Riproduci gli anni'}
      >
        {running ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        className="timeline-range"
        min={from ?? 0}
        max={to ?? 0}
        step={1}
        value={year ?? to ?? 0}
        disabled={from == null}
        aria-label="Anno"
        onChange={(e) => {
          setPlaying(false)
          onYear(Number(e.target.value))
        }}
      />
      <span className="timeline-year" aria-live="polite">
        {loading || year == null ? '…' : year}
      </span>
      <button type="button" className="timeline-close" onClick={close} aria-label="Chiudi la linea del tempo">
        ×
      </button>
    </div>
  )
}

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { formatClock, type SunDay } from '../sunTimes'
import { dayLabel, hourTicks, MONTHS, span, sunSummary } from './days'

/** Inclusive range of day indices of the year (0 = 1 January) on the charts. */
export type Range = { from: number; to: number }

/** One city on the charts; `slot` (0–2) picks its color and stays with it while others come and go. */
export type Series = { id: string; name: string; slot: number; days: SunDay[] }

export type Pointer = {
  /** The day shown by every chart and card. */
  active: number
  today: number | null
  onHover: (day: number | null) => void
  onPick: (day: number) => void
}

/** Width of an element, followed as it resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

type Frame = { left: number; top: number; width: number; height: number }

/** Day slots across the frame: each day owns an equal slice, its values sit at the slice's centre. */
function dayScale(range: Range, f: Frame) {
  const n = range.to - range.from + 1
  const slot = f.width / n
  return {
    slot,
    center: (i: number) => f.left + (i - range.from + 0.5) * slot,
    edge: (i: number) => f.left + (i - range.from) * slot,
    index: (px: number) => Math.min(range.to, Math.max(range.from, range.from + Math.floor((px - f.left) / slot))),
  }
}

type Days = ReturnType<typeof dayScale>

/**
 * Runs of consecutive days with a value, each widened by half a slot on both ends so lines and bands reach the
 * edges of their days (and of the plot).
 */
function runs<T>(range: Range, x: Days, value: (i: number) => T | null): { x: number; v: T }[][] {
  const out: { x: number; v: T }[][] = []
  let run: { x: number; v: T }[] = []
  const close = () => {
    if (run.length) {
      run.unshift({ x: run[0].x - x.slot / 2, v: run[0].v })
      run.push({ x: run[run.length - 1].x + x.slot / 2, v: run[run.length - 1].v })
      out.push(run)
    }
    run = []
  }
  for (let i = range.from; i <= range.to; i++) {
    const v = value(i)
    if (v == null) close()
    else run.push({ x: x.center(i), v })
  }
  close()
  return out
}

const pt = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`

function linePath(lines: { x: number; v: number }[][], y: (v: number) => number): string {
  return lines.map((run) => `M${run.map((p) => pt(p.x, y(p.v))).join('L')}`).join('')
}

function bandPath(bands: { x: number; v: [number, number] }[][], y: (v: number) => number): string {
  return bands
    .map((run) => {
      const top = run.map((p) => pt(p.x, y(p.v[1])))
      const bottom = run.map((p) => pt(p.x, y(p.v[0]))).reverse()
      return `M${top.join('L')}L${bottom.join('L')}Z`
    })
    .join('')
}

const hourTickLabel = (h: number) => (Number.isInteger(h) ? `${h} h` : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`)

const monthStarts = (range: Range, dates: number[]) =>
  dates.flatMap((d, i) => (new Date(d).getUTCDate() === 1 && i >= range.from && i <= range.to ? [i] : []))

/** Month boundaries of the year view, as vertical gridlines. */
function MonthGrid({ range, x, f, dates, className }: { range: Range; x: Days; f: Frame; dates: number[]; className: string }) {
  if (range.to - range.from <= 40) return null
  return (
    <g>
      {monthStarts(range, dates)
        .filter((i) => i > range.from)
        .map((i) => (
          <line key={i} className={className} x1={x.edge(i)} x2={x.edge(i)} y1={f.top} y2={f.top + f.height} />
        ))}
    </g>
  )
}

/** Month names (year view) or day numbers (month view) along the bottom. */
function DayAxis({ range, x, f, dates }: { range: Range; x: Days; f: Frame; dates: number[] }) {
  const y = f.top + f.height
  if (range.to - range.from > 40) {
    const starts = monthStarts(range, dates)
    const narrow = f.width / 12 < 30
    return (
      <g className="dl-axis">
        {starts.map((i, k) => {
          const end = starts[k + 1] ?? range.to + 1
          const month = MONTHS[new Date(dates[i]).getUTCMonth()]
          return (
            <text key={i} x={(x.edge(i) + x.edge(end)) / 2} y={y + 16} textAnchor="middle">
              {narrow ? month[0].toUpperCase() : month.slice(0, 3)}
            </text>
          )
        })}
      </g>
    )
  }
  const every = x.slot >= 22 ? 1 : x.slot >= 11 ? 2 : 5
  return (
    <g className="dl-axis">
      {dates.slice(range.from, range.to + 1).map((d, k) => {
        const day = new Date(d).getUTCDate()
        if (every > 1 && day !== 1 && day % every) return null
        return (
          <text key={d} x={x.center(range.from + k)} y={y + 16} textAnchor="middle">
            {day}
          </text>
        )
      })}
    </g>
  )
}

/** Pointer and keyboard handling shared by the charts: hover follows the mouse, a click or a touch pins the day. */
function dayHandlers(x: Days, range: Range, { active, onHover, onPick }: Pointer) {
  const index = (e: PointerEvent<SVGSVGElement>) => x.index(e.clientX - e.currentTarget.getBoundingClientRect().left)
  return {
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === 'mouse') onHover(index(e))
      else if (e.buttons) onPick(index(e))
    },
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      if (e.pointerType !== 'mouse') onPick(index(e))
    },
    onPointerLeave: () => onHover(null),
    onClick: (e: MouseEvent<SVGSVGElement>) =>
      onPick(x.index(e.clientX - e.currentTarget.getBoundingClientRect().left)),
    onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 }[e.key]
      const next =
        e.key === 'Home' ? range.from : e.key === 'End' ? range.to : step != null ? active + step * (e.shiftKey ? 7 : 1) : null
      if (next == null) return
      e.preventDefault()
      onPick(Math.min(range.to, Math.max(range.from, next)))
    },
  }
}

/** Date of the active day above the crosshair, kept inside the chart. */
function DatePill({ x, y, width, label }: { x: number; y: number; width: number; label: string }) {
  const w = label.length * 6.4 + 14
  const left = Math.min(width - w - 2, Math.max(2, x - w / 2))
  return (
    <g className="dl-pill">
      <rect x={left} y={y} width={w} height={18} rx={9} />
      <text x={left + w / 2} y={y + 12.5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function TodayMark({ x, f }: { x: number; f: Frame }) {
  return (
    <g className="dl-today">
      <line x1={x} x2={x} y1={f.top + f.height - 6} y2={f.top + f.height} />
      <text x={x + 5} y={f.top + f.height - 3}>oggi</text>
    </g>
  )
}

const LABEL_GAP = 14

/** Day length through the period, one line per city. */
export function DayLengthChart({ series, range, pointer }: { series: Series[]; range: Range; pointer: Pointer }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const wide = width >= 560
  const height = wide ? 260 : 210
  // Everything but the crosshair, so moving over the chart redraws only that.
  const { f, x, y, ticks, lines, ends, dates } = useMemo(() => {
    const f: Frame = { left: 44, top: 28, width: Math.max(1, width - 44 - (wide ? 96 : 10)), height: height - 28 - 26 }
    const x = dayScale(range, f)
    const values = series.flatMap((s) => s.days.slice(range.from, range.to + 1).map((d) => d.daylight))
    const ticks = hourTicks(values.length ? values : [0, 24])
    const [lo, hi] = [ticks[0], ticks[ticks.length - 1]]
    const y = (h: number) => f.top + f.height - ((h - lo) / (hi - lo)) * f.height
    const lines = series.map((s) => ({ s, d: linePath(runs(range, x, (i) => s.days[i].daylight), y) }))
    // Names at the right end of the lines, dropped where they would collide (the legend still names every line).
    const ends = series
      .map((s) => ({ s, y: y(s.days[range.to].daylight) }))
      .sort((a, b) => a.y - b.y)
      .filter((e, i, all) => i === 0 || e.y - all[i - 1].y >= LABEL_GAP)
    return { f, x, y, ticks, lines, ends, dates: series[0]?.days.map((d) => d.date) ?? [] }
  }, [series, range, width, wide, height])
  const handlers = dayHandlers(x, range, pointer)
  const ax = x.center(pointer.active)

  return (
    <div className="dl-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Durata del giorno nel periodo scelto, una linea per città"
          tabIndex={0}
          {...handlers}
        >
          {ticks.map((t) => (
            <g key={t} className="dl-axis">
              <line className="dl-grid" x1={f.left} x2={f.left + f.width} y1={y(t)} y2={y(t)} />
              <text x={f.left - 8} y={y(t) + 4} textAnchor="end">
                {hourTickLabel(t)}
              </text>
            </g>
          ))}
          <MonthGrid range={range} x={x} f={f} dates={dates} className="dl-grid" />
          {dates.length > 0 && <DayAxis range={range} x={x} f={f} dates={dates} />}
          {pointer.today != null && pointer.today >= range.from && pointer.today <= range.to && (
            <TodayMark x={x.center(pointer.today)} f={f} />
          )}
          {lines.map(({ s, d }) => (
            <path key={s.id} className={`dl-line series-${s.slot + 1}`} d={d} />
          ))}
          {wide &&
            ends.map(({ s, y: ly }) => (
              <text key={s.id} className="dl-end-label" x={f.left + f.width + 8} y={ly + 4}>
                {s.name.length > 13 ? `${s.name.slice(0, 12)}…` : s.name}
              </text>
            ))}
          <line className="dl-crosshair" x1={ax} x2={ax} y1={f.top} y2={f.top + f.height} />
          {series.map((s) => (
            <circle key={s.id} className={`dl-dot series-${s.slot + 1}`} cx={ax} cy={y(s.days[pointer.active].daylight)} r={4.5} />
          ))}
          {dates.length > 0 && <DatePill x={ax} y={2} width={width} label={dayLabel(dates[pointer.active], true)} />}
        </svg>
      )}
    </div>
  )
}

const CLOCK_TICKS = [0, 6, 12, 18, 24]

/** One panel per city: night, civil twilight and daylight through the period, in the city's clock time. */
function SunPanel({ s, range, pointer, width, axis }: { s: Series; range: Range; pointer: Pointer; width: number; axis: boolean }) {
  // useId's punctuation is not safe inside url(#…).
  const clip = `sky${useId().replace(/[^\w-]/g, '')}`
  const wide = width >= 560
  const plotH = wide ? 124 : 104
  const height = 6 + plotH + (axis ? 24 : 6)
  // The sky bands and their edges don't depend on the active day: computed once per city, period and width.
  const { f, x, y, twilight, light, edges, dates } = useMemo(() => {
    const f: Frame = { left: 44, top: 6, width: Math.max(1, width - 44 - (wide ? 96 : 10)), height: plotH }
    const x = dayScale(range, f)
    const y = (h: number) => f.top + f.height - (h / 24) * f.height
    // Near the poles a band can cross midnight: draw it again a day up and a day down, the clip keeps 0–24 h.
    const shifted = (fn: (d: SunDay) => [number, number] | null) =>
      [-24, 0, 24].map((k) =>
        bandPath(
          runs(range, x, (i) => fn(s.days[i])?.map((h) => h + k) as [number, number] | null),
          y,
        ),
      )
    const crossings = (fn: (c: { rise: number; set: number }) => number) =>
      [-24, 0, 24].map((k) =>
        linePath(
          runs(range, x, (i) => {
            const c = s.days[i].sun
            return typeof c === 'string' ? null : fn(c) + k
          }),
          y,
        ),
      )
    return {
      f,
      x,
      y,
      twilight: shifted((d) => span(d.civil, d.noon)),
      light: shifted((d) => span(d.sun, d.noon)),
      edges: [...crossings((c) => c.rise), ...crossings((c) => c.set)],
      dates: s.days.map((d) => d.date),
    }
  }, [s, range, width, wide, plotH])
  const handlers = dayHandlers(x, range, pointer)
  const day = s.days[pointer.active]
  const ax = x.center(pointer.active)
  // Today's sunrise and sunset on the crosshair: the higher label above its dot, the lower one below, and on
  // opposite sides of the crosshair when they would still touch (a sunset past midnight drawn near the bottom).
  const marks = (typeof day.sun === 'string' ? [] : [day.sun.rise, day.sun.set])
    .map((h) => ({ h, y: y(((h % 24) + 24) % 24) }))
    .sort((a, b) => a.y - b.y)
    .map((m, k) => ({ ...m, ly: Math.min(f.top + f.height - 4, Math.max(f.top + 11, m.y + (k ? 15 : -7))) }))
  const roomRight = ax + 64 < f.left + f.width
  const apart = marks.length < 2 || Math.abs(marks[0].ly - marks[1].ly) >= 12
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Alba e tramonto a ${s.name} nel periodo scelto`}
      tabIndex={0}
      {...handlers}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={f.left} y={f.top} width={f.width} height={f.height} rx={6} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect className="dl-sky-night" x={f.left} y={f.top} width={f.width} height={f.height} />
        {twilight.map((d, k) => (
          <path key={k} className="dl-sky-twilight" d={d} />
        ))}
        {light.map((d, k) => (
          <path key={k} className="dl-sky-day" d={d} />
        ))}
        {CLOCK_TICKS.slice(1, -1).map((t) => (
          <line key={t} className="dl-sky-grid" x1={f.left} x2={f.left + f.width} y1={y(t)} y2={y(t)} />
        ))}
        <MonthGrid range={range} x={x} f={f} dates={dates} className="dl-sky-grid" />
        {edges.map((d, k) => (
          <path key={k} className={`dl-edge series-${s.slot + 1}`} d={d} />
        ))}
      </g>
      {CLOCK_TICKS.map((t) => (
        <text key={t} className="dl-axis-text" x={f.left - 8} y={Math.min(f.top + f.height, Math.max(f.top + 8, y(t) + 4))} textAnchor="end">
          {String(t).padStart(2, '0')}
        </text>
      ))}
      {axis && <DayAxis range={range} x={x} f={f} dates={dates} />}
      {axis && pointer.today != null && pointer.today >= range.from && pointer.today <= range.to && (
        <line className="dl-today-tick" x1={x.center(pointer.today)} x2={x.center(pointer.today)} y1={f.top + f.height} y2={f.top + f.height + 5} />
      )}
      <line className="dl-crosshair dl-crosshair-light" x1={ax} x2={ax} y1={f.top} y2={f.top + f.height} />
      {marks.map((m, k) => {
        const right = apart ? roomRight : k === 1
        return (
          <g key={k}>
            <circle className={`dl-dot series-${s.slot + 1}`} cx={ax} cy={m.y} r={4.5} />
            <text className="dl-mark-label" x={right ? ax + 9 : ax - 9} y={m.ly} textAnchor={right ? 'start' : 'end'}>
              {formatClock(m.h)}
            </text>
          </g>
        )
      })}
      {wide && (
        <text className="dl-end-label" x={f.left + f.width + 8} y={f.top + f.height / 2 + 4}>
          {s.name.length > 13 ? `${s.name.slice(0, 12)}…` : s.name}
        </text>
      )}
    </svg>
  )
}

export function SunTimesChart({ series, range, pointer }: { series: Series[]; range: Range; pointer: Pointer }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  return (
    <div className="dl-chart" ref={ref}>
      {width > 0 &&
        series.map((s, i) => {
          const day = s.days[pointer.active]
          return (
            <figure key={s.id} className="dl-sun-panel">
              <figcaption>
                <span className={`dl-key series-${s.slot + 1}`} aria-hidden />
                <strong>{s.name}</strong>
                <span className="muted">{sunSummary(day)}</span>
              </figcaption>
              <SunPanel s={s} range={range} pointer={pointer} width={width} axis={i === series.length - 1} />
            </figure>
          )
        })}
      <ul className="dl-sky-legend" aria-label="Legenda">
        <li>
          <span className="dl-swatch dl-sky-day" /> Sole sopra l’orizzonte
        </li>
        <li>
          <span className="dl-swatch dl-sky-twilight" /> Crepuscolo civile
        </li>
        <li>
          <span className="dl-swatch dl-sky-night" /> Notte
        </li>
      </ul>
    </div>
  )
}

/** The active day as a 24-hour bar: night, twilight and daylight in the city's clock time. */
export function DayStrip({ day }: { day: SunDay }) {
  const parts: { cls: string; from: number; to: number }[] = []
  for (const [cls, c] of [
    ['dl-sky-twilight', day.civil],
    ['dl-sky-day', day.sun],
  ] as const) {
    const s = span(c, day.noon)
    if (!s) continue
    for (const k of [-24, 0, 24]) {
      const from = Math.max(0, s[0] + k)
      const to = Math.min(24, s[1] + k)
      if (to > from) parts.push({ cls, from, to })
    }
  }
  return (
    <div className="dl-strip" aria-hidden>
      <div className="dl-strip-bar dl-sky-night">
        {parts.map((p, i) => (
          <span key={i} className={p.cls} style={{ left: `${(p.from / 24) * 100}%`, width: `${((p.to - p.from) / 24) * 100}%` }} />
        ))}
      </div>
      <div className="dl-strip-ticks">
        {CLOCK_TICKS.map((t) => (
          <span key={t} style={{ left: `${(t / 24) * 100}%` }}>
            {String(t).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  )
}

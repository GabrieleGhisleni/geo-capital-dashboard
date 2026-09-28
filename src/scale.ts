import type { Metric } from './types'

/** Sequential blue ramp (steps 100→700), light→dark = low→high on the light surface. */
export const RAMP_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
/** On the dark surface low values recede toward the background: dark→light = low→high. */
export const RAMP_DARK = ['#104281', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb']

/**
 * Quantile class breaks: returns up to `classes - 1` ascending thresholds.
 * A value v falls in class i where i = number of thresholds <= v.
 */
export function quantileBreaks(values: number[], classes = RAMP_LIGHT.length): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length < 2) return []
  const breaks: number[] = []
  for (let i = 1; i < classes; i++) {
    const t = sorted[Math.floor((i * sorted.length) / classes)]
    if (t > sorted[0] && (breaks.length === 0 || t > breaks[breaks.length - 1])) breaks.push(niceRound(t))
  }
  return [...new Set(breaks)]
}

/** Round to 2 significant digits so legend labels read cleanly. */
export function niceRound(v: number): number {
  if (v === 0) return 0
  const mag = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1)
  return Math.round(v / mag) * mag
}

export function classIndex(value: number, breaks: number[]): number {
  let i = 0
  while (i < breaks.length && value >= breaks[i]) i++
  return i
}

/** Pick evenly spread ramp colors when there are fewer classes than ramp steps. */
export function rampFor(classCount: number, ramp: string[]): string[] {
  if (classCount >= ramp.length) return ramp
  if (classCount === 1) return [ramp[Math.floor(ramp.length / 2)]]
  return Array.from({ length: classCount }, (_, i) =>
    ramp[Math.round((i * (ramp.length - 1)) / (classCount - 1))],
  )
}

export function metricValue(
  item: { population?: number | null; area?: number | null },
  metric: Metric,
): number | null {
  const { population, area } = item
  if (metric === 'population') return population ?? null
  if (metric === 'area') return area ?? null
  if (metric === 'density') return population && area ? population / area : null
  return null
}

const nf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })

export function formatNumber(v: number | null | undefined): string {
  if (v == null) return '—'
  return (Math.abs(v) < 10 ? nf1 : nf).format(v)
}

export function formatCompact(v: number | null | undefined): string {
  if (v == null) return '—'
  return Math.abs(v) < 1000 ? formatNumber(v) : compact.format(v)
}

export function formatMetric(v: number | null | undefined, metric: Metric): string {
  if (v == null) return '—'
  if (metric === 'area') return `${formatNumber(v)} km²`
  if (metric === 'density') return `${formatNumber(v)} ab./km²`
  return formatNumber(v)
}

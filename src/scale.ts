import type { Metric } from './types'

export type ColorMetric = Exclude<Metric, 'none'>

/**
 * Multi-hue sequential ramps (CARTO), light → dark = low → high. Each metric gets its own hue
 * family so switching metric is visibly a different map.
 */
export const RAMPS: Record<ColorMetric, string[]> = {
  population: ['#f3e79b', '#fac484', '#f8a07e', '#eb7f86', '#ce6693', '#a059a0', '#5c53a5'], // Sunset
  area: ['#d3f2a3', '#97e196', '#6cc08b', '#4c9b82', '#217a79', '#105965', '#074050'], // Emrld
  density: ['#ffc6c4', '#f4a3a8', '#e38191', '#cc607d', '#ad466c', '#8b3058', '#672044'], // Burg
  gdp: ['#d1eeea', '#a8dbd9', '#85c4c9', '#68abb8', '#4f90a6', '#3b738f', '#2a5674'], // Teal
  gdpPerCapita: ['#f9ddda', '#f2b9c4', '#e597b9', '#ce78b3', '#ad5fad', '#834ba0', '#573b88'], // Purp
  lifeExpectancy: ['#f7feae', '#b7e6a5', '#7ccba2', '#46aea0', '#089099', '#00718b', '#045275'], // BluYl
  gdpPerCapitaPpp: ['#f3cbd3', '#eaa9bd', '#dd88ac', '#ca699d', '#b14d8e', '#91357d', '#6c2167'], // Magenta
  elderlyShare: ['#fde0c5', '#facba6', '#f8b58b', '#f59e72', '#f2855d', '#ef6a4c', '#eb4a40'], // Peach
  fertility: ['#fef6b5', '#ffdd9a', '#ffc285', '#ffa679', '#fa8a76', '#f16d7a', '#e15383'], // PinkYl
  urbanShare: ['#d2fbd4', '#a5dbc2', '#7bbcb0', '#559c9e', '#3a7c89', '#235d72', '#123f5a'], // DarkMint
  co2PerCapita: ['#ede5cf', '#e0c2a2', '#d39c83', '#c1766f', '#a65461', '#813753', '#541f3f'], // BrwnYl
}

/** Metrics on a narrow, additive range (years), where a log scale would only distort. */
const LINEAR_METRICS = new Set<ColorMetric>(['lifeExpectancy', 'elderlyShare', 'fertility', 'urbanShare'])

/**
 * Robust range of the values (outliers clamp to the ends): log10 bounds on log scales,
 * plain value bounds on linear ones.
 */
export type Domain = [number, number]

export type Scale = {
  kind: 'log' | 'linear'
  domain: Domain
  ticks: number[]
  ramp: string[]
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo)
}

/** Robust log10 domain (2nd–98th percentile), so a Vatican or a Russia doesn't flatten everyone else. */
export function logDomain(values: number[]): Domain | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const trim = sorted.length >= 20 ? 0.02 : 0
  const lo = Math.log10(percentile(sorted, trim))
  const hi = Math.log10(percentile(sorted, 1 - trim))
  return hi - lo < 1e-9 ? [lo - 0.5, hi + 0.5] : [lo, hi]
}

/** Position of a value on a log domain, 0–1 (clamped). */
export function scalePosition(value: number, [lo, hi]: Domain): number {
  if (!(value > 0)) return 0
  return Math.min(1, Math.max(0, (Math.log10(value) - lo) / (hi - lo)))
}

/** Position of a value on a scale of either kind, 0–1 (clamped). */
export function positionOn(value: number, scale: Scale): number {
  if (scale.kind === 'log') return scalePosition(value, scale.domain)
  const [lo, hi] = scale.domain
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
}

/** Robust linear domain (2nd–98th percentile). */
export function linearDomain(values: number[]): Domain | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const trim = sorted.length >= 20 ? 0.02 : 0
  const lo = percentile(sorted, trim)
  const hi = percentile(sorted, 1 - trim)
  return hi - lo < 1e-9 ? [lo - 1, hi + 1] : [lo, hi]
}

/** Round, evenly spaced ticks inside a linear domain (steps of 1, 2, 2.5 or 5 × 10ⁿ). */
export function niceLinearTicks([lo, hi]: Domain, max = 5): number[] {
  const raw = (hi - lo) / Math.max(1, max - 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => (hi - lo) / st <= max - 1) ?? 10 * mag
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toPrecision(6)))
  return ticks
}

const LADDERS = [[1], [1, 3], [1, 2, 5], [1, 1.5, 2, 3, 5, 7]]

/** Round tick values inside the domain: decades when the range is wide, 1-2-5 steps otherwise. */
export function niceLogTicks([lo, hi]: Domain, max = 5): number[] {
  const min = 10 ** lo
  const maxV = 10 ** hi
  for (const ladder of LADDERS) {
    const ticks: number[] = []
    for (let exp = Math.floor(lo); exp <= Math.ceil(hi); exp++) {
      for (const step of ladder) {
        const v = step * 10 ** exp
        if (v >= min * 0.999 && v <= maxV * 1.001) ticks.push(Number(v.toPrecision(6)))
      }
    }
    if (ticks.length >= 3 || ladder === LADDERS[LADDERS.length - 1]) {
      if (ticks.length <= max) return ticks
      const stride = Math.ceil(ticks.length / max)
      return ticks.filter((_, i) => i % stride === 0)
    }
  }
  return []
}

export function buildScale(values: number[], metric: ColorMetric): Scale | null {
  if (LINEAR_METRICS.has(metric)) {
    const domain = linearDomain(values)
    return domain && { kind: 'linear', domain, ticks: niceLinearTicks(domain), ramp: RAMPS[metric] }
  }
  const domain = logDomain(values)
  return domain && { kind: 'log', domain, ticks: niceLogTicks(domain), ramp: RAMPS[metric] }
}

/** CSS gradient of a ramp, for legends and swatches. */
export function rampGradient(ramp: string[], direction = 'to right'): string {
  return `linear-gradient(${direction}, ${ramp.map((c, i) => `${c} ${((i / (ramp.length - 1)) * 100).toFixed(1)}%`).join(', ')})`
}

/** Color at position t (0–1) along a ramp, interpolated in sRGB like the map does. */
export function colorAt(t: number, ramp: string[]): string {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const f = x - i
  const a = parseInt(ramp[i].slice(1), 16)
  const b = parseInt(ramp[i + 1].slice(1), 16)
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f)
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`
}

/** Every metric but density (derived) and none is a field of the same name on countries and regions. */
export type Measurable = Partial<Record<Exclude<Metric, 'density' | 'none'>, number | null>>

export function metricValue(item: Measurable, metric: Metric): number | null {
  if (metric === 'none') return null
  if (metric === 'density') return item.population && item.area ? item.population / item.area : null
  return item[metric] ?? null
}

const nf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })

export function formatNumber(v: number | null | undefined): string {
  if (v == null) return '—'
  return (Math.abs(v) < 10 ? nf1 : nf).format(v)
}

export function formatCompact(v: number | null | undefined): string {
  if (v == null) return '—'
  return Math.abs(v) < 1000 ? formatNumber(v) : compact.format(v)
}

/** US$ amounts in Italian usage: "60.496 $", "850 Mln $", "5.051 Mld $" (never the ambiguous "Bln"). */
function formatUsd(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(abs >= 1e10 ? nf : nf1).format(v / 1e9)} Mld $`
  if (abs >= 1e6) return `${(abs >= 1e7 ? nf : nf1).format(v / 1e6)} Mln $`
  return `${nf.format(v)} $`
}

export function formatMetric(v: number | null | undefined, metric: Metric): string {
  if (v == null) return '—'
  if (metric === 'area') return `${formatNumber(v)} km²`
  if (metric === 'density') return `${formatNumber(v)} ab./km²`
  if (metric === 'gdp' || metric === 'gdpPerCapita') return formatUsd(v)
  if (metric === 'gdpPerCapitaPpp') return `${formatUsd(v)} PPA`
  if (metric === 'lifeExpectancy') return `${nf1.format(v)} anni`
  if (metric === 'elderlyShare' || metric === 'urbanShare') return `${nf1.format(v)}%`
  if (metric === 'fertility') return `${nf2.format(v)} figli per donna`
  if (metric === 'co2PerCapita') return `${nf2.format(v)} t CO₂/ab.`
  return formatNumber(v)
}

/** Share of a whole as an Italian percentage: "12,4%", "0,3%", "<0,1%". */
export function formatShare(part: number | null | undefined, whole: number | null | undefined): string | null {
  if (part == null || !whole) return null
  const pct = (part / whole) * 100
  if (pct < 0.1) return '<0,1%'
  return `${(pct >= 10 ? nf : nf1).format(pct)}%`
}

/** Short form for legend ticks and tight spaces. */
export function formatMetricCompact(v: number | null | undefined, metric: Metric): string {
  if (v == null) return '—'
  if (metric === 'gdp') return formatUsd(v)
  if (metric === 'gdpPerCapita' || metric === 'gdpPerCapitaPpp') return `${formatCompact(v)} $`
  if (metric === 'lifeExpectancy') return nf.format(v)
  if (metric === 'elderlyShare' || metric === 'urbanShare') return `${nf.format(v)}%`
  if (metric === 'fertility') return nf1.format(v)
  if (metric === 'co2PerCapita') return `${nf1.format(v)} t`
  return formatCompact(v)
}

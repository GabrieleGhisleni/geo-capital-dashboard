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
}

/** Log-scale domain: log10 bounds of the robust range of the values (outliers clamp to the ends). */
export type Domain = [number, number]

export type Scale = {
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

/** Position of a value on the scale, 0–1 (clamped). */
export function scalePosition(value: number, [lo, hi]: Domain): number {
  if (!(value > 0)) return 0
  return Math.min(1, Math.max(0, (Math.log10(value) - lo) / (hi - lo)))
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
  const domain = logDomain(values)
  if (!domain) return null
  return { domain, ticks: niceLogTicks(domain), ramp: RAMPS[metric] }
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

type Measurable = {
  population?: number | null
  area?: number | null
  gdp?: number | null
  gdpPerCapita?: number | null
}

export function metricValue(item: Measurable, metric: Metric): number | null {
  const { population, area } = item
  switch (metric) {
    case 'population':
      return population ?? null
    case 'area':
      return area ?? null
    case 'density':
      return population && area ? population / area : null
    case 'gdp':
      return item.gdp ?? null
    case 'gdpPerCapita':
      return item.gdpPerCapita ?? null
    case 'none':
      return null
  }
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
  return formatNumber(v)
}

/** Short form for legend ticks and tight spaces. */
export function formatMetricCompact(v: number | null | undefined, metric: Metric): string {
  if (v == null) return '—'
  if (metric === 'gdp') return formatUsd(v)
  if (metric === 'gdpPerCapita') return `${formatCompact(v)} $`
  return formatCompact(v)
}

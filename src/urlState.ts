import type { Background, Metric, Projection, ViewId } from './types'
import { METRIC_BY_ID, VIEW_BY_ID } from './views'

/**
 * Shareable map state in the URL hash, e.g. `#v=asia&m=gdp&c=JPN&y=1990`. Defaults are left out, so the plain
 * address opens the default map. The country id is checked against the dataset by the caller.
 */
export type UrlState = {
  view?: ViewId
  metric?: Metric
  country?: string
  projection?: Projection
  background?: Background
  year?: number
  night?: boolean
}

const PROJECTIONS: Projection[] = ['globe', 'equal-earth', 'mercator']
const BACKGROUNDS: Background[] = ['plain', 'relief']

export const URL_DEFAULTS = {
  view: 'europe',
  metric: 'population',
  projection: 'globe',
  background: 'plain',
} as const satisfies Partial<UrlState>

export function readUrlState(hash: string): UrlState {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const out: UrlState = {}
  const v = q.get('v')
  if (v && v in VIEW_BY_ID) out.view = v as ViewId
  const m = q.get('m')
  if (m && m in METRIC_BY_ID) out.metric = m as Metric
  const c = q.get('c')
  if (c && /^[A-Z0-9]{3}$/.test(c)) out.country = c
  const p = q.get('p')
  if (p && PROJECTIONS.includes(p as Projection)) out.projection = p as Projection
  const b = q.get('b')
  if (b && BACKGROUNDS.includes(b as Background)) out.background = b as Background
  const y = Number(q.get('y'))
  if (Number.isInteger(y) && y >= 1900 && y <= 2100) out.year = y
  if (q.get('n') === '1') out.night = true
  return out
}

export function writeUrlState(s: UrlState): string {
  const q = new URLSearchParams()
  if (s.view && s.view !== URL_DEFAULTS.view) q.set('v', s.view)
  if (s.metric && s.metric !== URL_DEFAULTS.metric) q.set('m', s.metric)
  if (s.country) q.set('c', s.country)
  if (s.projection && s.projection !== URL_DEFAULTS.projection) q.set('p', s.projection)
  if (s.background && s.background !== URL_DEFAULTS.background) q.set('b', s.background)
  if (s.year != null) q.set('y', String(s.year))
  if (s.night) q.set('n', '1')
  return q.toString()
}
